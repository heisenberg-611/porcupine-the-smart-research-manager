"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getCurrentUser, getUserClaims } from "@/lib/supabase/server";
import { deleteAuthUser } from "@/server/admin";
import { withUserContext } from "@/server/db";

import type { ActionResult } from "../projects/actions";
import {
  DELETION_GRACE_DAYS,
  findOwnershipBlockers,
  scrubbedFields,
  type OwnershipBlocker,
} from "./deletion";

const ConfirmInput = z.object({
  /**
   * The account's own email address, typed by hand.
   *
   * Same shape as the project delete dialog, and for the same reason: there is
   * no password to re-enter — sign-in is a six-digit code — so the only
   * available proof of intent is making the action inconvenient in a way that
   * a misclick cannot satisfy.
   */
  confirmEmail: z.string().trim().max(320),
  /** Skip the grace period and carry it out now. */
  immediate: z.boolean().optional(),
});

/**
 * Schedule this account for deletion, or carry it out at once.
 *
 * Refuses while the account is the sole owner of a project other people are
 * in. That refusal names the projects, because "you cannot delete your account"
 * with no reason is the kind of message people take to support.
 */
export async function requestAccountDeletion(
  input: z.input<typeof ConfirmInput>,
): Promise<ActionResult<{ scheduledFor?: string }>> {
  const parsed = ConfirmInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the address and try again." };

  const claims = await getUserClaims();
  const user = await getCurrentUser();
  if (!claims || !user) return { ok: false, error: "Not signed in." };

  const { confirmEmail, immediate } = parsed.data;

  // Compared case-insensitively: addresses are not case-sensitive in the half
  // that matters, and refusing "Alice@..." for an account created as
  // "alice@..." teaches nothing and helps nobody.
  if (confirmEmail.toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return { ok: false, error: "That is not the address this account signs in with." };
  }

  try {
    const outcome = await withUserContext(claims, async (tx) => {
      const blockers = await findOwnershipBlockers(tx, claims.sub);
      if (blockers.length > 0) return { blockers };

      if (!immediate) {
        const scheduledFor = new Date();
        scheduledFor.setUTCDate(scheduledFor.getUTCDate() + DELETION_GRACE_DAYS);

        await tx.user.update({
          where: { id: claims.sub },
          data: { deletionScheduledAt: scheduledFor },
        });

        return { scheduledFor: scheduledFor.toISOString() };
      }

      await scrub(tx, claims.sub);
      return { purged: true as const };
    });

    if ("blockers" in outcome) {
      /*
       * The titles go in the message, not in a payload.
       *
       * `ActionResult` carries data on success and a string on failure, which
       * is the right shape — and this refusal has to survive being read on its
       * own, in a banner, by somebody who is about to ask why the button did
       * nothing. The page lists these projects with links above the button as
       * well; this is the sentence for the person who scrolled past that.
       */
      const names = outcome.blockers.map((b) => `“${b.title}”`).join(", ");
      return {
        ok: false,
        error:
          outcome.blockers.length === 1
            ? `${names} would be left with no owner. Make somebody else an owner of it first.`
            : `These would be left with no owner: ${names}. Make somebody else an owner of each first.`,
      };
    }

    /*
     * The auth row goes LAST, and outside the transaction.
     *
     * It lives in a different schema, reached through a different client, so
     * it cannot be part of the same transaction whatever order it is written
     * in. Given that, the order is chosen for which half-finished state is
     * survivable: profile scrubbed but sign-in still possible is visible to
     * the person and can be retried; sign-in destroyed with the profile intact
     * leaves personal data belonging to an account nobody can get into.
     */
    if ("purged" in outcome) {
      await deleteAuthUser(claims.sub);
      return { ok: true, data: {} };
    }

    revalidatePath("/account");
    return { ok: true, data: { scheduledFor: outcome.scheduledFor } };
  } catch (error) {
    if (error instanceof Error && /no owner/i.test(error.message)) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: "Could not delete the account." };
  }
}

/**
 * Change your mind.
 *
 * The whole justification for a waiting period is that this exists, so it is
 * one call with no confirmation of its own: somebody who has just signed in
 * during their own grace period has already proved everything worth proving.
 */
export async function cancelAccountDeletion(): Promise<ActionResult> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  try {
    await withUserContext(claims, async (tx) => {
      await tx.user.update({
        where: { id: claims.sub },
        data: { deletionScheduledAt: null },
      });
    });

    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not cancel the deletion." };
  }
}

/**
 * Everything that is only theirs, removed; everything shared, anonymised.
 *
 * Shared by the immediate path and the scheduled purge, so the two cannot
 * drift into scrubbing different things — which is the failure mode that
 * matters here, because only one of them is ever watched by a person.
 */
export async function scrub(
  tx: Parameters<Parameters<typeof withUserContext>[1]>[0],
  userId: string,
): Promise<void> {
  // Solo projects: nobody to hand them to, so they go. `findOwnershipBlockers`
  // has already refused any project with somebody else in it.
  const soleOwned = await tx.projectMember.findMany({
    where: { userId, accessRole: "OWNER", removedAt: null },
    select: { projectId: true },
  });

  for (const { projectId } of soleOwned) {
    const others = await tx.projectMember.count({
      where: { projectId, removedAt: null, userId: { not: userId } },
    });
    if (others === 0) await tx.project.delete({ where: { id: projectId } });
  }

  // Leave every remaining project. This is what makes `rotationNeeded` true
  // for their admins — see the note on the account page about the window.
  await tx.projectMember.updateMany({
    where: { userId, removedAt: null },
    data: { removedAt: new Date() },
  });

  // Only theirs, and of no use to anybody else.
  await tx.device.deleteMany({ where: { userId } });
  await tx.projectKey.deleteMany({ where: { userId } });

  await tx.user.update({ where: { id: userId }, data: scrubbedFields(userId) });
}

/**
 * What the account page needs to render its danger zone.
 *
 * Read through the user's own client rather than Prisma: it is one row, RLS
 * already scopes it, and the page is a server component that has a client to
 * hand.
 */
export async function getDeletionState(): Promise<
  ActionResult<{ scheduledFor: string | null; blockers: OwnershipBlocker[] }>
> {
  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  try {
    const state = await withUserContext(claims, async (tx) => {
      const me = await tx.user.findUnique({
        where: { id: claims.sub },
        select: { deletionScheduledAt: true },
      });
      const blockers = await findOwnershipBlockers(tx, claims.sub);
      return {
        scheduledFor: me?.deletionScheduledAt?.toISOString() ?? null,
        blockers,
      };
    });

    return { ok: true, data: state };
  } catch {
    return { ok: false, error: "Could not load your account state." };
  }
}

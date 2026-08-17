"use server";

import {
  canTransition,
  EXCLUSION_REASON_CODES,
  SCREEN_STATUSES,
  type ScreenStatus,
} from "@Porcupine/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";

import type { ActionResult } from "../../actions";

const DecisionInput = z.object({
  projectId: z.uuid(),
  projectWorkId: z.uuid(),
  toStatus: z.enum(SCREEN_STATUSES),
  excludeReason: z.enum(EXCLUSION_REASON_CODES).nullish(),
  note: z.string().trim().max(1000).nullish(),
  /**
   * The status the client was DISPLAYING when the person decided.
   *
   * This makes the write a compare-and-swap. Without it, four people
   * screening the same queue silently overwrite each other: the Phase 1 exit
   * trial ran 4 members x 5 decisions and produced 7 screened papers, with
   * every member's UI reporting "5 decided this session". Last writer won,
   * and a supervisor's exclusion could be reversed by a colleague's include
   * with no trace anywhere a human would look.
   */
  seenStatus: z.enum(SCREEN_STATUSES).nullish(),
});

/**
 * Record a screening decision.
 *
 * The status change and the log entry are one transaction. A status that
 * moved with no decision recorded is exactly the gap that makes a PRISMA
 * diagram indefensible — "who excluded these forty papers, and when" has to
 * have an answer, and an answer that can be reconstructed a year later.
 *
 * The exclusion-reason requirement is NOT re-implemented here. It is a
 * database trigger, so imports, bulk actions, and any future API get the same
 * rule. This action just surfaces the failure in language a person can act
 * on.
 */
export async function recordDecision(
  input: z.input<typeof DecisionInput>,
): Promise<
  ActionResult<{ status: ScreenStatus; conflict?: { by: string; status: string } }>
> {
  const parsed = DecisionInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid decision." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, projectWorkId, toStatus, excludeReason, note, seenStatus } =
    parsed.data;

  try {
    const result = await withUserContext(claims, async (tx) => {
      // SELECT ... FOR UPDATE, not findUnique.
      //
      // A plain read leaves a window: two members can both read IDENTIFIED
      // before either writes, so both pass the compare-and-swap below and one
      // still overwrites the other. The exit trial reproduced exactly that —
      // the check caught 14 of 15 collisions and one slipped through.
      //
      // Locking the row serializes the read-modify-write, which is the same
      // reason rate_limit_take() locks (R-22). Prisma has no `forUpdate`, so
      // this is raw.
      const locked = await tx.$queryRaw<
        Array<{ screen_status: string; project_id: string }>
      >`
        select screen_status, project_id
        from project_works
        where id = ${projectWorkId}::uuid
        for update
      `;
      // The raw read loses Prisma's enum typing; the column is a ScreenStatus
      // by construction, so narrow it back rather than widening everything
      // downstream to string.
      const current = locked[0]
        ? {
          screenStatus: locked[0].screen_status as ScreenStatus,
          projectId: locked[0].project_id,
        }
        : null;

      // RLS already returned nothing if this user cannot see the row, so a
      // miss here means "not visible to you" and "does not exist" alike.
      if (!current || current.projectId !== projectId)
        return { error: "Paper not found." };

      // Compare-and-swap. Somebody else moved this paper between the moment
      // it was rendered and the moment the decision arrived, so this decision
      // is about a paper that no longer exists in the state it was judged in.
      // Overwriting is the one thing not to do: report it and let the person
      // move on.
      if (seenStatus && current.screenStatus !== seenStatus) {
        const previous = await tx.screeningDecision.findFirst({
          where: { projectWorkId },
          orderBy: { createdAt: "desc" },
          select: { toStatus: true, decider: { select: { displayName: true } } },
        });

        return {
          conflict: {
            by: previous?.decider.displayName ?? "someone else",
            status: previous?.toStatus ?? current.screenStatus,
          },
        };
      }

      if (!canTransition(current.screenStatus as ScreenStatus, toStatus)) {
        return {
          error:
            `A paper cannot go from ${current.screenStatus.toLowerCase()} to ` +
            `${toStatus.toLowerCase()} — the PRISMA counts are derived from these ` +
            `transitions, so the flow has to stay coherent.`,
        };
      }

      await tx.projectWork.update({
        where: { id: projectWorkId },
        data: {
          screenStatus: toStatus,
          // Clearing the reason when a paper stops being excluded matters:
          // a stale reason on an included paper is a wrong PRISMA row.
          excludeReason: toStatus === "EXCLUDED" ? (excludeReason ?? null) : null,
        },
      });

      await tx.screeningDecision.create({
        data: {
          projectId,
          projectWorkId,
          decidedBy: claims.sub,
          fromStatus: current.screenStatus,
          toStatus,
          excludeReason: toStatus === "EXCLUDED" ? (excludeReason ?? null) : null,
          note: note ?? null,
        },
        select: { id: true },
      });

      return { status: toStatus };
    });

    if ("error" in result) return { ok: false, error: result.error };

    revalidatePath(`/projects/${projectId}/screen`);
    revalidatePath(`/projects/${projectId}/library`);

    if ("conflict" in result && result.conflict) {
      // Deliberately ok:true — nothing went wrong, the paper is simply
      // already handled. The client marks it done and moves on rather than
      // treating it as an error the person has to resolve.
      return {
        ok: true,
        data: {
          status: result.conflict.status as ScreenStatus,
          conflict: result.conflict,
        },
      };
    }

    return { ok: true, data: { status: result.status! } };
  } catch (error) {
    // The database trigger raises check_violation when a systematic review
    // excludes without a reason. Translate rather than leaking SQL.
    const message = error instanceof Error ? error.message : "";
    if (/exclusion reason/i.test(message)) {
      return {
        ok: false,
        error: "This is a systematic review, so an exclusion needs a reason.",
      };
    }
    return { ok: false, error: "Could not save that. You may not have permission." };
  }
}

const AssignInput = z.object({
  projectId: z.uuid(),
  projectWorkId: z.uuid(),
  /** null clears the assignment. */
  assigneeId: z.uuid().nullish(),
  dueAt: z.string().nullish(),
});

/**
 * Assign a paper, optionally with a due date.
 *
 * Assigning to a non-member is refused explicitly rather than left to the
 * foreign key: "violates foreign key constraint" is not a sentence anyone
 * should read, and the check is cheap.
 */
export async function assignWork(
  input: z.input<typeof AssignInput>,
): Promise<ActionResult> {
  const parsed = AssignInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid assignment." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, projectWorkId, assigneeId, dueAt } = parsed.data;

  /*
   * A date means the END of that day, not the start of it.
   *
   * `<input type="date">` sends `2026-08-20`, which `new Date` reads as
   * midnight UTC — the instant the day BEGINS. Stored that way, a paper due
   * today is already overdue the moment it is assigned, because `due_at <
   * now()` is true for every hour of the day someone chose. "Due Thursday"
   * means Thursday is still yours.
   *
   * Only bare dates are shifted. A full timestamp is a caller that has
   * already said which instant it means.
   */
  let due: Date | null = null;
  if (dueAt) {
    const endOfDay = /^\d{4}-\d{2}-\d{2}$/.test(dueAt) ? `${dueAt}T23:59:59.999Z` : dueAt;
    const parsedDate = new Date(endOfDay);
    if (Number.isNaN(parsedDate.getTime()))
      return { ok: false, error: "That date is not valid." };
    due = parsedDate;
  }

  try {
    const result = await withUserContext(claims, async (tx) => {
      if (assigneeId) {
        const member = await tx.projectMember.findFirst({
          where: { projectId, userId: assigneeId, removedAt: null },
          select: { id: true },
        });
        if (!member) return { error: "That person is not a member of this project." };
      }

      const updated = await tx.projectWork.updateMany({
        where: { id: projectWorkId, projectId },
        data: { assigneeId: assigneeId ?? null, dueAt: due },
      });

      // updateMany rather than update: RLS filters a forbidden row to zero
      // rather than raising, so a count of 0 is how permission denial arrives.
      if (updated.count === 0) return { error: "Could not update that paper." };
      return {};
    });

    if ("error" in result && result.error) return { ok: false, error: result.error };

    revalidatePath(`/projects/${projectId}/screen`);
    revalidatePath("/assigned");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update that paper." };
  }
}

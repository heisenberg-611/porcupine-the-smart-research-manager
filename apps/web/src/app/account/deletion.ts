import "server-only";

import type { withUserContext } from "@/server/db";

/**
 * The transaction handle `withUserContext` hands its callback.
 *
 * Derived rather than imported from `@Porcupine/db`, and the lint rule that
 * insists on this is right: importing Prisma directly is how code ends up
 * holding a client that bypasses RLS. Naming the type through the one function
 * that establishes a user context means this module cannot be handed anything
 * else.
 */
type UserTx = Parameters<Parameters<typeof withUserContext>[1]>[0];

/**
 * How long a scheduled deletion waits before it is carried out.
 *
 * Thirty days is the number every large service settled on, and the reasoning
 * is the same here: closing an account is the one action in this product with
 * no undo, and the people most likely to take it are having a bad day. The
 * account is unusable from the moment it is requested — the window buys back
 * mistakes, not access.
 */
export const DELETION_GRACE_DAYS = 30;

/** A project this account cannot walk away from yet. */
export interface OwnershipBlocker {
  id: string;
  title: string;
  otherMembers: number;
}

/**
 * Projects that would be left without an owner.
 *
 * The rule is enforced by a database trigger as well
 * (`enforce_project_keeps_an_owner`), and that is the one that actually holds
 * — this exists so the person is told which projects and why BEFORE they type
 * their email to confirm, rather than getting a constraint violation halfway
 * through a deletion that has already scrubbed half their profile.
 *
 * A project where they are the only member at all is NOT a blocker. There is
 * nobody to hand it to, and refusing would leave someone unable to close their
 * account because of a project only they can see. Those are deleted with the
 * account.
 */
export async function findOwnershipBlockers(
  tx: UserTx,
  userId: string,
): Promise<OwnershipBlocker[]> {
  const owned = await tx.projectMember.findMany({
    where: { userId, accessRole: "OWNER", removedAt: null },
    select: { projectId: true, project: { select: { title: true } } },
  });

  const blockers: OwnershipBlocker[] = [];

  for (const membership of owned) {
    const others = await tx.projectMember.count({
      where: {
        projectId: membership.projectId,
        removedAt: null,
        userId: { not: userId },
      },
    });

    const otherOwners = await tx.projectMember.count({
      where: {
        projectId: membership.projectId,
        removedAt: null,
        accessRole: "OWNER",
        userId: { not: userId },
      },
    });

    // Somebody else can already own it, or there is nobody else at all.
    if (otherOwners > 0 || others === 0) continue;

    blockers.push({
      id: membership.projectId,
      title: membership.project.title,
      otherMembers: others,
    });
  }

  return blockers;
}

/**
 * The address a scrubbed account keeps.
 *
 * `users.email` is NOT NULL and UNIQUE, so it cannot simply be emptied and it
 * cannot be set to a shared constant — the second person to close their
 * account would collide with the first and the deletion would fail. Derived
 * from the user id, which is already in the row, so it is unique by
 * construction and reveals nothing.
 *
 * `.invalid` is reserved by RFC 2606 precisely so that it can never be
 * delivered to. A real-looking address here would eventually be mailed by
 * something.
 */
export function scrubbedEmail(userId: string): string {
  return `deleted-${userId}@account.invalid`;
}

/** What a scrubbed row looks like. One definition, used by both purge paths. */
export function scrubbedFields(userId: string) {
  return {
    email: scrubbedEmail(userId),
    displayName: "Former member",
    avatarUrl: null,
    orcid: null,
    affiliation: null,

    // The identity keys go with the account. Their messages stay ciphertext
    // for everyone including them, which is what end-to-end encryption means
    // and is not a side effect worth apologising for.
    identityPubKey: null,
    signingPubKey: null,
    wrappedBundle: null,
    kdfSalt: null,

    deletedAt: new Date(),
    deletionScheduledAt: null,
  };
}

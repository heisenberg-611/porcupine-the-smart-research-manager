"use server";

import {
  canTransition,
  EXCLUSION_REASON_CODES,
  SCREEN_STATUSES,
  type ScreenStatus,
} from "@porcupine/shared";
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
): Promise<ActionResult<{ status: ScreenStatus }>> {
  const parsed = DecisionInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid decision." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, projectWorkId, toStatus, excludeReason, note } = parsed.data;

  try {
    const result = await withUserContext(claims, async (tx) => {
      const current = await tx.projectWork.findUnique({
        where: { id: projectWorkId },
        select: { screenStatus: true, projectId: true },
      });

      // RLS already returned nothing if this user cannot see the row, so a
      // miss here means "not visible to you" and "does not exist" alike.
      if (!current || current.projectId !== projectId)
        return { error: "Paper not found." };

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
    return { ok: true, data: { status: result.status } };
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

  let due: Date | null = null;
  if (dueAt) {
    const parsedDate = new Date(dueAt);
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
    revalidatePath("/queue");
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not update that paper." };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";

import type { ActionResult } from "../../actions";

/**
 * Surface the database's own words.
 *
 * Every rule this action can trip is a trigger, and those messages are already
 * written for a person — "the person reconciling a disagreement cannot be one
 * of the two people who disagreed" is better than anything a catch block would
 * invent, and paraphrasing here would give two sources of truth for one rule.
 */
function explain(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  if (
    !/reconcil|verif|cannot be one of the two|your own extraction|draft|systematic review/i.test(
      message,
    )
  ) {
    return fallback;
  }
  const sentence = /ERROR:\s*(.+?)(\n|$)/.exec(message)?.[1] ?? message.split("\n")[0];
  return sentence?.trim() || fallback;
}

const ResolutionInput = z.object({
  fieldId: z.uuid(),
  /** "a" | "b" takes that extractor's answer; "custom" takes `value`. */
  choice: z.enum(["a", "b", "custom", "skip"]),
  value: z.unknown().nullable(),
  valueText: z.string().max(8000).nullish(),
  /** Carried over from whichever side supplied the passage. */
  anchorId: z.uuid().nullish(),
});

const ReconcileInput = z.object({
  projectId: z.uuid(),
  projectWorkId: z.uuid(),
  protocolId: z.uuid(),
  extractionA: z.uuid(),
  extractionB: z.uuid(),
  resolutions: z.array(ResolutionInput).max(200),
});

/**
 * Record a reconciliation: a third reader's resolution of two readings.
 *
 * Written in ONE transaction. A half-written reconciliation is the worst
 * possible artefact here — a RECONCILED row carrying some of the resolved
 * answers reads as a completed adjudication and is not one, and nothing on
 * screen would distinguish it from the real thing.
 *
 * The identity of the verifier comes from the session, never from the client.
 * The whole value of dual extraction rests on who resolved the disagreement,
 * so a client-supplied verifier id would let the record say a neutral third
 * party adjudicated when one of the two extractors did.
 */
export async function recordReconciliation(
  input: z.input<typeof ReconcileInput>,
): Promise<ActionResult<{ extractionId: string; resolved: number }>> {
  const parsed = ReconcileInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid resolution." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, projectWorkId, protocolId, extractionA, extractionB, resolutions } =
    parsed.data;

  if (extractionA === extractionB) {
    return { ok: false, error: "A reconciliation needs two different readings." };
  }

  try {
    const result = await withUserContext(claims, async (tx) => {
      /*
       * DRAFT first, then values, then RECONCILED.
       *
       * Not a style choice: the week-1 freeze trigger refuses value writes to
       * any extraction that is not a draft, so a row created as RECONCILED
       * could never be filled in. Same order a person works in.
       *
       * `reconciledFrom` is set on the DRAFT, which is what makes the
       * provenance triggers fire NOW rather than at the final step — so an
       * ineligible verifier is told before doing the work, in words, instead
       * of by the unique index afterwards.
       */
      const created = await tx.extraction.create({
        data: {
          projectId,
          projectWorkId,
          protocolId,
          // The verifier authors the reconciled row. The triggers check that
          // this person is neither of the two extractors.
          extractorId: claims.sub,
          verifiedBy: claims.sub,
          reconciledFrom: [extractionA, extractionB],
          status: "DRAFT",
        },
        select: { id: true },
      });

      let resolved = 0;
      for (const entry of resolutions) {
        // "skip" leaves the field a hole in the reconciled record. That is a
        // legitimate outcome — sometimes the honest answer is that neither
        // reading was supportable — and it must stay visibly a hole rather
        // than silently inheriting one side.
        if (entry.choice === "skip") continue;
        if (entry.value === null || entry.value === undefined || entry.value === "") {
          continue;
        }

        await tx.extractionValue.create({
          data: {
            projectId,
            extractionId: created.id,
            fieldId: entry.fieldId,
            value: entry.value as object,
            valueText: entry.valueText ?? null,
            // The passage travels with the answer. A reconciled value that
            // dropped its anchor would be a finding with no provenance, which
            // is exactly what the requiresAnchor rule exists to prevent.
            anchorId: entry.anchorId ?? null,
          },
          select: { id: true },
        });
        resolved++;
      }

      // Finalise. Every provenance rule is re-checked here by the same
      // trigger, so the transaction cannot commit a half-legitimate record.
      await tx.extraction.update({
        where: { id: created.id },
        data: { status: "RECONCILED", submittedAt: new Date() },
        select: { id: true },
      });

      return { extractionId: created.id, resolved };
    });

    revalidatePath(`/projects/${projectId}/reconcile`);
    revalidatePath(`/projects/${projectId}/reconcile/${projectWorkId}`);
    revalidatePath(`/projects/${projectId}/evidence`);
    return { ok: true, data: result };
  } catch (error) {
    return {
      ok: false,
      error: explain(error, "Could not record the reconciliation. Nothing was saved."),
    };
  }
}

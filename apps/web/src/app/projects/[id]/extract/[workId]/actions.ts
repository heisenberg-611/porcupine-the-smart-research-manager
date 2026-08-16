"use server";

import { CONTEXT_LENGTH } from "@porcupine/anchoring";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";

import type { ActionResult } from "../../../actions";

/**
 * Surface the database's own words.
 *
 * Every rule these actions can trip is a trigger — a submitted extraction is
 * frozen, a field marked requiresAnchor refuses a value with no passage — and
 * those messages are already written for a person. Paraphrasing them here
 * would give two sources of truth for the same rule, which is how they drift.
 */
function explain(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  if (!/submitted|requires a quoted passage|reopen it as a draft/i.test(message)) {
    return fallback;
  }
  const sentence = /ERROR:\s*(.+?)(\n|$)/.exec(message)?.[1] ?? message.split("\n")[0];
  return sentence?.trim() || fallback;
}

const StartInput = z.object({
  projectId: z.uuid(),
  projectWorkId: z.uuid(),
  protocolId: z.uuid(),
});

/**
 * Begin an extraction, or return the one already in progress.
 *
 * Idempotent by the (paper, protocol, extractor) unique index, so opening the
 * page twice does not produce two drafts — and, more importantly, does not
 * produce two rows that dual extraction would later mistake for two people
 * disagreeing with themselves.
 */
export async function startExtraction(
  input: z.input<typeof StartInput>,
): Promise<ActionResult<{ extractionId: string }>> {
  const parsed = StartInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, projectWorkId, protocolId } = parsed.data;

  try {
    const extractionId = await withUserContext(claims, async (tx) => {
      const existing = await tx.extraction.findUnique({
        where: {
          projectWorkId_protocolId_extractorId: {
            projectWorkId,
            protocolId,
            extractorId: claims.sub,
          },
        },
        select: { id: true },
      });
      
      if (!existing) {
        // Auto-assign the paper to the user if it's currently unassigned
        const work = await tx.projectWork.findUnique({
          where: { id: projectWorkId },
          select: { assigneeId: true },
        });
        
        if (work && !work.assigneeId) {
          await tx.projectWork.update({
            where: { id: projectWorkId },
            data: { assigneeId: claims.sub },
          });
        }
      }

      if (existing) return existing.id;

      const created = await tx.extraction.create({
        data: {
          projectId,
          projectWorkId,
          protocolId,
          extractorId: claims.sub,
          status: "DRAFT",
        },
        select: { id: true },
      });
      return created.id;
    });

    revalidatePath(`/projects/${projectId}/extract/${projectWorkId}`);
    return { ok: true, data: { extractionId } };
  } catch (error) {
    return {
      ok: false,
      error: explain(error, "Could not start extracting. You may not have permission."),
    };
  }
}

const ValueInput = z.object({
  fieldId: z.uuid(),
  /** null clears the answer. */
  value: z.unknown().nullable(),
  valueText: z.string().max(8000).nullish(),
  /** A passage captured from the paper, for QUOTE fields. */
  selector: z
    .object({
      quote: z.string().min(1).max(4000),
      prefix: z.string().max(CONTEXT_LENGTH).nullish(),
      suffix: z.string().max(CONTEXT_LENGTH).nullish(),
      startOff: z.number().int().min(0).nullish(),
      endOff: z.number().int().min(0).nullish(),
    })
    .nullish(),
});

const SaveInput = z.object({
  projectId: z.uuid(),
  projectWorkId: z.uuid(),
  extractionId: z.uuid(),
  values: z.array(ValueInput).max(100),
});

/**
 * Save a draft.
 *
 * The whole form in one transaction rather than a write per field. An
 * extraction half-saved is a row that looks answered and is not, and the
 * person who filled it in has no way to tell which half landed.
 *
 * Anchors are created here rather than sent by the client as ids: a client
 * that could name an arbitrary anchor could attach someone else's passage to
 * its own value, and the provenance trail would say something false while
 * looking correct.
 */
export async function saveDraft(
  input: z.input<typeof SaveInput>,
): Promise<ActionResult<{ saved: number }>> {
  const parsed = SaveInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid answers." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, projectWorkId, extractionId, values } = parsed.data;

  try {
    const saved = await withUserContext(claims, async (tx) => {
      let count = 0;

      for (const entry of values) {
        // An empty answer removes the row rather than storing null. A present
        // row with no value would show in the evidence table as answered.
        if (entry.value === null || entry.value === undefined || entry.value === "") {
          await tx.extractionValue.deleteMany({
            where: { extractionId, fieldId: entry.fieldId },
          });
          continue;
        }

        let anchorId: string | null = null;
        if (entry.selector) {
          const anchor = await tx.anchor.create({
            data: {
              projectId,
              quote: entry.selector.quote,
              prefix: entry.selector.prefix ?? null,
              suffix: entry.selector.suffix ?? null,
              startOff: entry.selector.startOff ?? null,
              endOff: entry.selector.endOff ?? null,
            },
            select: { id: true },
          });
          anchorId = anchor.id;
        }

        await tx.extractionValue.upsert({
          where: { extractionId_fieldId: { extractionId, fieldId: entry.fieldId } },
          create: {
            projectId,
            extractionId,
            fieldId: entry.fieldId,
            value: entry.value as object,
            valueText: entry.valueText ?? null,
            anchorId,
          },
          update: {
            value: entry.value as object,
            valueText: entry.valueText ?? null,
            // Keep the existing passage when this save carries none: an edit
            // to the surrounding text should not silently drop provenance.
            ...(anchorId ? { anchorId } : {}),
          },
          select: { id: true },
        });
        count++;
      }

      return count;
    });

    revalidatePath(`/projects/${projectId}/extract/${projectWorkId}`);
    return { ok: true, data: { saved } };
  } catch (error) {
    return {
      ok: false,
      error: explain(error, "Could not save. Your answers were not stored."),
    };
  }
}

const StatusInput = z.object({
  projectId: z.uuid(),
  projectWorkId: z.uuid(),
  extractionId: z.uuid(),
});

/**
 * Submit.
 *
 * Refuses while a required field is unanswered — checked here rather than by
 * a trigger because "required" is a property of the protocol a person is
 * filling in, not an invariant of the row. A draft with holes is a legitimate
 * state; a submitted one with holes is a finding that claims more than it has.
 */
export async function submitExtraction(
  input: z.input<typeof StatusInput>,
): Promise<ActionResult<{ missing: string[] }>> {
  const parsed = StatusInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, projectWorkId, extractionId } = parsed.data;

  try {
    const result = await withUserContext(claims, async (tx) => {
      const extraction = await tx.extraction.findUnique({
        where: { id: extractionId },
        select: {
          protocol: {
            select: { fields: { select: { id: true, label: true, required: true } } },
          },
          values: { select: { fieldId: true } },
        },
      });
      if (!extraction) return { missing: [], notFound: true };

      const answered = new Set(extraction.values.map((v) => v.fieldId));
      const missing = extraction.protocol.fields
        .filter((f) => f.required && !answered.has(f.id))
        .map((f) => f.label);

      if (missing.length > 0) return { missing };

      await tx.extraction.update({
        where: { id: extractionId },
        data: { status: "SUBMITTED", submittedAt: new Date() },
      });

      return { missing: [] };
    });

    if ("notFound" in result) return { ok: false, error: "Extraction not found." };

    if (result.missing.length > 0) {
      return {
        ok: false,
        error: `Still unanswered: ${result.missing.join(", ")}.`,
      };
    }

    revalidatePath(`/projects/${projectId}/extract/${projectWorkId}`);
    return { ok: true, data: { missing: [] } };
  } catch (error) {
    return { ok: false, error: explain(error, "Could not submit.") };
  }
}

/**
 * Reopen a submitted extraction as a draft.
 *
 * The database freezes a submitted extraction, and this is the door it leaves
 * open. Deliberate rather than forbidden: findings do get revised, and a tool
 * that makes someone delete and re-enter twelve answers to fix one is a tool
 * they work around.
 */
export async function reopenExtraction(
  input: z.input<typeof StatusInput>,
): Promise<ActionResult> {
  const parsed = StatusInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, projectWorkId, extractionId } = parsed.data;

  try {
    const updated = await withUserContext(claims, async (tx) =>
      tx.extraction.updateMany({
        where: { id: extractionId, extractorId: claims.sub },
        data: { status: "DRAFT" },
      }),
    );

    // RLS filters rather than raising, so zero rows is how "not yours" arrives
    // — and nobody may reopen someone else's extraction, not even an owner.
    if (updated.count === 0) {
      return { ok: false, error: "That extraction is not yours to reopen." };
    }

    revalidatePath(`/projects/${projectId}/extract/${projectWorkId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: explain(error, "Could not reopen it.") };
  }
}

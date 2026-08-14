"use server";

import { CONTEXT_LENGTH } from "@porcupine/anchoring";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";

import type { ActionResult } from "../../../actions";

const AnnotateInput = z.object({
  projectId: z.uuid(),
  projectWorkId: z.uuid(),
  kind: z.enum(["HIGHLIGHT", "NOTE", "QUESTION", "TODO"]),
  visibility: z.enum(["PRIVATE", "PROJECT"]),
  body: z.string().trim().max(4000).nullish(),
  selector: z.object({
    quote: z.string().min(1).max(4000),
    prefix: z.string().max(CONTEXT_LENGTH).nullish(),
    suffix: z.string().max(CONTEXT_LENGTH).nullish(),
    startOff: z.number().int().min(0).nullish(),
    endOff: z.number().int().min(0).nullish(),
    page: z.number().int().min(1).nullish(),
  }),
});

/**
 * Create an annotation and the anchor it hangs from.
 *
 * One transaction, because an Anchor with no Annotation is an invisible row
 * and an Annotation with no Anchor cannot be rendered — either half alone is
 * garbage that nothing will ever clean up.
 *
 * The selector is trusted only as far as its shape. Where it POINTS is
 * re-derived at render time by resolving it against the current text, so a
 * client that sends misleading offsets gets a DRIFTED badge rather than a
 * highlight in the wrong place.
 */
export async function createAnnotation(
  input: z.input<typeof AnnotateInput>,
): Promise<ActionResult<{ annotationId: string }>> {
  const parsed = AnnotateInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid annotation." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, projectWorkId, kind, visibility, body, selector } = parsed.data;

  try {
    const annotationId = await withUserContext(claims, async (tx) => {
      const anchor = await tx.anchor.create({
        data: {
          projectId,
          quote: selector.quote,
          prefix: selector.prefix ?? null,
          suffix: selector.suffix ?? null,
          startOff: selector.startOff ?? null,
          endOff: selector.endOff ?? null,
          page: selector.page ?? null,
        },
        select: { id: true },
      });

      const annotation = await tx.annotation.create({
        data: {
          projectId,
          projectWorkId,
          anchorId: anchor.id,
          authorId: claims.sub,
          kind,
          visibility,
          body: body ?? null,
        },
        select: { id: true },
      });

      return annotation.id;
    });

    revalidatePath(`/projects/${projectId}/read/${projectWorkId}`);
    return { ok: true, data: { annotationId } };
  } catch {
    // An OBSERVER hits the RLS policy here. Say so without confirming what
    // exists.
    return { ok: false, error: "Could not save that. You may not have permission." };
  }
}

const DeleteInput = z.object({
  projectId: z.uuid(),
  projectWorkId: z.uuid(),
  annotationId: z.uuid(),
});

/**
 * Soft-delete an annotation.
 *
 * Soft, not hard: `deletedAt` keeps the row readable to its author, and the
 * anchor stays put so a Phase 2 extraction that cited it does not lose its
 * source. A hard delete would leave that extraction pointing at nothing.
 *
 * Only the author can do this — the RLS policy allows no one else, so an
 * owner cannot quietly remove a supervisor's comment.
 */
export async function deleteAnnotation(
  input: z.input<typeof DeleteInput>,
): Promise<ActionResult> {
  const parsed = DeleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, projectWorkId, annotationId } = parsed.data;

  try {
    const updated = await withUserContext(claims, async (tx) =>
      tx.annotation.updateMany({
        where: { id: annotationId, projectId },
        data: { deletedAt: new Date() },
      }),
    );

    // RLS filters rather than raising, so zero rows is how "not yours" arrives.
    if (updated.count === 0) {
      return { ok: false, error: "That annotation is not yours to delete." };
    }

    revalidatePath(`/projects/${projectId}/read/${projectWorkId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not delete that annotation." };
  }
}

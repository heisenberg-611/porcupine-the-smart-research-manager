"use server";

import {
  MAX_PAPER_BYTES,
  PAPER_BUCKET,
  PAPER_MIME,
  paperStoragePath,
} from "@Porcupine/shared";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createClient, getUserClaims } from "@/lib/supabase/server";
import { withUserContext } from "@/server/db";
import { discardPaperObject, inspectPaperObject } from "@/server/paper-files";

import type { ActionResult } from "../../../actions";

/*
 * Attaching a PDF to a paper, in two halves.
 *
 * The bytes never come through here. The browser uploads them straight to
 * Supabase Storage with its own JWT, which is what keeps a 50 MB file away
 * from a serverless function's body limit and its ten-second budget — and it
 * is safe to do because the object's own RLS policy decides whether that JWT
 * may write to that path. The app is not the guard; it never was going to be a
 * good one.
 *
 * What the app does own is the record. `beginUpload` writes a PENDING row and
 * hands back the path it must be uploaded to; `completeUpload` looks at what
 * actually arrived and flips the row to COMPLETE. Between those two calls the
 * truth lives in two systems, so both orders of failure are possible and
 * neither is silent:
 *
 *   row, no bytes  → PENDING, swept by /tasks/reconcile-uploads
 *   bytes, no row  → an orphan, swept by the same route
 *
 * Row first, deliberately. The alternative leaves bytes in the bucket with
 * nothing in the database pointing at them for as long as the user's tab is
 * open, and the reconciler cannot tell that from an abandoned upload.
 */

const BeginInput = z.object({
  projectId: z.uuid(),
  projectWorkId: z.uuid(),
  sizeBytes: z.number().int().positive().max(MAX_PAPER_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "That is not a SHA-256 digest."),
});

/**
 * Reserve a place for the file and say where to put it.
 *
 * Deliberately does NOT trust `sizeBytes` for anything but a cheap early
 * refusal — the authoritative size is read back from the storage service in
 * `completeUpload`. It is here so that a browser about to spend two minutes
 * uploading something too large is told in one round trip instead.
 */
export async function beginUpload(
  input: z.input<typeof BeginInput>,
): Promise<ActionResult<{ fileId: string; path: string; bucket: string }>> {
  const parsed = BeginInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid upload." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, projectWorkId, sizeBytes, sha256 } = parsed.data;

  try {
    const result = await withUserContext(claims, async (tx) => {
      /*
       * The Work, not the ProjectWork.
       *
       * `file_objects.work_id` points at the global Work, because the same
       * paper in two projects is the same paper and one day the same
       * open-access bytes (R-04). The route parameter is a ProjectWork id, so
       * it has to be resolved — and the read is inside the transaction under
       * the user's own claim, so a ProjectWork they cannot see returns nothing
       * rather than leaking that it exists.
       */
      const projectWork = await tx.projectWork.findFirst({
        where: { id: projectWorkId, projectId },
        select: { workId: true },
      });
      if (!projectWork) return null;

      const file = await tx.fileObject.create({
        data: {
          ownerId: claims.sub,
          projectId,
          workId: projectWork.workId,
          bucket: PAPER_BUCKET,
          // Placeholder, rewritten below once the row has an id to name it by.
          storagePath: "",
          mimeType: PAPER_MIME,
          sizeBytes,
          sha256,
          uploadState: "PENDING",
        },
        select: { id: true },
      });

      const path = paperStoragePath(projectId, file.id);
      await tx.fileObject.update({
        where: { id: file.id },
        data: { storagePath: path },
      });

      return { fileId: file.id, path };
    });

    if (!result) return { ok: false, error: "That paper is not in this project." };
    return { ok: true, data: { ...result, bucket: PAPER_BUCKET } };
  } catch {
    // The RLS policy refuses a REVIEWER or an OBSERVER here, matching the
    // storage policy that would refuse the bytes a moment later.
    return {
      ok: false,
      error: "You do not have permission to attach a file to this project.",
    };
  }
}

const CompleteInput = z.object({
  projectId: z.uuid(),
  projectWorkId: z.uuid(),
  fileId: z.uuid(),
});

/**
 * Confirm what actually landed, and refuse it if it is not a PDF.
 *
 * Everything here is read back from the storage service rather than taken from
 * the caller. That is the whole point of the step: at this moment the bytes
 * exist and can be examined, and the client's account of them cannot.
 *
 * The magic-byte check is the one that matters. A filename is a string the
 * user chose and a Content-Type is a header the client sent — the bucket's
 * `allowed_mime_types` rejects a declared `image/png`, but a PNG *declared* as
 * `application/pdf` sails through it. Five bytes over a Range request settles
 * it: 206 Partial Content, `%PDF-`, and nothing else downloaded.
 *
 * A file that fails is deleted rather than left PENDING. Leaving it would mean
 * storing content the app has already decided is not what it claims to be,
 * and charging the user's quota for it until the reconciler noticed.
 */
export async function completeUpload(
  input: z.input<typeof CompleteInput>,
): Promise<ActionResult<{ sizeBytes: number }>> {
  const parsed = CompleteInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid upload." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, projectWorkId, fileId } = parsed.data;
  const path = paperStoragePath(projectId, fileId);

  // The user's own client throughout, so every read below is one this person
  // was entitled to make. A service-role client here would work, and would be
  // the beginning of the end of the boundary stage 1 established.
  const supabase = await createClient();
  const object = await inspectPaperObject(supabase, projectId, fileId);

  if (!object) {
    return {
      ok: false,
      error: "The upload did not finish. Nothing arrived for that file.",
    };
  }

  if (!object.isPdf) {
    await discardPaperObject(supabase, path);
    return {
      ok: false,
      // Named precisely. "Invalid file" would send someone back to the picker
      // to choose the same file again; this says what was wrong with it.
      error: "That file is not a PDF, whatever it is named. Nothing was saved.",
    };
  }

  if (!object.acceptable) {
    await discardPaperObject(supabase, path);
    return { ok: false, error: "That file is empty or larger than 50 MB." };
  }

  try {
    const updated = await withUserContext(claims, (tx) =>
      tx.fileObject.updateMany({
        where: { id: fileId, ownerId: claims.sub, uploadState: "PENDING" },
        data: {
          uploadState: "COMPLETE",
          // Authoritative, from the storage service rather than the browser.
          sizeBytes: object.sizeBytes,
          mimeType: object.mimeType,
          etag: object.etag,
        },
      }),
    );

    // updateMany rather than update, so a second confirmation of the same
    // upload — a double-click, a retried action — matches zero rows and says
    // so, instead of throwing a record-not-found that reads like a bug.
    if (updated.count === 0) {
      return { ok: false, error: "That upload was already finished." };
    }
  } catch {
    return { ok: false, error: "The file uploaded, but its record could not be saved." };
  }

  revalidatePath(`/projects/${projectId}/read/${projectWorkId}`);
  return { ok: true, data: { sizeBytes: object.sizeBytes } };
}

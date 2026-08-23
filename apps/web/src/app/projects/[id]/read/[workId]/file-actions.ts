"use server";

import {
  MAX_PAPER_BYTES,
  MAX_PAPER_PAGES,
  PAPER_BUCKET,
  PAPER_MIME,
  TEXT_CHUNK_PAGES,
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
  } catch (cause) {
    /*
     * Say what happened, not what we assume happened.
     *
     * This used to return "You do not have permission to attach a file to this
     * project" for EVERY exception. An RLS refusal is one thing that lands
     * here — a REVIEWER hits it, matching the storage policy that would refuse
     * the bytes a moment later — but so does a connection failure, a schema
     * mismatch, or a constraint nobody anticipated. Reporting all of them as a
     * permission problem sent the reader looking at roles and memberships that
     * were never wrong, and the actual error was discarded before anyone could
     * see it.
     *
     * 42501 is the code RLS raises; anything else gets an honest "went wrong"
     * and the detail goes to the server log where an operator can find it.
     */
    const message = cause instanceof Error ? cause.message : String(cause);
    const refused = message.includes("42501") || /row-level security/i.test(message);

    if (!refused) {
      console.error("beginUpload failed", cause);
    }

    return {
      ok: false,
      error: refused
        ? "You do not have permission to attach a file to this project."
        : "Could not start the upload. The server log has the detail.",
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

  const { projectId, fileId } = parsed.data;
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

  /*
   * Deliberately no revalidatePath here, and this cost an afternoon.
   *
   * Revalidating makes the reader re-render immediately, which swaps the
   * upload form for "The PDF is attached" — while the form is still running.
   * The text extraction that follows is a closure on an unmounted component:
   * its calls still reach the server, but nothing is left to receive the
   * replies, and anyone who navigates on seeing "attached" cuts the remaining
   * chunks off mid-flight. The symptom was a file whose pages were stored but
   * whose `text_status` never left PENDING.
   *
   * So the record is written and the caller is told; the screen changes once,
   * at the end, when the form itself asks for it.
   */
  return { ok: true, data: { sizeBytes: object.sizeBytes } };
}

/*
 * ── The text layer ──────────────────────────────────────────────────────────
 *
 * Extracted in the browser (see src/lib/pdf-text.ts) and stored here once, by
 * whoever uploads the file. Every other member of the project reads the stored
 * result, so the cost is paid a single time and never by the server.
 *
 * It arrives in CHUNKS, which is not premature caution: a server action's
 * request body is limited to 1 MB by default, and a 300-page document at a
 * few kilobytes a page clears that on its own. Sending it whole would work in
 * testing on short papers and fail on exactly the long documents that most
 * need full-text reading.
 */

const PageInput = z.object({
  pageNumber: z.number().int().min(1).max(MAX_PAPER_PAGES),
  // A dense A4 page of prose is about 4,000 characters. The cap is for a
  // pathological page, not a long one, and truncating quietly would put text
  // in the database that no anchor could ever resolve against.
  text: z.string().max(200_000),
});

const StoreTextInput = z.object({
  projectId: z.uuid(),
  fileId: z.uuid(),
  pages: z.array(PageInput).min(1).max(TEXT_CHUNK_PAGES),
});

/**
 * Store one chunk of extracted page text.
 *
 * Idempotent by construction: `file_pages` is unique on (file_id, page_number)
 * and this skips duplicates, so a retried chunk after a dropped connection
 * costs nothing and a double-submitted one changes nothing.
 */
export async function storePaperTextChunk(
  input: z.input<typeof StoreTextInput>,
): Promise<ActionResult> {
  const parsed = StoreTextInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid page text." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, fileId, pages } = parsed.data;

  try {
    const stored = await withUserContext(claims, async (tx) => {
      // The file must be in this project and actually finished. Text for a
      // PENDING upload would outlive the sweep that removes it.
      const file = await tx.fileObject.findFirst({
        where: { id: fileId, projectId, uploadState: "COMPLETE" },
        select: { id: true },
      });
      if (!file) return false;

      await tx.filePage.createMany({
        data: pages.map((page) => ({
          projectId,
          fileId,
          pageNumber: page.pageNumber,
          text: page.text,
        })),
        skipDuplicates: true,
      });
      return true;
    });

    if (!stored) return { ok: false, error: "That file is not ready for text." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not save the text of that page." };
  }
}

const FinishTextInput = z.object({
  projectId: z.uuid(),
  projectWorkId: z.uuid(),
  fileId: z.uuid(),
  pageCount: z.number().int().min(1).max(MAX_PAPER_PAGES),
});

/**
 * Mark the text layer complete — but only if all of it is actually there.
 *
 * The count is verified against the rows rather than taken from the caller.
 * Chunks can fail independently, and a file marked EXTRACTED with page 47
 * missing is worse than one marked PENDING: the reader would show the
 * document with a silent hole in it, and an anchor into that page would
 * resolve as BROKEN with no explanation available anywhere.
 */
export async function finishPaperText(
  input: z.input<typeof FinishTextInput>,
): Promise<ActionResult<{ pageCount: number }>> {
  const parsed = FinishTextInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid page count." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, projectWorkId, fileId, pageCount } = parsed.data;

  try {
    const result = await withUserContext(claims, async (tx) => {
      const stored = await tx.filePage.count({ where: { fileId, projectId } });
      if (stored !== pageCount) return { complete: false, stored };

      await tx.fileObject.updateMany({
        where: { id: fileId, projectId },
        data: { pageCount, textStatus: "EXTRACTED" },
      });
      return { complete: true, stored };
    });

    if (!result.complete) {
      return {
        ok: false,
        error: `Only ${result.stored} of ${pageCount} pages were saved. The text was not marked complete.`,
      };
    }
  } catch {
    return { ok: false, error: "Could not finish saving the text." };
  }

  revalidatePath(`/projects/${projectId}/read/${projectWorkId}`);
  return { ok: true, data: { pageCount } };
}

/**
 * Record that extraction was attempted and did not work.
 *
 * FAILED rather than left PENDING, because the two mean different things to
 * the reader: PENDING is "the text is on its way", FAILED is "this PDF has no
 * text layer we can read — it is probably a scan". Only the second one is
 * worth telling somebody, and only if it is recorded.
 */
export async function markPaperTextFailed(
  input: z.input<typeof CompleteInput>,
): Promise<ActionResult> {
  const parsed = CompleteInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid file." };

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, projectWorkId, fileId } = parsed.data;

  try {
    await withUserContext(claims, (tx) =>
      tx.fileObject.updateMany({
        where: { id: fileId, projectId },
        data: { textStatus: "FAILED" },
      }),
    );
  } catch {
    return { ok: false, error: "Could not record the extraction failure." };
  }

  revalidatePath(`/projects/${projectId}/read/${projectWorkId}`);
  return { ok: true };
}

/**
 * Detach a paper's PDF: the record, its text, and the bytes.
 *
 * ─ The order, which is the only interesting part ───────────────────────────
 *
 * Row first, bytes second — and that is the opposite of what feels safe.
 *
 * Deleting the bytes first and then failing to delete the row leaves a record
 * claiming an attachment that is not there: the reader says "the PDF is
 * attached", the download 404s, and NOTHING in the system will ever notice or
 * repair it.
 *
 * Deleting the row first and then failing on the bytes leaves an object no row
 * claims — which is precisely what `orphaned_paper_objects()` looks for, and
 * `/tasks/reconcile-uploads` deletes within the hour. One failure mode is
 * self-healing and the other is permanent, so the order is chosen to fail into
 * the self-healing one.
 *
 * ─ What is deliberately NOT deleted ───────────────────────────────────────
 *
 * Anchors, annotations and extraction quotes stay. They are evidence: a quote
 * recorded against page 14 is a claim somebody made about this paper, and
 * removing the file does not unmake it. They will resolve as BROKEN against
 * whatever text remains, which is the anchoring engine reporting the truth
 * rather than the file taking the record down with it. The UI says so before
 * the click.
 *
 * `file_pages` DOES go, by cascade — it is a copy of the file's contents, not
 * a claim about them.
 */
export async function removePaperFile(
  input: z.input<typeof CompleteInput>,
): Promise<ActionResult> {
  const parsed = CompleteInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid file." };
  }

  const claims = await getUserClaims();
  if (!claims) return { ok: false, error: "Not signed in." };

  const { projectId, projectWorkId, fileId } = parsed.data;

  let storagePath: string | null = null;

  try {
    storagePath = await withUserContext(claims, async (tx) => {
      const file = await tx.fileObject.findFirst({
        where: { id: fileId, projectId },
        select: { storagePath: true },
      });
      if (!file) return null;

      // Cascades to file_pages. The delete policy is the same
      // OWNER/ADMIN/CONTRIBUTOR rule as the object's own.
      await tx.fileObject.delete({ where: { id: fileId } });
      return file.storagePath;
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const refused = message.includes("42501") || /row-level security/i.test(message);
    if (!refused) {
      console.error("removePaperFile failed", cause);
    }
    return {
      ok: false,
      error: refused
        ? "You do not have permission to remove this file."
        : "Could not remove the file. The server log has the detail.",
    };
  }

  if (!storagePath) return { ok: false, error: "That file is not in this project." };

  // Best effort, and safe to fail: the row is already gone, so the object is
  // now an orphan and the reconciler owns it.
  const supabase = await createClient();
  await discardPaperObject(supabase, storagePath);

  revalidatePath(`/projects/${projectId}/read/${projectWorkId}`);
  return { ok: true };
}

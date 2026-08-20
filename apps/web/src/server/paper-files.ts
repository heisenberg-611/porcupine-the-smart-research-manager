import "server-only";

import {
  MAX_PAPER_BYTES,
  PAPER_BUCKET,
  PAPER_MIME,
  PDF_MAGIC_BYTES,
  looksLikePdf,
  paperStoragePath,
} from "@Porcupine/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What is actually sitting in the bucket at this path.
 *
 * Shared by the upload action and the reconciliation cron, which examine the
 * same object for the same reasons at different times — one with the user's
 * JWT while they wait, one with the secret key an hour later. If they judged a
 * file differently, an upload refused at the boundary could be quietly
 * accepted by the sweeper, or a good file the app lost track of could be
 * deleted as junk. So the judgement is written once and both call it.
 *
 * The client is passed in rather than constructed here precisely so that the
 * caller's authority stays the caller's. This module decides what a valid
 * paper file is; it does not decide who is allowed to look.
 */
export interface PaperObject {
  sizeBytes: number;
  mimeType: string;
  etag: string | null;
  /** The only property here the uploader cannot assert. */
  isPdf: boolean;
  /** Size within limits AND the bytes are a PDF. */
  acceptable: boolean;
}

export async function inspectPaperObject(
  supabase: SupabaseClient,
  projectId: string,
  fileId: string,
): Promise<PaperObject | null> {
  const storage = supabase.storage.from(PAPER_BUCKET);
  const path = paperStoragePath(projectId, fileId);

  const { data: listed, error } = await storage.list(projectId, {
    search: `${fileId}.pdf`,
  });
  const object = listed?.[0];
  if (error || !object) return null;

  const metadata = (object.metadata ?? {}) as {
    size?: number;
    mimetype?: string;
    eTag?: string;
  };
  const sizeBytes = metadata.size ?? 0;

  /*
   * Five bytes, over a Range request.
   *
   * `download()` pulls the whole object into a serverless function to look at
   * its first five bytes — up to fifty megabytes of transfer and memory to
   * answer a question that fits in a word. A signed URL plus `Range` returns
   * 206 with exactly the head. Measured against local storage: status 206,
   * five bytes, "%PDF-".
   *
   * This is the check the uploader cannot talk its way past. The bucket's
   * `allowed_mime_types` rejects a declared `image/png`, but a PNG *declared*
   * as `application/pdf` satisfies both the extension and the header, and
   * fails here.
   */
  let isPdf = false;
  const { data: signed, error: signError } = await storage.createSignedUrl(path, 60);
  // An object that cannot be signed cannot be read, and a file that cannot be
  // read is not one to accept — `isPdf` stays false and the caller reports
  // that it could not check, rather than that the file is bad.
  if (!signError && signed) {
    try {
      const response = await fetch(signed.signedUrl, {
        headers: { Range: `bytes=0-${PDF_MAGIC_BYTES - 1}` },
      });
      if (response.ok) isPdf = looksLikePdf(await response.arrayBuffer());
    } catch {
      // Left false. An object that cannot be read is not one to accept, and
      // the caller reports "could not check" rather than "not a PDF".
      isPdf = false;
    }
  }

  return {
    sizeBytes,
    mimeType: metadata.mimetype ?? PAPER_MIME,
    etag: metadata.eTag ?? null,
    isPdf,
    acceptable: isPdf && sizeBytes > 0 && sizeBytes <= MAX_PAPER_BYTES,
  };
}

/**
 * Delete an object we have decided not to keep.
 *
 * Best-effort on purpose. If it fails, the object and its row are both still
 * there and the reconciler deals with them within the hour; turning a failed
 * cleanup into a failed upload would report the wrong problem to the wrong
 * person.
 */
export async function discardPaperObject(
  supabase: SupabaseClient,
  path: string,
): Promise<void> {
  try {
    await supabase.storage.from(PAPER_BUCKET).remove([path]);
  } catch {
    // Deliberately swallowed. See above.
  }
}

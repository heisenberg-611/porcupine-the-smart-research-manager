/**
 * What counts as an acceptable paper file, in one place.
 *
 * The browser checks these before uploading so a mistake is caught in
 * milliseconds instead of after fifty megabytes; the server checks them again
 * because the browser's answer is a claim, not a fact; and the bucket itself
 * carries the same two numbers so they hold even when neither runs.
 *
 * Three enforcement points is not belt-and-braces, it is three different
 * threat models — a user picking the wrong file, a client that lies, and an
 * upload that skips the app entirely. They must agree, which is why the values
 * live here rather than being typed out three times.
 */

/** The one bucket. Created in 20260819132216_file_storage_boundary.sql. */
export const PAPER_BUCKET = "papers";

/**
 * 50 MiB, matching `storage.buckets.file_size_limit` for this bucket and
 * `[storage] file_size_limit` in supabase/config.toml. Change one, change all
 * three — including the hosted project's dashboard setting, which is the one
 * no test can see.
 */
export const MAX_PAPER_BYTES = 52_428_800;

/** Matching the bucket's `allowed_mime_types`. */
export const PAPER_MIME = "application/pdf";

/**
 * The first five bytes of every PDF, per ISO 32000-1 §7.5.2.
 *
 * This is the only check of the three that the caller cannot simply assert.
 * A filename is a string they chose and a Content-Type is a header they sent;
 * the bytes are the file. A PNG uploaded as `paper.pdf` with
 * `Content-Type: application/pdf` passes both of the other checks and fails
 * this one.
 */
export const PDF_MAGIC = "%PDF-";

/** Bytes of the file that must be read to test it. */
export const PDF_MAGIC_BYTES = 5;

/**
 * Where a paper's bytes live: {projectId}/{fileId}.pdf
 *
 * The leading segment is load-bearing rather than tidy — the storage policies
 * read it to decide who may touch the object, so a key built any other way is
 * invisible to its own project. Anything that constructs one of these paths
 * must come through here.
 */
export function paperStoragePath(projectId: string, fileId: string): string {
  return `${projectId}/${fileId}.pdf`;
}

/** True when the buffer opens with the PDF signature. */
export function looksLikePdf(head: ArrayBuffer | Uint8Array): boolean {
  const bytes = head instanceof Uint8Array ? head : new Uint8Array(head);
  if (bytes.length < PDF_MAGIC_BYTES) return false;
  for (let i = 0; i < PDF_MAGIC_BYTES; i++) {
    if (bytes[i] !== PDF_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Why this file is not acceptable, or null when it is.
 *
 * Returns prose because every caller shows it to a person. "Invalid file" sends
 * someone back to a file picker with no idea what to pick differently; the size
 * limit and the reason are what let them act.
 */
export function describeFileRefusal(file: { size: number; type: string }): string | null {
  if (file.size === 0) {
    return "That file is empty.";
  }
  if (file.size > MAX_PAPER_BYTES) {
    const mb = (file.size / 1_048_576).toFixed(1);
    return `That file is ${mb} MB. The limit is 50 MB.`;
  }
  // The declared type, which is the browser's guess from the extension. Worth
  // checking because it catches the common mistake early, but it is not
  // evidence — `looksLikePdf` is.
  if (file.type && file.type !== PAPER_MIME) {
    return "Only PDF files can be attached to a paper.";
  }
  return null;
}

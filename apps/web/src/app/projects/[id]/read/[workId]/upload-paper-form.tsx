"use client";

import {
  MAX_PAPER_BYTES,
  PAPER_BUCKET,
  PAPER_MIME,
  PDF_MAGIC_BYTES,
  TEXT_CHUNK_PAGES,
  describeFileRefusal,
  looksLikePdf,
} from "@Porcupine/shared";
import { useRouter } from "next/navigation";
import { startTransition, useRef, useState } from "react";

import { Banner, Button, Field, FileInput } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

import { extractPdfText } from "@/lib/pdf-text";

import {
  beginUpload,
  completeUpload,
  finishPaperText,
  markPaperTextFailed,
  removePaperFile,
  storePaperTextChunk,
} from "./file-actions";

/**
 * Attach the PDF.
 *
 * The bytes go from here straight to Supabase Storage with this browser's own
 * JWT — they do not pass through a server action, which is what keeps a 50 MB
 * file away from the request body limit. The two server actions around it
 * write the record and then confirm what landed.
 *
 * Everything this component checks is checked again on the server. That is not
 * redundancy: it is the difference between telling someone in 20 ms that they
 * picked a Word document and letting them wait two minutes to find out.
 */

/** The stages, in the order they happen. Each one is shown on the button. */
type Stage = "idle" | "checking" | "uploading" | "finishing" | "reading";

const LABEL: Record<Stage, string> = {
  idle: "Attach this PDF",
  checking: "Checking the file…",
  uploading: "Uploading…",
  finishing: "Finishing up…",
  // Named for what the user gets, not for what the machine does. "Extracting
  // text layer" is accurate and means nothing to a researcher.
  reading: "Reading the pages…",
};

export function UploadPaperForm({
  projectId,
  projectWorkId,
}: {
  projectId: string;
  projectWorkId: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  // Distinct from `error`: the upload SUCCEEDED and something after it did
  // not. Showing that as a field error would say the attachment failed, which
  // is both wrong and the opposite of reassuring.
  const [notice, setNotice] = useState<string | null>(null);

  const busy = stage !== "idle";

  /*
   * `onSubmit`, not `action`.
   *
   * `<form action={fn}>` runs the handler inside a transition, and state
   * updates inside a transition are deferred — so the stage labels below would
   * be set and never painted, and a two-minute upload would look like a button
   * that did nothing. The project and invite forms both had exactly this bug.
   */
  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];

    setError(null);
    setNotice(null);

    if (!file) {
      setError("Choose a PDF first.");
      return;
    }

    setStage("checking");

    // Size and declared type: cheap, and catches the common mistake.
    const refusal = describeFileRefusal(file);
    if (refusal) {
      setStage("idle");
      setError(refusal);
      return;
    }

    // The bytes themselves. A .docx renamed to .pdf gets past every check
    // above this one, and would otherwise be found out only after the upload.
    const head = await file.slice(0, PDF_MAGIC_BYTES).arrayBuffer();
    if (!looksLikePdf(head)) {
      setStage("idle");
      setError("That file is not a PDF, whatever it is named.");
      return;
    }

    /*
     * SHA-256, computed here.
     *
     * Recorded, not trusted. R-04 wants to deduplicate open-access files
     * across users by content hash, and a hash the uploader supplied cannot
     * decide that a second user may be handed the first user's bytes — a
     * client that lies about it would be claiming somebody else's file. So
     * this is stored as a record of what this browser believed it sent, and
     * §8 of the build plan keeps dedupe deferred until the server derives its
     * own.
     */
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const sha256 = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const begun = await beginUpload({
      projectId,
      projectWorkId,
      sizeBytes: file.size,
      sha256,
    });

    if (!begun.ok) {
      setStage("idle");
      setError(begun.error);
      return;
    }

    setStage("uploading");

    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
      .from(begun.data.bucket)
      .upload(begun.data.path, file, { contentType: PAPER_MIME });

    if (uploadError) {
      setStage("idle");
      // The storage policy refuses this by path, so the honest reading of a
      // failure here is "not allowed or not reachable" rather than "broken".
      setError(`The upload was refused: ${uploadError.message}`);
      return;
    }

    setStage("finishing");

    const finished = await completeUpload({
      projectId,
      projectWorkId,
      fileId: begun.data.fileId,
    });

    if (!finished.ok) {
      setStage("idle");
      setError(finished.error);
      return;
    }

    /*
     * The text layer, extracted here rather than on a server.
     *
     * The file is already in this tab's memory — it was just hashed and
     * uploaded from it — so this costs a server nothing and never meets a
     * function's duration limit. It happens once, by the uploader; every other
     * member of the project reads the stored result.
     *
     * A failure here does NOT fail the upload. The PDF is attached and
     * downloadable whatever happens next; a scanned paper with no text layer
     * is a real and ordinary thing, and it is recorded as FAILED so the reader
     * can say so instead of promising text that is never coming.
     */
    setStage("reading");
    const extracted = await extractPdfText(file);

    if (!extracted.ok) {
      await markPaperTextFailed({ projectId, projectWorkId, fileId: begun.data.fileId });
      setStage("idle");
      setNotice(
        `${extracted.error} The PDF is attached and can be downloaded; only in-app reading is unavailable.`,
      );
      if (inputRef.current) inputRef.current.value = "";
      startTransition(() => router.refresh());
      return;
    }

    for (let i = 0; i < extracted.pages.length; i += TEXT_CHUNK_PAGES) {
      const chunk = extracted.pages.slice(i, i + TEXT_CHUNK_PAGES);
      const sent = await storePaperTextChunk({
        projectId,
        fileId: begun.data.fileId,
        pages: chunk,
      });
      if (!sent.ok) {
        // Stop at the first failure rather than sending the rest: the
        // finishing step counts rows and would refuse anyway, and carrying on
        // just spends the user's bandwidth on a result already lost.
        await markPaperTextFailed({
          projectId,
          projectWorkId,
          fileId: begun.data.fileId,
        });
        setStage("idle");
        setNotice(`${sent.error} The PDF is attached; its text is not.`);
        startTransition(() => router.refresh());
        return;
      }
    }

    const done = await finishPaperText({
      projectId,
      projectWorkId,
      fileId: begun.data.fileId,
      pageCount: extracted.pages.length,
    });

    setStage("idle");

    if (!done.ok) {
      setNotice(`${done.error} The PDF is attached; its text is not.`);
      startTransition(() => router.refresh());
      return;
    }

    if (inputRef.current) inputRef.current.value = "";
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <Field
        id="paper-pdf"
        label="Attach the PDF"
        hint={`PDF only, up to ${MAX_PAPER_BYTES / 1_048_576} MB. Everyone on this project will be able to read it.`}
        error={error ?? undefined}
      >
        <FileInput
          ref={inputRef}
          id="paper-pdf"
          name="file"
          accept="application/pdf,.pdf"
          disabled={busy}
        />
      </Field>

      {notice && <Banner>{notice}</Banner>}

      {/* Stated plainly rather than implied. docs/02-security-and-e2ee.md §7:
          do not claim files are scanned until scanning exists. */}
      <p className="text-muted text-fine">
        Uploaded files are checked for type and size, and are rendered in a sandbox — they
        are not virus-scanned. Treat a PDF you downloaded from an unfamiliar source with
        the same care you would outside this app.
      </p>

      <div>
        {/* No busyLabel: LABEL[stage] already names the phase — "Uploading…",
            then "Reading the pages…" — which says more than one busy label
            could. What was missing is the half a screen reader gets, so this
            takes aria-busy and the spinner and leaves the wording alone. */}
        <Button type="submit" busy={busy}>
          {LABEL[stage]}
        </Button>
      </div>

      {/* Progress that a screen reader hears, not just a changing label. */}
      <p aria-live="polite" className="sr-only">
        {busy ? LABEL[stage] : ""}
      </p>
    </form>
  );
}

export function AttachedPaper({
  projectId,
  projectWorkId,
  fileId,
  sizeBytes,
  uploadedAt,
  hasText,
  storagePath,
}: {
  projectId: string;
  projectWorkId: string;
  fileId: string;
  sizeBytes: number;
  uploadedAt: string;
  hasText: boolean;
  storagePath?: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reExtract() {
    if (!storagePath) return;
    setExtracting(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: blob, error: dlError } = await supabase.storage
        .from(PAPER_BUCKET)
        .download(storagePath);
      if (dlError || !blob) {
        throw new Error(dlError?.message ?? "Could not download attached PDF.");
      }

      const extracted = await extractPdfText(blob);
      if (!extracted.ok) {
        await markPaperTextFailed({ projectId, projectWorkId, fileId });
        setError(`${extracted.error}`);
        setExtracting(false);
        return;
      }

      for (let i = 0; i < extracted.pages.length; i += TEXT_CHUNK_PAGES) {
        const chunk = extracted.pages.slice(i, i + TEXT_CHUNK_PAGES);
        const sent = await storePaperTextChunk({
          projectId,
          fileId,
          pages: chunk,
        });
        if (!sent.ok) {
          await markPaperTextFailed({ projectId, projectWorkId, fileId });
          setError(`${sent.error}`);
          setExtracting(false);
          return;
        }
      }

      const done = await finishPaperText({
        projectId,
        projectWorkId,
        fileId,
        pageCount: extracted.pages.length,
      });

      if (!done.ok) {
        setError(`${done.error}`);
        setExtracting(false);
        return;
      }

      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Text extraction failed.");
      setExtracting(false);
    }
  }

  async function remove() {
    setRemoving(true);
    setError(null);

    const result = await removePaperFile({ projectId, projectWorkId, fileId });

    if (!result.ok) {
      setRemoving(false);
      setConfirming(false);
      setError(result.error);
      return;
    }

    // Left pending: this component is about to be replaced by the upload form,
    // and flipping it back to "Remove" first shows the old state for a frame.
    startTransition(() => router.refresh());
  }

  return (
    <Banner>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <strong>The PDF is attached.</strong> {(sizeBytes / 1_048_576).toFixed(1)} MB,
          added {new Date(uploadedAt).toLocaleDateString()}.
          {hasText
            ? " Its pages are below."
            : " Its text is not available, so the pages cannot be shown."}
        </div>

        {/*
          Two steps, inline, no modal — the same shape as removing a protocol
          question. The second step is where the consequence is stated, because
          that is the moment somebody is deciding.
        */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!hasText && storagePath && !confirming && (
            <Button
              variant="primary"
              onClick={reExtract}
              busy={extracting}
              busyLabel="Reading PDF…"
            >
              Extract text again
            </Button>
          )}

          {confirming ? (
            <>
              <Button
                variant="danger"
                onClick={remove}
                busy={removing}
                busyLabel="Removing…"
              >
                Yes, remove it
              </Button>
              <Button
                variant="ghost"
                onClick={() => setConfirming(false)}
                disabled={removing}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              variant="ghost"
              onClick={() => setConfirming(true)}
              disabled={extracting}
            >
              Remove the PDF
            </Button>
          )}
        </div>
      </div>

      {confirming && (
        <p className="text-fine mt-3">
          The file and its extracted text are deleted from storage.{" "}
          <strong>Highlights and quotes taken from its pages are kept</strong> — they are
          evidence somebody recorded, so removing the file does not unmake them. They will
          report that their passage can no longer be found until you attach the paper
          again.
        </p>
      )}

      {error && (
        <p role="alert" className="text-danger text-fine mt-2">
          {error}
        </p>
      )}
    </Banner>
  );
}

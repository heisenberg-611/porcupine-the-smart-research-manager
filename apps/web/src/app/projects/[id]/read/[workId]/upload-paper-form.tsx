"use client";

import {
  MAX_PAPER_BYTES,
  PAPER_MIME,
  PDF_MAGIC_BYTES,
  describeFileRefusal,
  looksLikePdf,
} from "@Porcupine/shared";
import { useRouter } from "next/navigation";
import { startTransition, useRef, useState } from "react";

import { Banner, Button, Field, FileInput } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

import { beginUpload, completeUpload } from "./file-actions";

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
type Stage = "idle" | "checking" | "uploading" | "finishing";

const LABEL: Record<Stage, string> = {
  idle: "Attach this PDF",
  checking: "Checking the file…",
  uploading: "Uploading…",
  finishing: "Finishing up…",
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

    setStage("idle");

    if (!finished.ok) {
      setError(finished.error);
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

      {/* Stated plainly rather than implied. docs/02-security-and-e2ee.md §7:
          do not claim files are scanned until scanning exists. */}
      <p className="text-muted text-fine">
        Uploaded files are checked for type and size, and are rendered in a sandbox — they
        are not virus-scanned. Treat a PDF you downloaded from an unfamiliar source with
        the same care you would outside this app.
      </p>

      <div>
        <Button type="submit" disabled={busy}>
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

/** Shown once a file is attached, in place of the form. */
export function AttachedPaper({
  sizeBytes,
  uploadedAt,
}: {
  sizeBytes: number;
  uploadedAt: string;
}) {
  return (
    <Banner>
      <strong>The PDF is attached.</strong> {(sizeBytes / 1_048_576).toFixed(1)} MB, added{" "}
      {new Date(uploadedAt).toLocaleDateString()}. Reading it in the app arrives with the
      next stage; for now this is the copy your project shares.
    </Banner>
  );
}

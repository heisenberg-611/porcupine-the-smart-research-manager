"use client";

import { createSelector, type AnchorSelector } from "@porcupine/anchoring";
import { useCallback, useRef, useState, useTransition } from "react";

import { Button, Checkbox, Textarea } from "@/components/ui";

import { createAnnotation, deleteAnnotation } from "./actions";

export interface RenderedAnnotation {
  id: string;
  kind: string;
  body: string | null;
  visibility: string;
  authorName: string;
  isMine: boolean;
  /** Resolved against the CURRENT text on the server. */
  status: "OK" | "DRIFTED" | "BROKEN";
  start: number | null;
  end: number | null;
  quote: string;
  driftReason: string | null;
  similarity: number | null;
}

/**
 * The reading surface.
 *
 * Select text to annotate. Existing annotations are re-resolved server-side
 * against the current text on every render rather than trusting their stored
 * offsets — which is the entire reason the anchoring engine exists. A
 * highlight whose passage has changed is shown with a warning instead of
 * being silently drawn somewhere plausible.
 */
export function ReaderClient({
  projectId,
  projectWorkId,
  text,
  annotations,
}: {
  projectId: string;
  projectWorkId: string;
  text: string;
  annotations: RenderedAnnotation[];
}) {
  const [selection, setSelection] = useState<AnchorSelector | null>(null);
  const [note, setNote] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const textRef = useRef<HTMLDivElement>(null);

  const captureSelection = useCallback(() => {
    const active = window.getSelection();
    if (!active || active.isCollapsed || !textRef.current) {
      setSelection(null);
      return;
    }

    const range = active.getRangeAt(0);
    if (!textRef.current.contains(range.commonAncestorContainer)) return;

    // Offset within the whole passage, not within a text node: the passage is
    // rendered as several nodes once highlights are interleaved, and a
    // node-local offset would be meaningless the moment they change.
    const before = range.cloneRange();
    before.selectNodeContents(textRef.current);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const end = start + range.toString().length;

    if (end - start < 3) {
      setSelection(null);
      return;
    }

    setSelection(createSelector(text, start, end));
  }, [text]);

  function save(kind: "HIGHLIGHT" | "NOTE") {
    if (!selection) return;
    setError(null);
    setStatus(null);

    startTransition(async () => {
      const response = await createAnnotation({
        projectId,
        projectWorkId,
        kind,
        visibility: isPrivate ? "PRIVATE" : "PROJECT",
        body: note.trim() || null,
        selector: {
          quote: selection.quote,
          prefix: selection.prefix ?? null,
          suffix: selection.suffix ?? null,
          startOff: selection.startOff ?? null,
          endOff: selection.endOff ?? null,
        },
      });

      if (response.ok) {
        setStatus(kind === "NOTE" ? "Note saved." : "Highlight saved.");
        setSelection(null);
        setNote("");
        window.getSelection()?.removeAllRanges();
      } else setError(response.error);
    });
  }

  function remove(annotationId: string) {
    setError(null);
    startTransition(async () => {
      const response = await deleteAnnotation({ projectId, projectWorkId, annotationId });
      if (response.ok) setStatus("Annotation deleted.");
      else setError(response.error);
    });
  }

  return (
    <div className="space-y-6">
      <div
        ref={textRef}
        data-testid="reader-text"
        onMouseUp={captureSelection}
        onKeyUp={captureSelection}
        className="border-border bg-surface text-ink/90 rounded-lg border p-5 text-sm leading-relaxed"
      >
        {renderWithHighlights(text, annotations)}
      </div>

      {selection && (
        <div className="border-accent/40 bg-surface space-y-3 rounded-lg border p-4">
          <p className="text-muted text-xs">Selected</p>
          <blockquote className="text-ink border-accent border-l-2 pl-3 text-sm">
            {selection.quote}
          </blockquote>

          <label className="text-muted flex flex-col gap-1 text-xs">
            Note (optional)
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="border-border bg-surface text-ink rounded-lg border p-2 text-sm"
            />
          </label>

          <label className="text-muted flex items-center gap-2 text-xs">
            <Checkbox
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="size-4"
            />
            {/* PRIVATE excludes the project owner too — see the RLS policy. */}
            Private to me — nobody else on the project can read this
          </label>

          <div className="flex gap-2">
            <Button onClick={() => save("HIGHLIGHT")} disabled={pending}>
              Highlight
            </Button>
            <Button
              variant="ghost"
              onClick={() => save("NOTE")}
              disabled={pending || !note.trim()}
            >
              Save note
            </Button>
            <Button variant="ghost" onClick={() => setSelection(null)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div aria-live="polite">
        {status && <p className="text-muted text-sm">{status}</p>}
        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
      </div>

      <section>
        <h2 className="text-ink mb-3 text-lg font-medium">
          Annotations{" "}
          <span className="text-muted font-normal">({annotations.length})</span>
        </h2>

        {annotations.length === 0 ? (
          <p className="text-muted text-sm">
            Select any passage above to highlight it or attach a note.
          </p>
        ) : (
          <ul className="space-y-3">
            {annotations.map((annotation) => (
              <li key={annotation.id} className="border-border rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <blockquote className="border-border text-ink border-l-2 pl-3 text-sm">
                    {annotation.quote}
                  </blockquote>
                  {annotation.isMine && (
                    <Button
                      variant="ghost"
                      onClick={() => remove(annotation.id)}
                      disabled={pending}
                      className="shrink-0 text-xs"
                    >
                      Delete
                    </Button>
                  )}
                </div>

                {annotation.body && (
                  <p className="text-ink/80 mt-2 text-sm">{annotation.body}</p>
                )}

                <p className="text-muted mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span>{annotation.authorName}</span>
                  <span>·</span>
                  <span>{annotation.kind.toLowerCase()}</span>
                  {annotation.visibility === "PRIVATE" && (
                    <>
                      <span>·</span>
                      <span>private</span>
                    </>
                  )}
                </p>

                {/* The whole point of the DRIFTED state: say it, do not hide it. */}
                {annotation.status !== "OK" && (
                  <p
                    className={`mt-2 rounded px-2 py-1 text-xs ${
                      annotation.status === "DRIFTED"
                        ? "bg-accent/10 text-ink"
                        : "bg-danger/10 text-danger"
                    }`}
                  >
                    {annotation.status === "DRIFTED"
                      ? `Possibly moved${
                          annotation.similarity
                            ? ` (${Math.round(annotation.similarity * 100)}% match)`
                            : ""
                        } — ${annotation.driftReason ?? "check the passage"}`
                      : `Lost in this document — ${annotation.driftReason ?? "the passage is gone"}`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Paint resolved highlights into the passage.
 *
 * Only OK and DRIFTED annotations have positions; BROKEN ones are listed
 * below the text and deliberately draw nothing, because there is nowhere
 * honest to draw them.
 */
function renderWithHighlights(text: string, annotations: RenderedAnnotation[]) {
  const spans = annotations
    .filter((a) => a.start !== null && a.end !== null && a.status !== "BROKEN")
    .map((a) => ({ start: a.start!, end: a.end!, drifted: a.status === "DRIFTED" }))
    .sort((a, b) => a.start - b.start);

  if (spans.length === 0) return text;

  const parts: Array<string | { text: string; drifted: boolean }> = [];
  let cursor = 0;

  for (const span of spans) {
    // Overlapping highlights would produce nested marks; the first one wins.
    if (span.start < cursor) continue;
    if (span.start > cursor) parts.push(text.slice(cursor, span.start));
    parts.push({ text: text.slice(span.start, span.end), drifted: span.drifted });
    cursor = span.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));

  return parts.map((part, index) =>
    typeof part === "string" ? (
      <span key={index}>{part}</span>
    ) : (
      <mark
        key={index}
        className={
          part.drifted
            ? "bg-danger/20 text-ink underline decoration-dotted"
            : "bg-accent/25 text-ink"
        }
      >
        {part.text}
      </mark>
    ),
  );
}

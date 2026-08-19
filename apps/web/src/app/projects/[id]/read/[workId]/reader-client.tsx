"use client";

import { createSelector, type AnchorSelector } from "@Porcupine/anchoring";
import { useCallback, useRef, useState, useTransition } from "react";

import { Button, Checkbox, Textarea } from "@/components/ui";
import type { ReaderSection } from "@/lib/reader-document";

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
  /** Which section it resolved in; null when it resolved nowhere. */
  sectionIndex: number | null;
  /** The page it was captured on, for display. Null for an abstract. */
  page: number | null;
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
  sections,
  annotations,
}: {
  projectId: string;
  projectWorkId: string;
  /**
   * The document, in the pieces it is read in: one section for an abstract,
   * one per page for an extracted PDF. Offsets are per-section, which is why
   * an anchor carries a page — a character offset into a 300-page document
   * would be meaningless the moment the extractor changed a ligature.
   */
  sections: ReaderSection[];
  annotations: RenderedAnnotation[];
}) {
  const [selection, setSelection] = useState<AnchorSelector | null>(null);
  const [note, setNote] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const documentRef = useRef<HTMLDivElement>(null);

  const captureSelection = useCallback(() => {
    const active = window.getSelection();
    if (!active || active.isCollapsed || !documentRef.current) {
      setSelection(null);
      return;
    }

    const range = active.getRangeAt(0);
    if (!documentRef.current.contains(range.commonAncestorContainer)) return;

    /*
     * Which page the selection is on, asked of the DOM rather than tracked.
     *
     * A selection can begin in one section and end in another, and character
     * offsets only mean anything within one page's text. Climbing to the
     * nearest section element from where the selection STARTS gives both the
     * page and the string those offsets belong to; a selection dragged across
     * a page boundary is truncated to the page it started on, which is the
     * only interpretation that produces a resolvable anchor.
     */
    const origin =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const host = origin?.closest<HTMLElement>("[data-section-index]");
    if (!host) return;

    const index = Number(host.dataset.sectionIndex);
    const section = sections[index];
    if (!section) return;

    // Offset within the whole section, not within a text node: the passage is
    // rendered as several nodes once highlights are interleaved, and a
    // node-local offset would be meaningless the moment they change.
    const before = range.cloneRange();
    before.selectNodeContents(host);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const end = Math.min(start + range.toString().length, section.text.length);

    if (end - start < 3) {
      setSelection(null);
      return;
    }

    setSelection(createSelector(section.text, start, end, section.page ?? undefined));
  }, [sections]);

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
          page: selection.page ?? null,
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
      <div ref={documentRef} onMouseUp={captureSelection} onKeyUp={captureSelection}>
        {sections.map((section, index) => (
          <div key={section.page ?? "abstract"}>
            {/* Only when there is more than one. A lone "Page 1" above an
                abstract is a label for a distinction nobody is making. */}
            {sections.length > 1 && section.page !== null && (
              <p className="text-muted text-fine border-rule mt-6 border-t pt-4">
                Page {section.page}
              </p>
            )}
            <div
              data-testid="reader-text"
              data-section-index={index}
              className={
                sections.length > 1
                  ? "prose-body py-2"
                  : "prose-body border-rule border-t py-6"
              }
            >
              {renderWithHighlights(
                section.text,
                annotations.filter((a) => a.sectionIndex === index),
              )}
            </div>
          </div>
        ))}
      </div>

      {selection && (
        <div className="border-accent/40 bg-surface space-y-3 rounded-lg border p-4">
          <p className="text-muted text-fine">Selected</p>
          <blockquote className="text-ink border-accent text-ui border-l-2 pl-3">
            {selection.quote}
          </blockquote>

          <label className="text-muted text-fine flex flex-col gap-1">
            Note (optional)
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="border-border bg-surface text-ink text-ui rounded-lg border p-2"
            />
          </label>

          <label className="text-muted text-fine flex items-center gap-2">
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
        {status && <p className="text-muted text-ui">{status}</p>}
        {error && (
          <p role="alert" className="text-danger text-ui">
            {error}
          </p>
        )}
      </div>

      <section>
        <h2 className="text-ink text-heading mb-3 font-medium">
          Annotations{" "}
          <span className="text-muted font-normal">({annotations.length})</span>
        </h2>

        {annotations.length === 0 ? (
          <p className="text-muted text-ui">
            Select any passage above to highlight it or attach a note.
          </p>
        ) : (
          <ul className="space-y-3">
            {annotations.map((annotation) => (
              <li key={annotation.id} className="border-border rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <blockquote className="border-border text-ink text-ui border-l-2 pl-3">
                    {annotation.quote}
                  </blockquote>
                  {annotation.isMine && (
                    <Button
                      variant="ghost"
                      onClick={() => remove(annotation.id)}
                      disabled={pending}
                      className="text-fine shrink-0"
                    >
                      Delete
                    </Button>
                  )}
                </div>

                {annotation.body && (
                  <p className="text-ink/80 text-ui mt-2">{annotation.body}</p>
                )}

                <p className="text-muted text-fine mt-2 flex flex-wrap items-center gap-2">
                  <span>{annotation.authorName}</span>
                  <span>·</span>
                  <span>{annotation.kind.toLowerCase()}</span>
                  {annotation.page !== null && (
                    <>
                      <span>·</span>
                      <span>page {annotation.page}</span>
                    </>
                  )}
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
                    className={`text-fine mt-2 rounded px-2 py-1 ${
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

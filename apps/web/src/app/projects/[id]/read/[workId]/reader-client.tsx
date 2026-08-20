"use client";

import { createSelector, type AnchorSelector } from "@Porcupine/anchoring";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Button, Checkbox, Textarea } from "@/components/ui";
import { PdfDocument, type PdfHighlight } from "@/components/pdf-document";
import { colourFor } from "@/lib/annotation-colour";
import { offsetInPageText } from "@/lib/page-text";
import type { ReaderSection } from "@/lib/reader-document";

import { createAnnotation, deleteAnnotation } from "./actions";

export interface RenderedAnnotation {
  id: string;
  kind: string;
  body: string | null;
  visibility: string;
  authorId: string;
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
const PANEL_WIDTH = 340;
const PANEL_HEIGHT = 268;
const PANEL_MARGIN = 12;

/**
 * Where the compose panel goes for a given selection, in viewport coordinates.
 *
 * Below the passage when there is room and above it when there is not: a
 * selection near the foot of the window would otherwise put the buttons
 * off-screen, which is the original "I have to scroll to the end" complaint in
 * a smaller form.
 */
function placeBeside(range: Range): { top: number; left: number } {
  const rects = Array.from(range.getClientRects());
  const last = rects.at(-1) ?? range.getBoundingClientRect();

  const roomBelow = window.innerHeight - last.bottom;
  const wanted =
    roomBelow > PANEL_HEIGHT
      ? last.bottom + 8
      : Math.max(PANEL_MARGIN, last.top - PANEL_HEIGHT);

  /*
   * Clamped so the whole panel is on screen, not just its top edge.
   *
   * A FIXED element hanging below the fold cannot be scrolled into view —
   * scrolling moves the document under it and the element stays put — so its
   * buttons become permanently unreachable rather than one scroll away. The
   * panel also carries a max-height with its own scrollbar, because
   * PANEL_HEIGHT is an estimate and this must hold when the estimate is wrong.
   */
  const top = Math.max(
    PANEL_MARGIN,
    Math.min(wanted, window.innerHeight - PANEL_HEIGHT - PANEL_MARGIN),
  );

  return {
    top,
    left: Math.max(
      PANEL_MARGIN,
      Math.min(last.left, window.innerWidth - PANEL_WIDTH - PANEL_MARGIN),
    ),
  };
}

export function ReaderClient({
  projectId,
  projectWorkId,
  sections,
  annotations,
  pdfPath,
  focusPage,
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
  /**
   * The attached PDF's object path, when its text has been extracted.
   *
   * Present, the paper is rendered as the paper: canvas pages with pdf.js's
   * text layer over them. Absent — no file, a scan, an interrupted
   * extraction — the same sections are rendered as plain text, which is the
   * only thing there is to render.
   */
  pdfPath: string | null;
  /** Page to open at, when arriving from an evidence cell. */
  focusPage: number | null;
}) {
  const [selection, setSelection] = useState<AnchorSelector | null>(null);
  const [note, setNote] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const documentRef = useRef<HTMLDivElement>(null);
  /*
   * Where to put the compose panel: just under the selection, in VIEWPORT
   * coordinates.
   *
   * It used to sit after the document in normal flow, which on a one-page
   * abstract was fine and on a 300-page PDF meant scrolling to the end of the
   * paper to click Highlight, then scrolling back to carry on reading.
   *
   * The first fix used the document's own coordinates so the panel would
   * travel with the passage. That stopped working when the PDF moved into its
   * own scrolling window: the passage now moves inside a box the panel is not
   * in, so a coordinate measured against the document means nothing a moment
   * later. Fixed positioning does not care which container scrolled.
   *
   * Scrolling re-places it rather than dismissing it. Dismissing was tried
   * and is wrong twice over: a stray wheel nudge while reaching for the button
   * throws the selection away, and Playwright's own scroll-into-view before a
   * click did exactly that, which is how the fault was found.
   */
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  /*
   * Derived once per annotation change, not once per render.
   *
   * Built inline, this array had a new identity on every render — and the
   * reader re-renders on every selection change — so the viewer repainted, and
   * previously rebuilt, the whole document while somebody was dragging over a
   * word.
   */
  /*
   * Follow the passage when anything scrolls.
   *
   * Capture phase and on `document`, because the PDF scrolls inside its own
   * container now and a listener on `window` never hears about it.
   *
   * Only while a live, uncollapsed selection exists: clicking into the note
   * field collapses it, and recomputing from a collapsed range would throw the
   * panel to the top-left corner mid-typing.
   */
  useEffect(() => {
    if (!selection) return;

    const follow = () => {
      const live = window.getSelection();
      if (!live || live.isCollapsed || live.rangeCount === 0) return;
      setAnchor(placeBeside(live.getRangeAt(0)));
    };

    document.addEventListener("scroll", follow, { capture: true, passive: true });
    window.addEventListener("resize", follow, { passive: true });
    return () => {
      document.removeEventListener("scroll", follow, { capture: true });
      window.removeEventListener("resize", follow);
    };
  }, [selection]);

  const pdfHighlights = useMemo<PdfHighlight[]>(
    () =>
      annotations
        .filter(
          (a): a is RenderedAnnotation & { start: number; end: number } =>
            a.sectionIndex !== null &&
            a.start !== null &&
            a.end !== null &&
            a.status !== "BROKEN",
        )
        .map((a) => ({
          id: a.id,
          page: sections[a.sectionIndex!]?.page ?? 1,
          start: a.start,
          end: a.end,
          drifted: a.status === "DRIFTED",
          authorId: a.authorId,
          authorName: a.authorName,
          isPrivate: a.visibility === "PRIVATE",
        })),
    [annotations, sections],
  );

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

    /*
     * Offsets through the shared walker, for both renderings.
     *
     * `Range.toString()` was fine while a section was one text node, and is
     * wrong the moment the section is pdf.js's text layer: that layer marks
     * line breaks with `<br>`, which contributes nothing to `toString()` while
     * the stored page string has a "\n" there. The drift is one character per
     * line, and it would not raise anything — `resolveAnchor` would simply
     * stop hitting its fast path and start guessing between repeated phrases.
     *
     * `offsetInPageText` mirrors `joinPageText`, so both renderings measure
     * against the string the anchor is stored in.
     */
    const start = offsetInPageText(host, range.startContainer, range.startOffset);
    const finish = offsetInPageText(host, range.endContainer, range.endOffset);
    if (start === null || finish === null) return;

    const end = Math.min(finish, section.text.length);

    if (end - start < 3) {
      setSelection(null);
      return;
    }

    setSelection(createSelector(section.text, start, end, section.page ?? undefined));

    /*
     * Anchored to the END of the selection, which is where the pointer let go
     * and so where attention already is.
     *
     * Clamped to the document's width so a passage ending at the right margin
     * does not push the panel off the edge; `getBoundingClientRect` on the
     * whole range covers the multi-line case, where the last rect alone can be
     * a two-character stub.
     */
    setAnchor(placeBeside(range));
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
        setAnchor(null);
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
      <div className="relative">
        <div ref={documentRef} onMouseUp={captureSelection} onKeyUp={captureSelection}>
          {pdfPath ? (
            <PdfDocument
              storagePath={pdfPath}
              pageTexts={sections.map((section) => section.text)}
              highlights={pdfHighlights}
              onSelection={captureSelection}
              focusPage={focusPage}
            />
          ) : (
            sections.map((section, index) => (
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
            ))
          )}
        </div>

        {selection && (
          <div
            data-testid="annotate-panel"
            className="border-accent/40 bg-raised fixed z-40 max-h-[80vh] w-[340px] max-w-[calc(100vw-24px)] space-y-3 overflow-y-auto rounded-lg border p-4 shadow-lg"
            style={{ top: anchor?.top ?? 0, left: anchor?.left ?? 0 }}
          >
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
              <Button
                variant="ghost"
                onClick={() => setSelection(null)}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

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
                  {/* The same colour the mark is drawn in, so the list and the
                      page identify people the same way. */}
                  <span
                    aria-hidden="true"
                    className="inline-block size-2.5 shrink-0 rounded-full"
                    style={{ background: colourFor(annotation.authorId).solid }}
                  />
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

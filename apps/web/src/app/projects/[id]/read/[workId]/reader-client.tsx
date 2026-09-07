"use client";

import { createSelector, type AnchorSelector } from "@Porcupine/anchoring";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Button, Checkbox, Textarea } from "@/components/ui";
import {
  PdfDocument,
  formatAnnotationTime,
  type PdfHighlight,
} from "@/components/pdf-document";
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
  createdAt: string;
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
const PANEL_MARGIN = 12;

/**
 * Where the lightweight floating toolbar or note popover goes for a given selection.
 *
 * Positions centered ABOVE the selection by default so the lines below are never
 * obscured while reading. Flips smoothly below when near the top of the viewport.
 */
function placeBeside(range: Range, isNoteMode = false): { top: number; left: number } {
  const rects = Array.from(range.getClientRects());
  const first = rects[0] ?? range.getBoundingClientRect();
  const last = rects.at(-1) ?? range.getBoundingClientRect();

  const targetWidth = isNoteMode ? 320 : 230;
  const targetHeight = isNoteMode ? 210 : 44;

  // Prefer positioning above the first line of the selection to keep text below visible
  let top = first.top - targetHeight - 8;
  if (top < PANEL_MARGIN) {
    // If near the top edge of viewport, place just below the selection
    top = last.bottom + 8;
  }

  // Center horizontally on the selection
  const midX = (first.left + Math.min(first.right, first.left + 200)) / 2;
  let left = midX - targetWidth / 2;

  // Clamp to viewport
  left = Math.max(PANEL_MARGIN, Math.min(left, window.innerWidth - targetWidth - PANEL_MARGIN));
  top = Math.max(PANEL_MARGIN, Math.min(top, window.innerHeight - targetHeight - PANEL_MARGIN));

  return { top, left };
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
  const router = useRouter();
  const [selection, setSelection] = useState<AnchorSelector | null>(null);
  const [isNoteMode, setIsNoteMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Highlight, Save note and every row's Delete run through one transition,
  // so the busy label needs the name of the action — and deletes need the id
  // of the row, since each annotation has its own Delete.
  const [running, setRunning] = useState<string | null>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  /*
   * Follow the passage when anything scrolls.
   */
  useEffect(() => {
    if (!selection) return;

    const follow = () => {
      const live = window.getSelection();
      if (!live || live.isCollapsed || live.rangeCount === 0) return;
      setAnchor(placeBeside(live.getRangeAt(0), isNoteMode));
    };

    document.addEventListener("scroll", follow, { capture: true, passive: true });
    window.addEventListener("resize", follow, { passive: true });
    return () => {
      document.removeEventListener("scroll", follow, { capture: true });
      window.removeEventListener("resize", follow);
    };
  }, [selection, isNoteMode]);

  // Recalculate anchor when switching between toolbar mode and note mode
  useEffect(() => {
    if (!selection) return;
    const live = window.getSelection();
    if (live && !live.isCollapsed && live.rangeCount > 0) {
      setAnchor(placeBeside(live.getRangeAt(0), isNoteMode));
    }
  }, [isNoteMode, selection]);

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
          body: a.body,
          createdAt: a.createdAt,
          quote: a.quote,
          isMine: a.isMine,
        })),
    [annotations, sections],
  );

  const captureSelection = useCallback(() => {
    const active = window.getSelection();
    if (!active || active.isCollapsed || !documentRef.current) {
      setSelection(null);
      setIsNoteMode(false);
      return;
    }

    const range = active.getRangeAt(0);
    if (!documentRef.current.contains(range.commonAncestorContainer)) return;

    const origin =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const host = origin?.closest<HTMLElement>("[data-section-index]");
    if (!host) return;

    const index = Number(host.dataset.sectionIndex);
    const section = sections[index];
    if (!section) return;

    const start = offsetInPageText(host, range.startContainer, range.startOffset);
    const finish = offsetInPageText(host, range.endContainer, range.endOffset);
    if (start === null || finish === null) return;

    const end = Math.min(finish, section.text.length);

    if (end - start < 3) {
      setSelection(null);
      setIsNoteMode(false);
      return;
    }

    setNote("");
    setIsPrivate(false);
    setIsNoteMode(false);
    setError(null);
    setStatus(null);

    const selector = createSelector(section.text, start, end, section.page ?? undefined);
    setSelection(selector);
    setAnchor(placeBeside(range, false));
  }, [sections]);

  async function save(kind: "HIGHLIGHT" | "NOTE") {
    if (!selection) return;

    setError(null);
    setStatus(null);
    setRunning(kind.toLowerCase());

    const result = await createAnnotation({
      projectId,
      projectWorkId,
      selector: selection,
      kind,
      body: kind === "NOTE" ? note : undefined,
      visibility: isPrivate ? "PRIVATE" : "PROJECT",
    });

    setRunning(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSelection(null);
    setIsNoteMode(false);
    setNote("");
    setStatus("Saved.");
    startTransition(() => {
      router.refresh();
    });
  }

  async function copyQuote() {
    if (!selection?.quote) return;
    try {
      await navigator.clipboard.writeText(selection.quote);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  // Keyboard shortcuts: H = Highlight, N = Note, Esc = Dismiss
  useEffect(() => {
    if (!selection) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "TEXTAREA" || target?.tagName === "INPUT") {
        if (e.key === "Escape") {
          e.preventDefault();
          setIsNoteMode(false);
          setSelection(null);
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setIsNoteMode(false);
        setSelection(null);
      } else if ((e.key === "h" || e.key === "H") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        void save("HIGHLIGHT");
      } else if ((e.key === "n" || e.key === "N") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setIsNoteMode(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selection, isNoteMode, note, isPrivate, projectId, projectWorkId]);

  async function remove(annotationId: string) {
    setError(null);
    setStatus(null);
    setRunning(`remove:${annotationId}`);

    const result = await deleteAnnotation({
      projectId,
      projectWorkId,
      annotationId,
    });

    setRunning(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setStatus("Removed.");
    startTransition(() => {
      router.refresh();
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
              onDeleteHighlight={remove}
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

        {/* ── 2-Tier Annotation System (Mini Floating Toolbar + Focused Note Popover) ── */}
        {selection && (
          <div
            data-testid="annotate-panel"
            className="fixed z-[70] animate-in fade-in zoom-in-95 duration-150"
            style={{ top: anchor?.top ?? 0, left: anchor?.left ?? 0 }}
          >
            {!isNoteMode ? (
              /* Tier 1: Mini Floating Toolbar */
              <div className="bg-raised/95 border-border/80 ring-1 ring-black/10 dark:ring-white/10 shadow-2xl backdrop-blur-md rounded-2xl border p-1 flex items-center gap-1">
                {/* 1-Click Highlight button */}
                <button
                  type="button"
                  onClick={() => save("HIGHLIGHT")}
                  disabled={pending}
                  className="bg-accent text-accent-ink hover:brightness-105 active:scale-95 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50"
                  title="Highlight selected text (H)"
                >
                  <svg className="size-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
                    <path d="M3.5 5.75c0-.69.56-1.25 1.25-1.25H10A.75.75 0 0 0 10 3H4.75A2.75 2.75 0 0 0 2 5.75v9.5A2.75 2.75 0 0 0 4.75 18h9.5A2.75 2.75 0 0 0 17 15.25V10a.75.75 0 0 0-1.5 0v5.25c0 .69-.56 1.25-1.25 1.25h-9.5c-.69 0-1.25-.56-1.25-1.25v-9.5Z" />
                  </svg>
                  <span>{running === "highlight" ? "Saving…" : "Highlight"}</span>
                  <kbd className="bg-black/20 text-accent-ink rounded px-1 py-0.2 text-[9px] font-mono">
                    H
                  </kbd>
                </button>

                {/* Add note button */}
                <button
                  type="button"
                  onClick={() => setIsNoteMode(true)}
                  disabled={pending}
                  className="text-ink hover:bg-surface active:scale-95 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer"
                  title="Add note to selection (N)"
                >
                  <svg className="size-3.5 text-muted" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M10 2c-4.418 0-8 3.134-8 7 0 1.76.743 3.37 1.97 4.6-.097 1.016-.417 2.13-.771 2.966-.079.186.074.394.276.368 1.488-.19 3.003-.81 3.864-1.344.836.266 1.733.41 2.661.41 4.418 0 8-3.134 8-7s-3.582-7-8-7Zm0 12.5c-.808 0-1.591-.122-2.32-.349a.75.75 0 0 0-.64.085c-.672.434-1.749.882-2.853 1.082.262-.756.495-1.637.56-2.45a.75.75 0 0 0-.256-.59C3.473 11.232 3 9.946 3 8.75 3 5.574 6.134 3 10 3s7 2.574 7 5.75-3.134 5.75-7 5.75Z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>Note</span>
                  <kbd className="text-muted bg-surface rounded px-1 py-0.2 text-[9px] font-mono">
                    N
                  </kbd>
                </button>

                {/* Copy quote button */}
                <button
                  type="button"
                  onClick={copyQuote}
                  className="text-muted hover:text-ink hover:bg-surface inline-flex size-7 items-center justify-center rounded-lg transition-colors cursor-pointer"
                  title="Copy selected text"
                  aria-label="Copy quote"
                >
                  {copied ? (
                    <svg className="size-3.5 text-accent" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  ) : (
                    <svg className="size-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12a1.5 1.5 0 0 1 .439 1.061V14.5A1.5 1.5 0 0 1 15.5 16h-7A1.5 1.5 0 0 1 7 14.5v-11Z" />
                      <path d="M5 6a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 18h7a1.5 1.5 0 0 0 1.5-1.5v-.5H7A2.5 2.5 0 0 1 4.5 13.5V6H5Z" />
                    </svg>
                  )}
                </button>

                <span className="bg-border/60 mx-0.5 h-4 w-px" />

                {/* Dismiss button */}
                <button
                  type="button"
                  onClick={() => setSelection(null)}
                  className="text-muted hover:text-ink hover:bg-surface inline-flex size-7 items-center justify-center rounded-lg text-xs transition-colors cursor-pointer"
                  title="Dismiss (Esc)"
                  aria-label="Dismiss selection"
                >
                  ✕
                </button>
              </div>
            ) : (
              /* Tier 2: Compact Focused Note Popover */
              <div className="bg-raised border-border/80 ring-1 ring-black/10 dark:ring-white/10 shadow-2xl backdrop-blur-md flex w-[320px] max-w-[calc(100vw-24px)] flex-col gap-3 rounded-2xl border p-4 animate-in fade-in zoom-in-95 duration-100">
                <div className="flex items-center justify-between">
                  <div className="text-ink flex items-center gap-2 text-xs font-semibold">
                    <span className="bg-accent size-2 rounded-full" />
                    <span>Attach Note</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsNoteMode(false)}
                    className="text-muted hover:text-ink p-1 text-xs"
                    title="Back to toolbar"
                  >
                    ✕
                  </button>
                </div>

                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  autoFocus
                  placeholder="Add note or research insight..."
                  className="min-h-[70px] p-2.5 text-xs"
                />

                <label className="text-muted text-fine flex cursor-pointer select-none items-center gap-2">
                  <Checkbox
                    checked={isPrivate}
                    onChange={(e) => setIsPrivate(e.target.checked)}
                    className="size-3.5"
                  />
                  <span>Private to me — nobody else can read this</span>
                </label>

                {error && (
                  <p role="alert" className="text-danger text-fine">
                    {error}
                  </p>
                )}

                <div className="border-border/60 flex items-center justify-between gap-2 border-t pt-2">
                  <button
                    type="button"
                    onClick={() => setIsNoteMode(false)}
                    className="text-muted hover:text-ink px-2 py-1 text-xs font-medium"
                  >
                    ← Back
                  </button>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setSelection(null);
                        setIsNoteMode(false);
                      }}
                      className="h-8 px-3 text-xs"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => save("NOTE")}
                      disabled={pending || !note.trim()}
                      busy={pending && running === "note"}
                      busyLabel="Saving…"
                      className="h-8 px-4 text-xs font-semibold"
                    >
                      Save Note
                    </Button>
                  </div>
                </div>
              </div>
            )}
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

      {!pdfPath && (
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
                <li
                  key={annotation.id}
                  className="border-border bg-raised/50 rounded-2xl border p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <blockquote className="border-border text-ink text-ui border-l-2 pl-3 italic">
                      {annotation.quote}
                    </blockquote>
                    {annotation.isMine && (
                      <Button
                        variant="ghost"
                        onClick={() => remove(annotation.id)}
                        disabled={pending}
                        busy={pending && running === `remove:${annotation.id}`}
                        busyLabel="Deleting…"
                        className="text-fine shrink-0"
                      >
                        Delete
                      </Button>
                    )}
                  </div>

                  {annotation.body && (
                    <p className="text-ink/90 text-ui bg-surface/60 border-border/50 mt-2.5 rounded-xl border p-2.5 whitespace-pre-wrap">
                      {annotation.body}
                    </p>
                  )}

                  <p className="text-muted text-fine mt-2.5 flex flex-wrap items-center gap-2">
                    {/* The same colour the mark is drawn in, so the list and the
                        page identify people the same way. */}
                    <span
                      aria-hidden="true"
                      className="inline-block size-2.5 shrink-0 rounded-full shadow-sm"
                      style={{ background: colourFor(annotation.authorId).solid }}
                    />
                    <span className="text-ink font-medium">{annotation.authorName}</span>
                    {annotation.createdAt && (
                      <>
                        <span>·</span>
                        <time
                          dateTime={annotation.createdAt}
                          title={new Date(annotation.createdAt).toLocaleString()}
                          className="text-muted"
                        >
                          {formatAnnotationTime(annotation.createdAt).full}
                        </time>
                      </>
                    )}
                    <span>·</span>
                    <span className="capitalize">{annotation.kind.toLowerCase()}</span>
                    {annotation.page !== null && (
                      <>
                        <span>·</span>
                        <span>page {annotation.page}</span>
                      </>
                    )}
                    {annotation.visibility === "PRIVATE" && (
                      <>
                        <span>·</span>
                        <span className="border-border rounded border px-1 py-0.5 text-[10px]">
                          private
                        </span>
                      </>
                    )}
                  </p>

                  {/* The whole point of the DRIFTED state: say it, do not hide it. */}
                  {annotation.status !== "OK" && (
                    <p
                      className={`text-fine mt-2 rounded-lg px-2.5 py-1.5 ${
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
      )}
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

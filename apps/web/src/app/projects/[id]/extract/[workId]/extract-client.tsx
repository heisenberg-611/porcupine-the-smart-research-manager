"use client";

import Link from "next/link";
import { createSelector, type AnchorSelector } from "@Porcupine/anchoring";

import type { ReaderSection } from "@/lib/reader-document";
import { fieldTypeLabel, needsOptions } from "@Porcupine/shared";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  Banner,
  Button,
  Checkbox,
  FormattedText,
  Input,
  Select,
  Textarea,
} from "@/components/ui";

import { reopenExtraction, saveDraft, submitExtraction } from "./actions";

export interface ExtractField {
  id: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  requiresAnchor: boolean;
  helpText: string | null;
  options: string[];
}

export interface ExistingValue {
  fieldId: string;
  value: unknown;
  valueText: string | null;
  quote: string | null;
}

type Answer = { value: unknown; text: string; selector: AnchorSelector | null };

/**
 * The redesigned extraction protocol workspace.
 *
 * Provides a spacious, high-contrast, dual-pane environment for reading papers
 * and answering extraction questions with clear visual hierarchy, large typography,
 * question indices, quote provenance, and quick navigation.
 */
export function ExtractClient({
  projectId,
  projectWorkId,
  extractionId,
  status,
  protocolName,
  sections,
  fields,
  existing,
  pageHeader,
}: {
  projectId: string;
  projectWorkId: string;
  extractionId: string;
  status: string;
  protocolName?: string;
  /**
   * The paper, in the pieces it is quoted from: one section per page of the
   * attached PDF, or a single pageless section for the abstract.
   */
  sections: ReaderSection[];
  fields: ExtractField[];
  existing: ExistingValue[];
  pageHeader: React.ReactNode;
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>(() => {
    const initial: Record<string, Answer> = {};
    for (const value of existing) {
      initial[value.fieldId] = {
        value: value.value,
        text: value.valueText ?? "",
        // The stored passage, kept so re-saving does not drop provenance.
        selector: value.quote ? { quote: value.quote } : null,
      };
    }
    return initial;
  });

  const [capturing, setCapturing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [missing, setMissing] = useState<ExtractField[]>([]);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  // Layout & Filtering state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "unanswered" | "required" | "answered">("all");
  const [viewLayout, setViewLayout] = useState<"split" | "wide-questions" | "focus-paper">("split");
  const [mobileTab, setMobileTab] = useState<"paper" | "questions">("questions");

  // Save and Submit share the transition, so the busy label has to know which
  // of the two was pressed. Cleared by `pending` falling.
  const [running, setRunning] = useState<null | "save" | "submit">(null);
  const textRef = useRef<HTMLDivElement>(null);

  const frozen = status !== "DRAFT";

  /**
   * What counts as answered.
   *
   * Deliberately the same rule the evidence table draws a dash for, so
   * "12 of 20" here and "12/20" there can never disagree. An empty string is
   * a hole: someone typing into a box and deleting it has not answered.
   */
  const isAnswered = useCallback((fieldId: string) => {
    const answer = answers[fieldId];
    if (!answer) return false;
    const { value } = answer;
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }, [answers]);

  const answered = useMemo(
    () => fields.filter((f) => isAnswered(f.id)).length,
    [fields, isAnswered],
  );

  const requiredCount = useMemo(
    () => fields.filter((f) => f.required).length,
    [fields],
  );

  const unansweredCount = useMemo(
    () => fields.length - answered,
    [fields.length, answered],
  );

  const progressPercent = useMemo(
    () => (fields.length > 0 ? Math.round((answered / fields.length) * 100) : 0),
    [answered, fields.length],
  );

  const activeCapturingField = useMemo(
    () => (capturing ? fields.find((f) => f.id === capturing) : null),
    [capturing, fields],
  );

  const filteredFields = useMemo(() => {
    return fields.filter((field) => {
      const fieldAnswered = isAnswered(field.id);
      if (filterMode === "answered" && !fieldAnswered) return false;
      if (filterMode === "unanswered" && fieldAnswered) return false;
      if (filterMode === "required" && (!field.required || fieldAnswered)) return false;

      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        field.label.toLowerCase().includes(q) ||
        (field.helpText && field.helpText.toLowerCase().includes(q)) ||
        field.key.toLowerCase().includes(q)
      );
    });
  }, [fields, filterMode, searchQuery, isAnswered]);

  /**
   * Warn before leaving with unsaved answers.
   */
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const setAnswer = useCallback((fieldId: string, next: Partial<Answer>) => {
    setDirty(true);
    setAnswers((prev) => ({
      ...prev,
      [fieldId]: {
        value: next.value !== undefined ? next.value : (prev[fieldId]?.value ?? null),
        text: next.text !== undefined ? next.text : (prev[fieldId]?.text ?? ""),
        selector:
          next.selector !== undefined ? next.selector : (prev[fieldId]?.selector ?? null),
      },
    }));
  }, []);

  /** Capture the current selection into whichever field asked for it. */
  const capture = useCallback(() => {
    if (!capturing || !textRef.current) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    if (!textRef.current.contains(range.commonAncestorContainer)) return;

    /*
     * Which page the quote is from, asked of the DOM where the selection
     * STARTS. Offsets only mean anything within one page's text.
     */
    const origin =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement;
    const host = origin?.closest<HTMLElement>("[data-section-index]");
    if (!host) return;

    const section = sections[Number(host.dataset.sectionIndex)];
    if (!section) return;

    const before = range.cloneRange();
    before.selectNodeContents(host);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const end = Math.min(start + range.toString().length, section.text.length);
    if (end - start < 3) return;

    const selector = createSelector(section.text, start, end, section.page ?? undefined);
    setAnswer(capturing, { value: selector.quote, text: selector.quote, selector });
    setCapturing(null);
    selection.removeAllRanges();
  }, [capturing, setAnswer, sections]);

  function save() {
    setError(null);
    setNotice(null);
    setRunning("save");
    startTransition(async () => {
      const response = await saveDraft({
        projectId,
        projectWorkId,
        extractionId,
        values: fields.map((field) => {
          const answer = answers[field.id];
          return {
            fieldId: field.id,
            value: answer?.value ?? null,
            valueText: answer?.text ?? null,
            selector:
              answer?.selector && answer.selector.startOff !== undefined
                ? {
                    quote: answer.selector.quote,
                    prefix: answer.selector.prefix ?? null,
                    suffix: answer.selector.suffix ?? null,
                    startOff: answer.selector.startOff ?? null,
                    endOff: answer.selector.endOff ?? null,
                    page: answer.selector.page ?? null,
                  }
                : null,
          };
        }),
      });

      if (response.ok) {
        setNotice(`Saved ${response.data.saved} of ${fields.length}.`);
        setDirty(false);
      } else setError(response.error);
    });
  }

  function submit() {
    setError(null);
    setNotice(null);

    setMissing(fields.filter((f) => f.required && !isAnswered(f.id)));
    setRunning("submit");

    startTransition(async () => {
      const saved = await saveDraft({
        projectId,
        projectWorkId,
        extractionId,
        values: fields.map((field) => {
          const answer = answers[field.id];
          return {
            fieldId: field.id,
            value: answer?.value ?? null,
            valueText: answer?.text ?? null,
            selector:
              answer?.selector && answer.selector.startOff !== undefined
                ? {
                    quote: answer.selector.quote,
                    prefix: answer.selector.prefix ?? null,
                    suffix: answer.selector.suffix ?? null,
                    startOff: answer.selector.startOff ?? null,
                    endOff: answer.selector.endOff ?? null,
                    page: answer.selector.page ?? null,
                  }
                : null,
          };
        }),
      });
      if (!saved.ok) {
        setError(saved.error);
        return;
      }

      const response = await submitExtraction({ projectId, projectWorkId, extractionId });
      if (response.ok) {
        setNotice("Submitted. It is frozen until you reopen it.");
        setDirty(false);
      } else setError(response.error);
    });
  }

  return (
    <div className="flex flex-col gap-6 lg:h-full">
      {/* Sticky top chrome with enhanced progress and view controls */}
      <div className="bg-canvas/95 backdrop-blur-xs sticky top-[calc(var(--app-header-h)+var(--project-nav-h))] z-30 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 pt-6 pb-4 border-b border-border shadow-xs lg:-top-8">
        {pageHeader}

        {/* Progress & Quick Control Toolbar */}
        <div className="mt-6 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex items-center rounded-lg px-2.5 py-1 font-mono text-xs font-bold border ${
                  status === "VERIFIED" || status === "RECONCILED"
                    ? "bg-purple-500/15 border-purple-500/30 text-purple-700 dark:text-purple-300"
                    : status === "SUBMITTED"
                    ? "bg-accent/15 border-accent/30 text-accent"
                    : "bg-surface border-border text-muted"
                }`}
              >
                {status}
              </span>
              {protocolName && (
                <span className="text-muted text-ui font-medium">
                  {protocolName}
                </span>
              )}
            </div>

            {/* Answered Counter & Progress Bar */}
            <div className="flex items-center gap-4 min-w-[16rem]">
              <div className="flex flex-col gap-1 flex-1">
                <div className="flex items-center justify-between text-fine">
                  <p className="text-ink font-semibold tabular-nums" aria-live="polite">
                    {answered} of {fields.length} answered
                    {dirty && <span className="text-accent font-medium"> · unsaved changes</span>}
                  </p>
                  <span className="text-muted font-mono text-xs">{progressPercent}%</span>
                </div>
                <div className="bg-surface/80 border-border/70 h-2 w-full rounded-full border overflow-hidden">
                  <div
                    className="bg-accent h-full rounded-full transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Desktop View Mode Toggles */}
            <div className="hidden lg:flex items-center bg-surface/80 border border-border rounded-xl p-0.5 shadow-2xs">
              <button
                type="button"
                onClick={() => setViewLayout("split")}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                  viewLayout === "split"
                    ? "bg-raised text-ink shadow-xs font-semibold"
                    : "text-muted hover:text-ink"
                }`}
                title="Split 50/50 view"
              >
                Split View
              </button>
              <button
                type="button"
                onClick={() => setViewLayout("wide-questions")}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                  viewLayout === "wide-questions"
                    ? "bg-raised text-ink shadow-xs font-semibold"
                    : "text-muted hover:text-ink"
                }`}
                title="Spacious questions view"
              >
                Questions Focus
              </button>
              <button
                type="button"
                onClick={() => setViewLayout("focus-paper")}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                  viewLayout === "focus-paper"
                    ? "bg-raised text-ink shadow-xs font-semibold"
                    : "text-muted hover:text-ink"
                }`}
                title="Paper reading focus"
              >
                Paper Focus
              </button>
            </div>
          </div>

          {/* Question Filter & Quick Search Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/50">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFilterMode("all")}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition-all ${
                  filterMode === "all"
                    ? "bg-accent text-accent-ink shadow-xs"
                    : "bg-surface/70 text-muted hover:text-ink border border-border/60"
                }`}
              >
                All Questions ({fields.length})
              </button>
              <button
                type="button"
                onClick={() => setFilterMode("unanswered")}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition-all ${
                  filterMode === "unanswered"
                    ? "bg-accent text-accent-ink shadow-xs"
                    : "bg-surface/70 text-muted hover:text-ink border border-border/60"
                }`}
              >
                Unanswered ({unansweredCount})
              </button>
              {requiredCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterMode("required")}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition-all ${
                    filterMode === "required"
                      ? "bg-accent text-accent-ink shadow-xs"
                      : "bg-surface/70 text-muted hover:text-ink border border-border/60"
                  }`}
                >
                  Required Only ({requiredCount})
                </button>
              )}
              <button
                type="button"
                onClick={() => setFilterMode("answered")}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition-all ${
                  filterMode === "answered"
                    ? "bg-accent text-accent-ink shadow-xs"
                    : "bg-surface/70 text-muted hover:text-ink border border-border/60"
                }`}
              >
                Completed ({answered})
              </button>
            </div>

            <div className="flex items-center gap-2 min-w-[14rem] max-w-xs flex-1">
              <Input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Find question..."
                className="h-8 text-xs py-1 px-3"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="text-xs text-muted hover:text-ink font-medium"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Mobile Tab Switcher */}
          <div className="flex lg:hidden rounded-xl bg-surface border border-border p-1 shadow-2xs">
            <button
              type="button"
              onClick={() => setMobileTab("paper")}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
                mobileTab === "paper"
                  ? "bg-raised text-ink shadow-xs font-semibold"
                  : "text-muted"
              }`}
            >
              The Paper ({sections.length} pages)
            </button>
            <button
              type="button"
              onClick={() => setMobileTab("questions")}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
                mobileTab === "questions"
                  ? "bg-raised text-ink shadow-xs font-semibold"
                  : "text-muted"
              }`}
            >
              The Questions ({answered}/{fields.length})
            </button>
          </div>
        </div>
      </div>

      {/* Main Dual-Pane Workspace */}
      <div
        className={`grid gap-8 lg:min-h-0 lg:flex-1 ${
          viewLayout === "wide-questions"
            ? "lg:grid-cols-[0.8fr_1.4fr]"
            : viewLayout === "focus-paper"
            ? "lg:grid-cols-[1.4fr_0.8fr]"
            : "lg:grid-cols-[1.05fr_1.15fr]"
        }`}
      >
        {/* Left Pane: The Paper Document / Source */}
        <section
          className={`space-y-4 lg:overflow-y-auto lg:pr-3 lg:pb-12 ${
            mobileTab === "questions" ? "hidden lg:block" : "block"
          }`}
        >
          <div className="flex items-center justify-between border-b border-border/70 pb-3">
            <h2 className="text-ink text-heading font-semibold tracking-tight">The Paper</h2>
            <span className="text-muted text-fine font-mono">
              {sections.length > 0 ? `${sections.length} section(s)` : "No document text"}
            </span>
          </div>

          {/* Prominent Quote Capturing Alert Banner */}
          {capturing && (
            <div
              role="status"
              className="sticky top-2 z-20 bg-accent text-accent-ink rounded-2xl p-4 shadow-lg flex items-center justify-between gap-3 animate-pulse"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-bold text-xs uppercase tracking-wider text-accent-ink/90">
                  Selecting quote for: {activeCapturingField?.label ?? "Question"}
                </span>
                <p className="text-sm font-medium">
                  Highlight or select any sentence in the paper text below to capture it.
                </p>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCapturing(null)}
                className="shrink-0 text-xs bg-white/20 text-white hover:bg-white/30 border-white/30"
              >
                Cancel
              </Button>
            </div>
          )}

          {sections.length > 0 ? (
            <div
              ref={textRef}
              onMouseUp={capture}
              onKeyUp={capture}
              className={`border border-border/70 bg-raised/70 rounded-2xl p-6 shadow-2xs transition-all ${
                capturing ? "ring-4 ring-accent/30 bg-accent/5 border-accent" : ""
              }`}
            >
              {sections.map((section, index) => (
                <div key={section.page ?? `abstract-${index}`}>
                  {sections.length > 1 && section.page !== null && (
                    <div className="flex items-center gap-3 my-6">
                      <span className="bg-surface border border-border/80 text-muted px-3 py-1 rounded-full font-mono text-xs font-semibold">
                        Page {section.page}
                      </span>
                      <div className="h-px flex-1 bg-border/60" />
                    </div>
                  )}
                  <div
                    data-testid="extract-source"
                    data-section-index={index}
                    className="prose-body py-2 text-ink text-base leading-relaxed selection:bg-accent/25 selection:text-ink font-serif"
                  >
                    {section.text}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-border rounded-2xl p-8 text-center bg-raised/40">
              <p className="text-muted text-ui">
                This record has no abstract and no attached PDF, so there is no text to
                quote from yet.
              </p>
              <Link
                href={`/projects/${projectId}/read/${projectWorkId}`}
                className="text-accent hover:underline font-medium text-sm mt-2 inline-block"
              >
                Attach the paper from the reader &rarr;
              </Link>
            </div>
          )}
        </section>

        {/* Right Pane: Redesigned Protocol Questions Menu */}
        <section
          className={`space-y-6 lg:overflow-y-auto lg:pl-1 lg:pr-2 lg:pb-12 ${
            mobileTab === "paper" ? "hidden lg:block" : "block"
          }`}
        >
          <div className="flex items-center justify-between border-b border-border/70 pb-3">
            <h2 className="text-ink text-heading font-semibold tracking-tight">The Questions</h2>
            <span className="text-muted text-fine font-mono">
              Showing {filteredFields.length} of {fields.length}
            </span>
          </div>

          {missing.length > 0 && (
            <Banner tone="danger">
              <p className="font-semibold text-base">These required fields are still unanswered:</p>
              <ul className="mt-2 list-disc pl-5 space-y-1">
                {missing.map((field) => (
                  <li key={field.id}>
                    <a
                      href={`#field-${field.id}`}
                      className="underline underline-offset-2 font-medium hover:text-danger-ink transition-colors"
                    >
                      {field.label}
                    </a>
                  </li>
                ))}
              </ul>
            </Banner>
          )}

          {frozen && (
            <Banner>
              This extraction is submitted and frozen. Reopen it as a draft to change an
              answer.
            </Banner>
          )}

          {/* Questions Cards List */}
          <div className="space-y-6">
            {filteredFields.length === 0 ? (
              <div className="border border-dashed border-border rounded-2xl p-8 text-center bg-raised/40">
                <p className="text-muted text-ui">No questions match the current filter.</p>
                <button
                  type="button"
                  onClick={() => {
                    setFilterMode("all");
                    setSearchQuery("");
                  }}
                  className="text-accent hover:underline font-medium text-sm mt-2"
                >
                  Reset filters
                </button>
              </div>
            ) : (
              filteredFields.map((field) => {
                const answer = answers[field.id];
                const quoted = field.requiresAnchor || field.type === "QUOTE";
                const answeredState = isAnswered(field.id);
                const fieldIndex = fields.findIndex((f) => f.id === field.id) + 1;
                const isCapturing = capturing === field.id;

                return (
                  <div
                    key={field.id}
                    id={`field-${field.id}`}
                    data-field-key={field.key}
                    className={`border rounded-2xl p-6 shadow-sm transition-all scroll-mt-36 ${
                      isCapturing
                        ? "border-accent ring-2 ring-accent/30 bg-accent/5 shadow-md"
                        : missing.some((m) => m.id === field.id)
                        ? "border-danger ring-2 ring-danger/30 bg-danger/5"
                        : "border-border/80 bg-raised/90 hover:border-border hover:shadow-md"
                    }`}
                  >
                    {/* Header Row: Q# Badge, Type Tag, Required Status */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`font-mono text-xs font-bold px-2.5 py-1 rounded-lg border inline-flex items-center gap-1 shrink-0 ${
                            answeredState
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                              : field.required
                              ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
                              : "bg-surface border-border text-muted"
                          }`}
                        >
                          <span>Q{fieldIndex}</span>
                          {answeredState && <span aria-hidden="true">✓</span>}
                        </span>

                        <span className="bg-surface border border-border/70 text-muted inline-flex items-center rounded-md px-2 py-0.5 font-mono text-[11px] font-medium">
                          {fieldTypeLabel(field.type)}
                        </span>

                        {field.required && (
                          <span className="bg-danger/10 border border-danger/30 text-danger inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold">
                            Required
                          </span>
                        )}

                        {quoted && (
                          <span className="bg-accent/10 border border-accent/30 text-accent inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold">
                            Quotes Paper
                          </span>
                        )}
                      </div>

                      {answeredState && (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium text-xs flex items-center gap-1 shrink-0">
                          <span>Answered</span>
                        </span>
                      )}
                    </div>

                    {/* Question Title / Label */}
                    <label
                      htmlFor={`f-${field.id}`}
                      className="text-ink font-bold text-base sm:text-lg leading-snug tracking-tight block cursor-pointer mt-3"
                    >
                      {field.label}
                      {field.required && (
                        <span className="text-accent ml-1 font-normal text-sm">
                          · required
                        </span>
                      )}
                    </label>

                    {/* Help Text Callout */}
                    {field.helpText && (
                      <div className="mt-3 rounded-xl bg-surface/80 border border-border/60 p-3.5 text-sm text-ink-soft leading-relaxed flex items-start gap-2.5">
                        <span className="text-muted text-base leading-none select-none" aria-hidden="true">
                          ℹ️
                        </span>
                        <p className="flex-1">{field.helpText}</p>
                      </div>
                    )}

                    {/* Question Answer Inputs */}
                    <div className="mt-4">
                      {quoted ? (
                        <div className="space-y-3">
                          {answer?.text ? (
                            <blockquote className="border-l-4 border-accent bg-surface/90 rounded-2xl p-4 text-ink shadow-2xs border-y border-r border-border/60">
                              <div className="flex items-center justify-between text-fine text-muted mb-1 font-mono">
                                <span className="flex items-center gap-1 text-accent font-semibold">
                                  <span>“ Quoted passage:</span>
                                </span>
                                {answer.selector?.page && <span>Page {answer.selector.page}</span>}
                              </div>
                              <p className="italic text-ink font-serif text-[15px] leading-relaxed">
                                {answer.text}
                              </p>
                            </blockquote>
                          ) : (
                            <div className="border border-dashed border-border/70 bg-surface/40 rounded-xl p-4 text-center">
                              <p className="text-muted text-sm italic">
                                Nothing quoted yet. Highlight a passage in the paper on the left.
                              </p>
                            </div>
                          )}

                          {!frozen && (
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <Button
                                type="button"
                                variant={answer?.text ? "secondary" : "primary"}
                                onClick={() => setCapturing(field.id)}
                                disabled={pending || sections.length === 0}
                                className="text-sm font-medium"
                              >
                                {answer?.text ? "Quote a different passage" : "Quote from the paper"}
                              </Button>

                              {!answer?.text && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() =>
                                    setAnswer(field.id, {
                                      value: "Not reported",
                                      text: "Not reported",
                                      selector: null,
                                    })
                                  }
                                  disabled={pending}
                                  className="text-sm"
                                >
                                  Mark as Not reported
                                </Button>
                              )}

                              {answer?.text && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  onClick={() =>
                                    setAnswer(field.id, {
                                      value: null,
                                      text: "",
                                      selector: null,
                                    })
                                  }
                                  disabled={pending}
                                  className="text-sm text-danger hover:text-danger"
                                >
                                  Clear
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <FieldInput
                          field={field}
                          answer={answer}
                          disabled={frozen || pending}
                          onChange={(value, text) => setAnswer(field.id, { value, text })}
                        />
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Action Buttons & Status */}
          <div className="border-t border-border/70 pt-6 mt-8 space-y-4">
            {!frozen ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={save}
                  busy={pending && running === "save"}
                  busyLabel="Saving…"
                  className="px-6"
                >
                  Save draft
                </Button>
                <Button
                  variant="primary"
                  onClick={submit}
                  disabled={pending}
                  busy={pending && running === "submit"}
                  busyLabel="Submitting…"
                  className="px-6"
                >
                  Submit
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                busy={pending}
                busyLabel="Reopening…"
                onClick={() =>
                  startTransition(async () => {
                    const response = await reopenExtraction({
                      projectId,
                      projectWorkId,
                      extractionId,
                    });
                    if (!response.ok) setError(response.error);
                  })
                }
              >
                Reopen as a draft
              </Button>
            )}

            <div aria-live="polite">
              {notice && <p className="text-muted text-ui font-medium">{notice}</p>}
              {error && (
                <p role="alert" className="text-danger text-ui font-medium">
                  {error}
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function applyFormatToElement(
  el: HTMLTextAreaElement | HTMLInputElement,
  prefix: string,
  suffix: string = prefix,
  placeholder = "text",
  onChange: (val: string) => void,
) {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const val = el.value;
  const selected = val.substring(start, end);
  const textToWrap = selected || placeholder;
  const replacement = `${prefix}${textToWrap}${suffix}`;

  const nextVal = val.substring(0, start) + replacement + val.substring(end);
  onChange(nextVal);

  requestAnimationFrame(() => {
    el.focus();
    if (selected) {
      el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    } else {
      el.setSelectionRange(start + prefix.length, start + prefix.length + placeholder.length);
    }
  });
}

function applyPrefixToLines(
  el: HTMLTextAreaElement,
  linePrefix: string,
  onChange: (val: string) => void,
) {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const val = el.value;

  const startOfLine = val.lastIndexOf("\n", start - 1) + 1;
  const endOfLine = val.indexOf("\n", end);
  const actualEnd = endOfLine === -1 ? val.length : endOfLine;

  const selectedLines = val.substring(startOfLine, actualEnd).split("\n");
  const formattedLines = selectedLines.map((line, idx) => {
    const cleanLine = line.replace(/^(\d+[.)]\s*|[*+•-]\s*|>\s*)/, "");
    if (linePrefix === "1. ") {
      return `${idx + 1}. ${cleanLine}`;
    }
    return `${linePrefix}${cleanLine}`;
  });

  const replacement = formattedLines.join("\n");
  const nextVal = val.substring(0, startOfLine) + replacement + val.substring(actualEnd);
  onChange(nextVal);

  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(startOfLine, startOfLine + replacement.length);
  });
}

function applyLinkToElement(
  el: HTMLTextAreaElement | HTMLInputElement,
  onChange: (val: string) => void,
) {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const val = el.value;
  const selected = val.substring(start, end) || "link text";
  const replacement = `[${selected}](https://example.com)`;

  const nextVal = val.substring(0, start) + replacement + val.substring(end);
  onChange(nextVal);

  requestAnimationFrame(() => {
    el.focus();
    const urlStart = start + selected.length + 3;
    const urlEnd = urlStart + "https://example.com".length;
    el.setSelectionRange(urlStart, urlEnd);
  });
}

function handleFormattingKeyDown(
  e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>,
  el: HTMLTextAreaElement | HTMLInputElement | null,
  onChange: (val: string) => void,
) {
  if (!el) return;
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform || "");
  const mod = isMac ? e.metaKey : e.ctrlKey;

  if (mod && !e.shiftKey && !e.altKey) {
    if (e.key === "b" || e.key === "B") {
      e.preventDefault();
      applyFormatToElement(el, "**", "**", "bold text", onChange);
    } else if (e.key === "i" || e.key === "I") {
      e.preventDefault();
      applyFormatToElement(el, "*", "*", "italic text", onChange);
    } else if (e.key === "k" || e.key === "K") {
      e.preventDefault();
      applyLinkToElement(el, onChange);
    } else if (e.key === "`") {
      e.preventDefault();
      applyFormatToElement(el, "`", "`", "code", onChange);
    }
  }
}

/**
 * Rich multiline text box with markdown toolbar, keyboard shortcuts, and live preview.
 */
function FormattedTextareaField({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (value: unknown, text: string) => void;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (disabled) {
    return (
      <div className="border-border/70 bg-surface/60 rounded-2xl border p-4 text-ink text-base shadow-xs">
        {value.trim() ? (
          <FormattedText text={value} />
        ) : (
          <span className="text-muted italic">Not answered</span>
        )}
      </div>
    );
  }

  return (
    <div className="border-border/80 focus-within:border-accent bg-surface/40 flex flex-col overflow-hidden rounded-2xl border shadow-xs transition-colors focus-within:ring-2 focus-within:ring-accent/20">
      {/* Toolbar header */}
      <div className="border-border/60 bg-raised/80 flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            title="Bold (Cmd+B / Ctrl+B)"
            onClick={() =>
              textareaRef.current &&
              applyFormatToElement(
                textareaRef.current,
                "**",
                "**",
                "bold text",
                (t) => onChange(t || null, t),
              )
            }
            className="text-ink hover:bg-surface hover:text-accent focus-visible:ring-accent inline-flex size-7 items-center justify-center rounded-lg text-xs font-bold transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            B
          </button>
          <button
            type="button"
            title="Italic (Cmd+I / Ctrl+I)"
            onClick={() =>
              textareaRef.current &&
              applyFormatToElement(
                textareaRef.current,
                "*",
                "*",
                "italic text",
                (t) => onChange(t || null, t),
              )
            }
            className="text-ink hover:bg-surface hover:text-accent focus-visible:ring-accent inline-flex size-7 items-center justify-center rounded-lg font-serif text-xs italic transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            I
          </button>
          <button
            type="button"
            title="Strikethrough"
            onClick={() =>
              textareaRef.current &&
              applyFormatToElement(
                textareaRef.current,
                "~~",
                "~~",
                "strikethrough",
                (t) => onChange(t || null, t),
              )
            }
            className="text-ink hover:bg-surface hover:text-accent focus-visible:ring-accent inline-flex size-7 items-center justify-center rounded-lg text-xs line-through transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            S
          </button>
          <span className="bg-border/60 mx-1 h-4 w-px" aria-hidden="true" />
          <button
            type="button"
            title="Inline code (Cmd+` / Ctrl+`)"
            onClick={() =>
              textareaRef.current &&
              applyFormatToElement(
                textareaRef.current,
                "`",
                "`",
                "code",
                (t) => onChange(t || null, t),
              )
            }
            className="text-ink hover:bg-surface hover:text-accent focus-visible:ring-accent inline-flex size-7 items-center justify-center rounded-lg font-mono text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            &lt;/&gt;
          </button>
          <button
            type="button"
            title="Link (Cmd+K / Ctrl+K)"
            onClick={() =>
              textareaRef.current &&
              applyLinkToElement(textareaRef.current, (t) =>
                onChange(t || null, t),
              )
            }
            className="text-ink hover:bg-surface hover:text-accent focus-visible:ring-accent inline-flex size-7 items-center justify-center rounded-lg text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            🔗
          </button>
          <span className="bg-border/60 mx-1 h-4 w-px" aria-hidden="true" />
          <button
            type="button"
            title="Bullet list"
            onClick={() =>
              textareaRef.current &&
              applyPrefixToLines(textareaRef.current, "- ", (t) =>
                onChange(t || null, t),
              )
            }
            className="text-ink hover:bg-surface hover:text-accent focus-visible:ring-accent inline-flex size-7 items-center justify-center rounded-lg text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            •
          </button>
          <button
            type="button"
            title="Numbered list"
            onClick={() =>
              textareaRef.current &&
              applyPrefixToLines(textareaRef.current, "1. ", (t) =>
                onChange(t || null, t),
              )
            }
            className="text-ink hover:bg-surface hover:text-accent focus-visible:ring-accent inline-flex size-7 items-center justify-center rounded-lg font-mono text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            1.
          </button>
          <button
            type="button"
            title="Quote"
            onClick={() =>
              textareaRef.current &&
              applyPrefixToLines(textareaRef.current, "> ", (t) =>
                onChange(t || null, t),
              )
            }
            className="text-ink hover:bg-surface hover:text-accent focus-visible:ring-accent inline-flex size-7 items-center justify-center rounded-lg font-serif text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            “
          </button>
        </div>

        {/* Tab switcher: Write / Preview */}
        <div className="bg-surface/80 border-border/70 inline-flex rounded-lg border p-0.5 shadow-2xs">
          <button
            type="button"
            onClick={() => setTab("write")}
            className={cx(
              "focus-visible:ring-accent rounded-md px-2.5 py-1 text-xs font-medium transition-all focus-visible:ring-2 focus-visible:outline-none",
              tab === "write"
                ? "bg-accent text-accent-ink shadow-xs"
                : "text-muted hover:text-ink",
            )}
          >
            Write
          </button>
          <button
            type="button"
            onClick={() => setTab("preview")}
            className={cx(
              "focus-visible:ring-accent rounded-md px-2.5 py-1 text-xs font-medium transition-all focus-visible:ring-2 focus-visible:outline-none",
              tab === "preview"
                ? "bg-accent text-accent-ink shadow-xs"
                : "text-muted hover:text-ink",
            )}
          >
            Preview
          </button>
        </div>
      </div>

      {/* Editor or Preview area */}
      {tab === "write" ? (
        <Textarea
          id={id}
          ref={textareaRef}
          rows={5}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(e.target.value || null, e.target.value)}
          onKeyDown={(e) =>
            handleFormattingKeyDown(e, textareaRef.current, (t) =>
              onChange(t || null, t),
            )
          }
          placeholder="Type markdown or format using toolbar above..."
          className="border-0 bg-transparent text-ink text-base w-full rounded-none px-4 py-3 shadow-none focus:ring-0 focus:outline-none placeholder:text-muted/60 leading-relaxed"
        />
      ) : (
        <div className="min-h-[7.5rem] p-4 text-ink text-base leading-relaxed">
          {value.trim() ? (
            <FormattedText text={value} />
          ) : (
            <p className="text-muted text-fine italic">
              Nothing to preview yet. Switch back to Write to add formatted text.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Short text field with inline formatting helpers, keyboard shortcuts, and live preview.
 */
function FormattedTextField({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (value: unknown, text: string) => void;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (disabled) {
    return (
      <div className="border-border/70 bg-surface/60 rounded-xl border px-4 py-2.5 text-ink text-base shadow-xs">
        {value.trim() ? (
          <FormattedText text={value} />
        ) : (
          <span className="text-muted italic">Not answered</span>
        )}
      </div>
    );
  }

  const hasFormatting =
    value.includes("*") ||
    value.includes("`") ||
    value.includes("[") ||
    value.includes("~");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="border-border/80 focus-within:border-accent bg-surface/40 flex flex-col overflow-hidden rounded-xl border shadow-xs transition-colors focus-within:ring-2 focus-within:ring-accent/20">
        <div className="flex items-center">
          <Input
            id={id}
            ref={inputRef}
            type="text"
            disabled={disabled}
            value={value}
            onChange={(e) => onChange(e.target.value || null, e.target.value)}
            onKeyDown={(e) =>
              handleFormattingKeyDown(e, inputRef.current, (t) =>
                onChange(t || null, t),
              )
            }
            placeholder="Type short text or format with **bold**, *italic*, `code`..."
            className="border-0 bg-transparent text-ink text-base min-h-12 w-full rounded-none px-4 shadow-none focus:ring-0 focus:outline-none placeholder:text-muted/60"
          />

          <div className="flex shrink-0 items-center gap-1 pr-2">
            <button
              type="button"
              title="Bold (Cmd+B / Ctrl+B)"
              onClick={() =>
                inputRef.current &&
                applyFormatToElement(
                  inputRef.current,
                  "**",
                  "**",
                  "bold",
                  (t) => onChange(t || null, t),
                )
              }
              className="text-ink hover:bg-surface hover:text-accent focus-visible:ring-accent inline-flex size-7 items-center justify-center rounded-md text-xs font-bold transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              B
            </button>
            <button
              type="button"
              title="Italic (Cmd+I / Ctrl+I)"
              onClick={() =>
                inputRef.current &&
                applyFormatToElement(
                  inputRef.current,
                  "*",
                  "*",
                  "italic",
                  (t) => onChange(t || null, t),
                )
              }
              className="text-ink hover:bg-surface hover:text-accent focus-visible:ring-accent inline-flex size-7 items-center justify-center rounded-md font-serif text-xs italic transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              I
            </button>
            <button
              type="button"
              title="Inline code (Cmd+` / Ctrl+`)"
              onClick={() =>
                inputRef.current &&
                applyFormatToElement(
                  inputRef.current,
                  "`",
                  "`",
                  "code",
                  (t) => onChange(t || null, t),
                )
              }
              className="text-ink hover:bg-surface hover:text-accent focus-visible:ring-accent inline-flex size-7 items-center justify-center rounded-md font-mono text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              &lt;&gt;
            </button>
            <button
              type="button"
              title="Link (Cmd+K / Ctrl+K)"
              onClick={() =>
                inputRef.current &&
                applyLinkToElement(inputRef.current, (t) =>
                  onChange(t || null, t),
                )
              }
              className="text-ink hover:bg-surface hover:text-accent focus-visible:ring-accent inline-flex size-7 items-center justify-center rounded-md text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              🔗
            </button>
            {hasFormatting && (
              <button
                type="button"
                title={showPreview ? "Hide preview" : "Show formatted preview"}
                onClick={() => setShowPreview((v) => !v)}
                className={cx(
                  "focus-visible:ring-accent ml-1 rounded-md px-2 py-1 text-xs font-medium transition-all focus-visible:ring-2 focus-visible:outline-none",
                  showPreview
                    ? "bg-accent text-accent-ink"
                    : "text-muted hover:text-ink bg-surface/70 border border-border/50",
                )}
              >
                {showPreview ? "Edit" : "Preview"}
              </button>
            )}
          </div>
        </div>
      </div>

      {showPreview && hasFormatting && (
        <div className="border-border/60 bg-surface/70 text-ink text-sm rounded-xl border px-3.5 py-2 shadow-2xs">
          <span className="text-muted text-fine block mb-0.5">Preview:</span>
          <FormattedText text={value} />
        </div>
      )}
    </div>
  );
}

/**
 * The right control for the declared type.
 */
function FieldInput({
  field,
  answer,
  disabled,
  onChange,
}: {
  field: ExtractField;
  answer: Answer | undefined;
  disabled: boolean;
  onChange: (value: unknown, text: string) => void;
}) {
  const id = `f-${field.id}`;

  if (field.type === "BOOLEAN") {
    return (
      <label className="text-ink text-base font-medium flex items-center gap-3 p-3 bg-surface/40 hover:bg-surface/80 rounded-xl border border-border/50 cursor-pointer transition-colors">
        <Checkbox
          id={id}
          checked={answer?.value === true}
          disabled={disabled}
          onChange={(e) =>
            onChange(e.target.checked || null, e.target.checked ? "yes" : "")
          }
          className="size-5"
        />
        <span>Yes / True</span>
      </label>
    );
  }

  if (field.type === "LONG_TEXT") {
    return (
      <FormattedTextareaField
        id={id}
        value={answer?.text ?? ""}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  if (needsOptions(field.type)) {
    if (field.type === "MULTI_ENUM") {
      const chosen = Array.isArray(answer?.value) ? (answer.value as string[]) : [];
      return (
        <div className="space-y-2">
          {field.options.map((option) => (
            <label
              key={option}
              className="text-ink text-base flex items-center gap-3 p-3 bg-surface/40 hover:bg-surface/80 rounded-xl border border-border/50 cursor-pointer transition-colors"
            >
              <Checkbox
                checked={chosen.includes(option)}
                disabled={disabled}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...chosen, option]
                    : chosen.filter((c) => c !== option);
                  onChange(next.length > 0 ? next : null, next.join(", "));
                }}
                className="size-5"
              />
              <span className="font-medium">{option}</span>
            </label>
          ))}
        </div>
      );
    }

    return (
      <Select
        id={id}
        disabled={disabled}
        value={typeof answer?.value === "string" ? answer.value : ""}
        onChange={(e) => onChange(e.target.value || null, e.target.value)}
        className="min-h-12 text-base px-4"
      >
        <option value="">Select an option...</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    );
  }

  if (field.type === "TEXT" || !field.type) {
    return (
      <FormattedTextField
        id={id}
        value={answer?.text ?? ""}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  const inputType =
    field.type === "NUMBER"
      ? "number"
      : field.type === "DATE"
        ? "date"
        : field.type === "URL"
          ? "url"
          : "text";

  return (
    <Input
      id={id}
      type={inputType}
      disabled={disabled}
      value={answer?.text ?? ""}
      onChange={(e) => {
        const raw = e.target.value;
        if (!raw) return onChange(null, "");
        const value = field.type === "NUMBER" ? Number(raw) : raw;
        onChange(Number.isNaN(value as number) ? null : value, raw);
      }}
      placeholder={`Enter ${field.label.toLowerCase()}...`}
      className="min-h-12 text-base px-4"
    />
  );
}

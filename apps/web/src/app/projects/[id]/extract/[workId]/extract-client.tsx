"use client";

import { createSelector, type AnchorSelector } from "@Porcupine/anchoring";

import type { ReaderSection } from "@/lib/reader-document";
import { fieldTypeLabel, needsOptions } from "@Porcupine/shared";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Banner, Button, Checkbox, Input, Select, Textarea } from "@/components/ui";

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
 * The protocol form.
 *
 * The paper and the questions sit side by side, because the alternative is
 * scrolling between them once per field and this happens once per paper in a
 * corpus of three hundred.
 *
 * Fields that demand a quoted passage cannot be typed into. You select the
 * sentence in the paper and it becomes the answer — which is the difference
 * between a claim and a citation, and the reason the database refuses those
 * values without an anchor rather than accepting them and flagging them
 * later.
 */
export function ExtractClient({
  projectId,
  projectWorkId,
  extractionId,
  status,
  sections,
  fields,
  existing,
  pageHeader,
}: {
  projectId: string;
  projectWorkId: string;
  extractionId: string;
  status: string;
  /**
   * The paper, in the pieces it is quoted from: one section per page of the
   * attached PDF, or a single pageless section for the abstract. Loaded by the
   * same helper the reader uses, so a quote captured here resolves against
   * exactly the text somebody following the evidence cell will see.
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

  // Save and Submit share the transition, so the busy label has to know which
  // of the two was pressed — otherwise submitting makes "Save draft" claim to
  // be saving. Cleared by `pending` falling, never by hand.
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
  const isAnswered = (fieldId: string) => {
    const answer = answers[fieldId];
    if (!answer) return false;
    const { value } = answer;
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  };

  const answered = fields.filter((f) => isAnswered(f.id)).length;

  /**
   * Warn before leaving with unsaved answers.
   *
   * This form does not autosave, which is a defensible choice — a half-typed
   * number should not become a recorded answer — but it means a closed tab
   * loses everything typed since the last save. Twenty fields against a paper
   * is twenty minutes of reading, and nothing on screen said the work was
   * only in the browser.
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
     * STARTS. Offsets only mean anything within one page's text, so a
     * selection dragged across a page break is truncated to the page it began
     * on — the only reading that produces an anchor that can be resolved.
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
            // Only send a selector that was captured in this session; the
            // server keeps the stored one otherwise.
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

    /*
     * Work out which required fields are empty, and SHOW them — but do not
     * refuse here.
     *
     * The first version returned early when anything was missing, which felt
     * obviously right and quietly broke something important: `submitExtraction`
     * is where that rule actually lives, it is enforced in the server action
     * rather than by a trigger, and the only thing proving it was the e2e
     * assertion that a submission with a hole comes back refused. A client
     * check that short-circuits the request makes the server rule untested
     * and, eventually, untrue.
     *
     * So the server stays the gate and stays the message. What this adds is
     * the part the server cannot give: EVERY missing field at once, each one a
     * link to itself, rather than one name at a time on a twenty-field form.
     */
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
    <div className="flex flex-col gap-4 lg:h-full">
      <div className="bg-canvas sticky top-[calc(var(--app-header-h)+var(--project-nav-h))] z-30 -mx-6 px-6 pt-8 pb-4 lg:-top-8">
        {pageHeader}
        <div className="border-rule mt-8 grid gap-8 border-b pb-2 lg:grid-cols-[1fr_1fr]">
          <h2 className="text-ink text-heading">The paper</h2>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 className="text-ink text-heading">The questions</h2>
            {/* How far through this paper you are. Twenty fields is long enough
                that "am I nearly done" is a real question, and the answer was
                only available by scrolling and counting. */}
            <p className="text-muted text-fine tabular-nums" aria-live="polite">
              {answered} of {fields.length} answered
              {dirty && <span className="text-accent"> · unsaved changes</span>}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_1fr]">
        <section className="lg:overflow-y-auto lg:pr-2 lg:pb-8">
          {sections.length > 0 ? (
            <div
              ref={textRef}
              onMouseUp={capture}
              onKeyUp={capture}
              className={
                capturing ? "ring-accent bg-accent-soft/40 rounded-2xl px-4 py-2 ring-2 transition-all" : ""
              }
            >
              {sections.map((section, index) => (
                <div key={section.page ?? "abstract"}>
                  {sections.length > 1 && section.page !== null && (
                    <p className="text-muted text-fine border-rule mt-4 border-t pt-3">
                      Page {section.page}
                    </p>
                  )}
                  <div
                    data-testid="extract-source"
                    data-section-index={index}
                    className="prose-body border-rule py-4"
                  >
                    {section.text}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted text-ui mt-3">
              This record has no abstract and no attached PDF, so there is no text to
              quote from yet. Attach the paper from the reader and its pages appear here.
            </p>
          )}

          {capturing && (
            <p role="status" className="text-accent text-ui mt-3">
              Select the sentence in the text above.{" "}
              <button
                type="button"
                onClick={() => setCapturing(null)}
                className="underline underline-offset-2"
              >
                Cancel
              </button>
            </p>
          )}
        </section>

        <section className="space-y-6 lg:overflow-y-auto lg:pr-2 lg:pb-8">
          {missing.length > 0 && (
            <Banner tone="danger">
              <p className="font-medium">These required fields are still empty:</p>
              <ul className="mt-1 list-disc pl-5">
                {missing.map((field) => (
                  <li key={field.id}>
                    {/* A link to the field, not just its name. On a twenty-field
                      form, naming a field the reader then has to hunt for is
                      most of the work left undone. */}
                    <a
                      href={`#field-${field.id}`}
                      className="underline underline-offset-2"
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
              answer — the change is deliberate, not forbidden.
            </Banner>
          )}

          <div className="space-y-6">
            {fields.map((field) => {
              const answer = answers[field.id];
              const quoted = field.requiresAnchor || field.type === "QUOTE";

              return (
                <div
                  key={field.id}
                  id={`field-${field.id}`}
                  // The field's stable key, so a test — or anything else —
                  // can address one question on a twenty-question form
                  // without depending on the surrounding DOM shape.
                  data-field-key={field.key}
                  className={`border-border/70 bg-raised/70 rounded-2xl border p-5 shadow-xs scroll-mt-32 ${
                    missing.some((m) => m.id === field.id)
                      ? "border-danger ring-1 ring-danger/40"
                      : ""
                  }`}
                >
                  <label
                    htmlFor={`f-${field.id}`}
                    className="text-ink text-ui block font-semibold"
                  >
                    {field.label}
                    {field.required && <span className="text-accent"> · required</span>}
                  </label>

                  <p className="meta mt-0.5">
                    {fieldTypeLabel(field.type)}
                    {quoted && " · answered by quoting the paper"}
                  </p>

                  {field.helpText && (
                    <p className="text-muted measure text-fine mt-1 text-pretty">
                      {field.helpText}
                    </p>
                  )}

                  <div className="mt-3">
                    {quoted ? (
                      <div className="space-y-2">
                        {answer?.text ? (
                          <blockquote className="border-accent bg-surface/80 rounded-r-xl border-l-4 p-3 text-ink text-ui shadow-xs">
                            {answer.text}
                          </blockquote>
                        ) : (
                          <p className="text-muted text-fine italic">
                            Nothing quoted yet.
                          </p>
                        )}

                        {!frozen && (
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => setCapturing(field.id)}
                              disabled={pending || sections.length === 0}
                            >
                              {answer?.text
                                ? "Quote a different passage"
                                : "Quote from the paper"}
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
            })}
          </div>

          {!frozen ? (
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={save}
                busy={pending && running === "save"}
                busyLabel="Saving…"
              >
                Save draft
              </Button>
              <Button
                variant="ghost"
                onClick={submit}
                disabled={pending}
                busy={pending && running === "submit"}
                busyLabel="Submitting…"
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
            {notice && <p className="text-muted text-ui">{notice}</p>}
            {error && (
              <p role="alert" className="text-danger text-ui">
                {error}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * The right control for the declared type.
 *
 * A number field that accepts text is a column that cannot be averaged, and
 * the evidence table sorts and filters server-side — so the type is not
 * decoration, it is what makes the column usable.
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
      <label className="text-ink text-ui flex items-center gap-2">
        <Checkbox
          id={id}
          checked={answer?.value === true}
          disabled={disabled}
          onChange={(e) =>
            onChange(e.target.checked || null, e.target.checked ? "yes" : "")
          }
        />
        Yes
      </label>
    );
  }

  if (field.type === "LONG_TEXT") {
    return (
      <Textarea
        id={id}
        rows={4}
        disabled={disabled}
        value={answer?.text ?? ""}
        onChange={(e) => onChange(e.target.value || null, e.target.value)}
      />
    );
  }

  if (needsOptions(field.type)) {
    if (field.type === "MULTI_ENUM") {
      const chosen = Array.isArray(answer?.value) ? (answer.value as string[]) : [];
      return (
        <div className="space-y-1">
          {field.options.map((option) => (
            <label key={option} className="text-ink text-ui flex items-center gap-2">
              <Checkbox
                checked={chosen.includes(option)}
                disabled={disabled}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...chosen, option]
                    : chosen.filter((c) => c !== option);
                  onChange(next.length > 0 ? next : null, next.join(", "));
                }}
              />
              {option}
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
      >
        <option value="">Not answered</option>
        {field.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
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
        // Numbers are stored as numbers so the evidence table can sort and
        // average them; storing "412" as a string makes the column useless.
        const value = field.type === "NUMBER" ? Number(raw) : raw;
        onChange(Number.isNaN(value as number) ? null : value, raw);
      }}
    />
  );
}

"use client";

import { createSelector, type AnchorSelector } from "@porcupine/anchoring";
import { fieldTypeLabel, needsOptions } from "@porcupine/shared";
import { useCallback, useRef, useState, useTransition } from "react";

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
 * The extraction form.
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
  text,
  fields,
  existing,
}: {
  projectId: string;
  projectWorkId: string;
  extractionId: string;
  status: string;
  text: string;
  fields: ExtractField[];
  existing: ExistingValue[];
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
  const [pending, startTransition] = useTransition();
  const textRef = useRef<HTMLDivElement>(null);

  const frozen = status !== "DRAFT";

  const setAnswer = useCallback((fieldId: string, next: Partial<Answer>) => {
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

    const before = range.cloneRange();
    before.selectNodeContents(textRef.current);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const end = start + range.toString().length;
    if (end - start < 3) return;

    const selector = createSelector(text, start, end);
    setAnswer(capturing, { value: selector.quote, text: selector.quote, selector });
    setCapturing(null);
    selection.removeAllRanges();
  }, [capturing, setAnswer, text]);

  function save() {
    setError(null);
    setNotice(null);
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
                  }
                : null,
          };
        }),
      });

      if (response.ok) setNotice(`Saved ${response.data.saved} of ${fields.length}.`);
      else setError(response.error);
    });
  }

  function submit() {
    setError(null);
    setNotice(null);
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
      if (response.ok) setNotice("Submitted. It is frozen until you reopen it.");
      else setError(response.error);
    });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
      {/* The paper. Sticky so it stays put while the questions scroll. */}
      <section className="lg:sticky lg:top-20 lg:self-start">
        <h2 className="text-ink text-heading">The paper</h2>
        {text ? (
          <div
            ref={textRef}
            data-testid="extract-source"
            onMouseUp={capture}
            onKeyUp={capture}
            className={`prose-body border-rule mt-3 max-h-[70vh] overflow-y-auto border-t py-4 ${
              capturing ? "ring-accent bg-accent-soft/40 rounded px-3 ring-2" : ""
            }`}
          >
            {text}
          </div>
        ) : (
          <p className="text-muted text-ui mt-3">
            This record has no abstract, so there is no text to quote from yet.
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

      <section className="space-y-6">
        <h2 className="text-ink text-heading">The questions</h2>

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
              <div key={field.id} className="border-rule border-b pb-5 last:border-b-0">
                <label
                  htmlFor={`f-${field.id}`}
                  className="text-ink text-ui block font-medium"
                >
                  {field.label}
                  {field.required && <span className="text-muted"> · required</span>}
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
                        <blockquote className="border-accent text-ink text-ui border-l-2 pl-3">
                          {answer.text}
                        </blockquote>
                      ) : (
                        <p className="text-muted text-fine italic">Nothing quoted yet.</p>
                      )}

                      {!frozen && (
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => setCapturing(field.id)}
                            disabled={pending || !text}
                          >
                            {answer?.text
                              ? "Quote a different passage"
                              : "Quote from the paper"}
                          </Button>
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
            <Button onClick={save} disabled={pending}>
              {pending ? "Saving…" : "Save draft"}
            </Button>
            <Button variant="ghost" onClick={submit} disabled={pending}>
              Submit
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            disabled={pending}
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

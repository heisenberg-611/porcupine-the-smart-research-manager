"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";

import { Banner, Button, Card, Field, Input, Textarea } from "@/components/ui";
import {
  parseQuestionsInput,
  splitKeywords,
  type ParsedQuestionItem,
} from "@/lib/question-parser";

import {
  addQuestion,
  addQuestionsBulk,
  deleteQuestion,
  updateQuestion,
  type QuestionRow,
} from "./actions";

/**
 * What this review is asking, in the reviewer's own words.
 *
 * Two fields per question and no more: the question, and the words a paper
 * would use if it answered it. The second is the one that does work — search
 * scores every result against these keywords, and the "Matched:" chip on a
 * result is built from the ones that hit. A question with no keywords is a
 * note to self; a question with keywords changes what the search returns.
 *
 * Supports both single-entry addition and Vercel-style bulk copy-paste (.env /
 * multi-line text / numbered lists) with instant live parsing and preview.
 */
export function QuestionsClient({
  projectId,
  initial,
  canEdit,
}: {
  projectId: string;
  initial: QuestionRow[];
  canEdit: boolean;
}) {
  const [questions, setQuestions] = useState<QuestionRow[]>(initial);
  const [mode, setMode] = useState<"single" | "bulk">("single");

  // Single mode state
  const [text, setText] = useState("");
  const [keywords, setKeywords] = useState("");
  const [pasteDetectedCount, setPasteDetectedCount] = useState<number | null>(null);

  // Bulk mode state
  const [bulkRaw, setBulkRaw] = useState("");
  const [previewQuestions, setPreviewQuestions] = useState<ParsedQuestionItem[]>([]);
  const [showFormatHelp, setShowFormatHelp] = useState(false);

  // Edit / Delete state
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<string | null>(null);

  // Keep preview in sync with bulk raw input, unless manually modified
  useEffect(() => {
    if (mode === "bulk") {
      const parsed = parseQuestionsInput(bulkRaw);
      setPreviewQuestions(parsed);
    }
  }, [bulkRaw, mode]);

  // Check if pasted into single form is multi-line
  function handleSingleTextChange(val: string) {
    setText(val);
    if (val.includes("\n") || (val.includes("=") && val.length > 20)) {
      const parsed = parseQuestionsInput(val);
      if (parsed.length > 1) {
        setPasteDetectedCount(parsed.length);
        return;
      }
    }
    setPasteDetectedCount(null);
  }

  function switchToBulkWithText() {
    setBulkRaw(text);
    setText("");
    setPasteDetectedCount(null);
    setMode("bulk");
  }

  function onAddSingle(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setRunning("add");

    startTransition(async () => {
      const response = await addQuestion({
        projectId,
        text,
        keywords: splitKeywords(keywords),
      });

      if (!response.ok) {
        setError(response.error);
        return;
      }

      setQuestions((current) => [...current, response.data]);
      setText("");
      setKeywords("");
      setPasteDetectedCount(null);
    });
  }

  function onAddBulk(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (previewQuestions.length === 0) {
      setError("No valid questions detected. Paste your questions or .env text above.");
      return;
    }

    setRunning("bulk");

    startTransition(async () => {
      const response = await addQuestionsBulk({
        projectId,
        questions: previewQuestions,
      });

      if (!response.ok) {
        setError(response.error);
        return;
      }

      setQuestions((current) => [...current, ...response.data]);
      setSuccessMessage(`Successfully added ${response.data.length} research questions.`);
      setBulkRaw("");
      setPreviewQuestions([]);
      setMode("single");
    });
  }

  function onDelete(questionId: string) {
    setError(null);
    setSuccessMessage(null);
    setRunning(`remove:${questionId}`);
    startTransition(async () => {
      const response = await deleteQuestion({ projectId, questionId });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setQuestions((current) => current.filter((q) => q.id !== questionId));
    });
  }

  function onSave(question: QuestionRow, nextText: string, nextKeywords: string) {
    setError(null);
    setSuccessMessage(null);
    setRunning("save");
    startTransition(async () => {
      const response = await updateQuestion({
        projectId,
        questionId: question.id,
        text: nextText,
        keywords: splitKeywords(nextKeywords),
      });

      if (!response.ok) {
        setError(response.error);
        return;
      }

      setQuestions((current) =>
        current.map((q) => (q.id === question.id ? response.data : q)),
      );
      setEditing(null);
    });
  }

  function removePreviewItem(index: number) {
    setPreviewQuestions((curr) => curr.filter((_, i) => i !== index));
  }

  const totalKeywords = useMemo(
    () => questions.reduce((sum, q) => sum + q.keywords.length, 0),
    [questions],
  );

  return (
    <div className="flex flex-col gap-6">
      {error && <Banner tone="danger">{error}</Banner>}
      {successMessage && <Banner tone="info">{successMessage}</Banner>}

      {questions.length === 0 ? (
        <Card className="flex flex-col gap-2">
          <p className="text-ink text-ui font-medium">
            This project has no research questions yet.
          </p>
          <p className="text-muted text-fine text-pretty">
            Until it does, searching ranks results by citation count alone — it has
            nothing to rank them against, and every result says it matched nothing.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {questions.map((question, index) => (
            <li key={question.id}>
              <Card className="flex flex-col gap-3">
                {editing === question.id ? (
                  <EditForm
                    question={question}
                    pending={pending}
                    saving={pending && running === "save"}
                    onCancel={() => setEditing(null)}
                    onSave={(t, k) => onSave(question, t, k)}
                  />
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-4">
                      <p className="text-ink text-ui">
                        <span className="text-muted mr-2 font-mono">{index + 1}</span>
                        {question.text}
                      </p>
                      {canEdit && (
                        <span className="flex shrink-0 gap-2">
                          <Button
                            variant="ghost"
                            className="border-border border"
                            onClick={() => setEditing(question.id)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={pending}
                            busy={pending && running === `remove:${question.id}`}
                            busyLabel="Removing…"
                            onClick={() => onDelete(question.id)}
                            aria-label={`Remove question ${index + 1}`}
                          >
                            Remove
                          </Button>
                        </span>
                      )}
                    </div>

                    {question.keywords.length > 0 ? (
                      <ul className="flex flex-wrap gap-1.5">
                        {question.keywords.map((keyword) => (
                          <li
                            key={keyword}
                            className="bg-accent/10 text-accent ring-accent/20 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition-colors ring-inset"
                          >
                            {keyword}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted text-fine">
                        No keywords, so this question does not affect search ranking yet.
                      </p>
                    )}
                  </>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {questions.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-muted text-fine">
            {totalKeywords} {totalKeywords === 1 ? "keyword" : "keywords"} across{" "}
            {questions.length} {questions.length === 1 ? "question" : "questions"}.{" "}
            <Link
              href={`/projects/${projectId}/search`}
              className="text-accent hover:text-ink underline underline-offset-4 transition-colors"
            >
              Search with them
            </Link>
            .
          </p>
          <p className="text-muted text-fine">
            Finished with your questions?{" "}
            <Link
              href={`/projects/${projectId}/protocol`}
              className="text-accent hover:text-ink underline underline-offset-4 transition-colors"
            >
              Build your protocol
            </Link>{" "}
            based on what you want to record.
          </p>
        </div>
      )}

      {canEdit && (
        <div className="from-ui/5 to-surface ring-border relative mt-6 rounded-2xl border-t border-white/5 bg-gradient-to-br p-6 shadow-sm ring-1">
          {/* Section Header & Mode Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-4">
            <div>
              <h2 className="text-ink text-heading font-medium">Add questions</h2>
              <p className="text-muted text-fine mt-0.5">
                {mode === "single"
                  ? "Add questions one by one with keywords."
                  : "Paste multiple questions or .env key-values at once."}
              </p>
            </div>

            {/* Segmented control tabs */}
            <div className="bg-surface/80 border-border inline-flex rounded-xl border p-1 shadow-inner">
              <button
                type="button"
                onClick={() => setMode("single")}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all ${
                  mode === "single"
                    ? "bg-accent text-accent-ink shadow-xs"
                    : "text-muted hover:text-ink"
                }`}
              >
                Single Question
              </button>
              <button
                type="button"
                onClick={() => setMode("bulk")}
                className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all ${
                  mode === "bulk"
                    ? "bg-accent text-accent-ink shadow-xs"
                    : "text-muted hover:text-ink"
                }`}
              >
                <span>Bulk Paste</span>
                <span className="bg-white/20 rounded px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider">
                  .env
                </span>
              </button>
            </div>
          </div>

          {/* Mode 1: Single Question Form */}
          {mode === "single" && (
            <form onSubmit={onAddSingle} className="relative z-10 mt-5 flex flex-col gap-4">
              {pasteDetectedCount !== null && (
                <div className="bg-accent/10 border-accent/30 text-ink flex items-center justify-between rounded-xl border p-3 text-xs">
                  <span>
                    📋 <strong>{pasteDetectedCount} questions</strong> detected in your clipboard!
                  </span>
                  <button
                    type="button"
                    onClick={switchToBulkWithText}
                    className="text-accent hover:text-ink font-semibold underline underline-offset-2"
                  >
                    Switch to Bulk Import →
                  </button>
                </div>
              )}

              <Field
                label="Question"
                id="question-text"
                hint="One question. If it has an “and” in it, it is probably two."
              >
                <Textarea
                  id="question-text"
                  value={text}
                  onChange={(e) => handleSingleTextChange(e.target.value)}
                  required
                  rows={2}
                  placeholder="Does spaced repetition improve retention in medical education?"
                />
              </Field>

              <Field
                label="Keywords"
                id="question-keywords"
                hint="Comma-separated. The words a paper would use if it answered this — these are what search ranks against."
              >
                <Input
                  id="question-keywords"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="spaced repetition, retention, medical education"
                />
              </Field>

              <div className="flex items-center justify-between pt-2">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!text.trim()}
                  busy={pending && running === "add"}
                  busyLabel="Adding…"
                >
                  Add question
                </Button>

                <button
                  type="button"
                  onClick={() => setMode("bulk")}
                  className="text-muted hover:text-ink text-xs underline underline-offset-4 transition-colors"
                >
                  Have multiple? Paste in bulk →
                </button>
              </div>
            </form>
          )}

          {/* Mode 2: Bulk Paste Form (.env / Vercel style) */}
          {mode === "bulk" && (
            <form onSubmit={onAddBulk} className="relative z-10 mt-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <label htmlFor="bulk-raw" className="text-ink text-ui font-medium">
                  Paste .env or multi-line questions
                </label>
                <button
                  type="button"
                  onClick={() => setShowFormatHelp((v) => !v)}
                  className="text-accent hover:text-ink text-xs font-medium underline underline-offset-2 transition-colors"
                >
                  {showFormatHelp ? "Hide format examples" : "View supported formats"}
                </button>
              </div>

              {showFormatHelp && (
                <div className="bg-canvas/50 border-border text-muted rounded-xl border p-4 text-xs">
                  <p className="text-ink mb-2 font-medium">
                    Supported formats (copy and paste directly):
                  </p>
                  <ul className="flex flex-col gap-1.5 font-mono text-[11px]">
                    <li>
                      <span className="text-accent font-semibold">1. .env format:</span>{" "}
                      <code className="text-ink bg-surface rounded px-1">
                        RQ1=&quot;Does spaced repetition improve retention?&quot;
                      </code>
                    </li>
                    <li>
                      <span className="text-accent font-semibold">2. Key = Keywords:</span>{" "}
                      <code className="text-ink bg-surface rounded px-1">
                        What is the effect of X? = spaced repetition, retention
                      </code>
                    </li>
                    <li>
                      <span className="text-accent font-semibold">3. Pipe / Markdown table:</span>{" "}
                      <code className="text-ink bg-surface rounded px-1">
                        | 1. What is the efficacy of flashcards? | `flashcards`, `efficacy` |
                      </code>
                    </li>
                    <li>
                      <span className="text-accent font-semibold">4. Plain lines:</span>{" "}
                      <code className="text-ink bg-surface rounded px-1">
                        Does spaced repetition improve retention?
                      </code>
                    </li>
                  </ul>
                </div>
              )}

              <Textarea
                id="bulk-raw"
                value={bulkRaw}
                onChange={(e) => setBulkRaw(e.target.value)}
                rows={6}
                className="font-mono text-xs leading-relaxed"
                placeholder={`# Paste .env variables, markdown tables, lists, or raw questions:
RQ1="Does spaced repetition improve retention in medical education?"
| **2. What is the comparative efficacy of digital flashcards?** | \`flashcards\`, \`digital learning\` |
3. How does feedback frequency affect clinical reasoning? = feedback frequency, reasoning`}
              />

              {/* Live parser preview */}
              {previewQuestions.length > 0 && (
                <div className="flex flex-col gap-3 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="bg-accent/15 text-accent ring-accent/30 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                      {previewQuestions.length}{" "}
                      {previewQuestions.length === 1 ? "question" : "questions"} ready to import
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setBulkRaw("");
                        setPreviewQuestions([]);
                      }}
                      className="text-muted hover:text-danger text-xs transition-colors"
                    >
                      Clear all
                    </button>
                  </div>

                  <div className="border-border bg-canvas/30 max-h-64 overflow-y-auto rounded-xl border p-3">
                    <ul className="flex flex-col gap-2.5">
                      {previewQuestions.map((item, idx) => (
                        <li
                          key={`${idx}-${item.text.slice(0, 20)}`}
                          className="bg-surface border-border/80 flex items-start justify-between gap-3 rounded-lg border p-2.5 shadow-xs"
                        >
                          <div className="flex flex-1 flex-col gap-1.5">
                            <p className="text-ink text-xs font-medium">
                              <span className="text-muted mr-1.5 font-mono">{idx + 1}.</span>
                              {item.text}
                            </p>
                            {item.keywords.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {item.keywords.map((kw) => (
                                  <span
                                    key={kw}
                                    className="bg-accent/10 text-accent rounded-md px-1.5 py-0.5 text-[10px] font-medium"
                                  >
                                    {kw}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted text-[10px] italic">
                                No keywords parsed (optional)
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => removePreviewItem(idx)}
                            className="text-muted hover:text-danger shrink-0 p-1 text-xs transition-colors"
                            title="Remove from import"
                          >
                            ✕
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={previewQuestions.length === 0}
                  busy={pending && running === "bulk"}
                  busyLabel={`Importing ${previewQuestions.length} questions…`}
                >
                  Import {previewQuestions.length > 0 ? `${previewQuestions.length} ` : ""}Questions
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setMode("single");
                    setBulkRaw("");
                    setPreviewQuestions([]);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function EditForm({
  question,
  pending,
  saving,
  onCancel,
  onSave,
}: {
  question: QuestionRow;
  pending: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (text: string, keywords: string) => void;
}) {
  const [text, setText] = useState(question.text);
  const [keywords, setKeywords] = useState(question.keywords.join(", "));

  return (
    <div className="flex flex-col gap-3">
      <Field label="Question" id={`edit-text-${question.id}`}>
        <Textarea
          id={`edit-text-${question.id}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
        />
      </Field>
      <Field label="Keywords" id={`edit-keywords-${question.id}`}>
        <Input
          id={`edit-keywords-${question.id}`}
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
        />
      </Field>
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={pending || !text.trim()}
          busy={saving}
          busyLabel="Saving…"
          onClick={() => onSave(text, keywords)}
        >
          Save
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

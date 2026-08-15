"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Banner, Button, Card, Field, Input, Textarea } from "@/components/ui";

import { addQuestion, deleteQuestion, updateQuestion, type QuestionRow } from "./actions";

/**
 * What this review is asking, in the reviewer's own words.
 *
 * Two fields per question and no more: the question, and the words a paper
 * would use if it answered it. The second is the one that does work — search
 * scores every result against these keywords, and the "Matched:" chip on a
 * result is built from the ones that hit. A question with no keywords is a
 * note to self; a question with keywords changes what the search returns.
 *
 * Said on the screen rather than assumed, because the connection is invisible:
 * nothing about typing a sentence here suggests it will reorder a search two
 * screens away.
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
  const [text, setText] = useState("");
  const [keywords, setKeywords] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onAdd(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

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
    });
  }

  function onDelete(questionId: string) {
    setError(null);
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

  const totalKeywords = questions.reduce((sum, q) => sum + q.keywords.length, 0);

  return (
    <div className="flex flex-col gap-6">
      {error && <Banner tone="danger">{error}</Banner>}

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
                            className="bg-accent-soft text-accent text-fine rounded-full px-2 py-0.5"
                          >
                            {keyword}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      // Not silent about it: a question with no keywords looks
                      // finished and does nothing.
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
        <p className="text-muted text-fine">
          {totalKeywords} {totalKeywords === 1 ? "keyword" : "keywords"} across{" "}
          {questions.length} {questions.length === 1 ? "question" : "questions"}.{" "}
          <Link
            href={`/projects/${projectId}/search`}
            className="text-accent underline underline-offset-4"
          >
            Search with them
          </Link>
          .
        </p>
      )}

      {canEdit && (
        <form
          onSubmit={onAdd}
          className="border-border flex flex-col gap-4 border-t pt-6"
        >
          <h2 className="text-ink text-heading font-medium">Add a question</h2>

          <Field
            label="Question"
            id="question-text"
            hint="One question. If it has an “and” in it, it is probably two."
          >
            <Textarea
              id="question-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
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

          <Button type="submit" variant="primary" disabled={pending || !text.trim()}>
            {pending ? "Adding…" : "Add question"}
          </Button>
        </form>
      )}
    </div>
  );
}

function EditForm({
  question,
  pending,
  onCancel,
  onSave,
}: {
  question: QuestionRow;
  pending: boolean;
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

/** Commas, because that is what people type. Newlines too, because they paste. */
function splitKeywords(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter(Boolean);
}

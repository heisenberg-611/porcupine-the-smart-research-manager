"use client";

import { useState, useTransition } from "react";

import { Button, Field, Textarea } from "@/components/ui";

import { commitImport, previewImport, type ImportPreview } from "./actions";

const FORMAT_LABEL: Record<string, string> = {
  bibtex: "BibTeX",
  ris: "RIS",
  identifiers: "DOIs and arXiv ids",
};

/**
 * Import is a two-step flow on purpose.
 *
 * It is the operation users are most nervous about: a bad paste that
 * silently adds 200 wrong papers to a shared corpus is worse than one that
 * adds nothing. Showing the parsed list first turns it into a decision
 * rather than a gamble — and the format is detected rather than asked for,
 * because plenty of people have a file from a supervisor and no idea what
 * produced it.
 */
export function ImportClient({ projectId }: { projectId: string }) {
  const [source, setSource] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onPreview(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setOutcome(null);

    startTransition(async () => {
      const response = await previewImport({ projectId, source });
      if (response.ok) setPreview(response.data);
      else {
        setError(response.error);
        setPreview(null);
      }
    });
  }

  function onCommit() {
    setError(null);
    startTransition(async () => {
      const response = await commitImport({ projectId, source });
      if (response.ok) {
        const { added, alreadyPresent } = response.data;
        setOutcome(
          `Added ${added} ${added === 1 ? "paper" : "papers"}` +
            (alreadyPresent > 0
              ? `; ${alreadyPresent} were already in the library.`
              : "."),
        );
        setPreview(null);
        setSource("");
      } else setError(response.error);
    });
  }

  return (
    <section className="mt-6 space-y-6">
      <div className="from-ui/5 to-surface ring-border relative rounded-xl border-t border-white/5 bg-gradient-to-br p-6 shadow-sm ring-1">
        <form onSubmit={onPreview} className="relative z-10 space-y-4">
          <Field
            label="Paste references"
            id="source"
            hint="BibTeX, RIS, or a list of DOIs and arXiv ids. The format is detected automatically."
          >
            <Textarea
              id="source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              required
              rows={10}
              className="border-border bg-surface text-ink text-ui w-full rounded-xl border p-4 font-mono shadow-sm"
            />
          </Field>

          <Button type="submit" disabled={pending || !source.trim()}>
            {pending ? "Reading…" : "Preview"}
          </Button>
        </form>
      </div>

      <div aria-live="polite" className="space-y-4">
        {error && (
          <p role="alert" className="text-danger text-ui">
            {error}
          </p>
        )}

        {outcome && <p className="text-ink text-ui font-medium">{outcome}</p>}

        {preview && (
          <div className="space-y-4">
            <p className="text-muted text-ui">
              Read as{" "}
              <strong className="text-ink">
                {FORMAT_LABEL[preview.format] ?? preview.format}
              </strong>
              {" · "}
              {preview.works.length} {preview.works.length === 1 ? "paper" : "papers"}{" "}
              after merging duplicates
            </p>

            {preview.problems.length > 0 && (
              <details className="border-border bg-surface text-ui rounded-lg border p-3">
                <summary className="text-ink cursor-pointer font-medium">
                  {preview.problems.length}{" "}
                  {preview.problems.length === 1 ? "entry" : "entries"} could not be read
                </summary>
                {/* Named individually: "3 entries failed" is not actionable,
                    and the whole point of skipping rather than rejecting is
                    that the user can go fix the ones that matter. */}
                <ul className="text-muted mt-2 space-y-1">
                  {preview.problems.map((problem, index) => (
                    <li key={index}>{problem}</li>
                  ))}
                </ul>
              </details>
            )}

            {preview.works.length > 0 && (
              <>
                {/* Named, so it can be addressed. It used to be found as "the
                    first list on the page", which stopped being true the day
                    the project nav — itself a list — was added above it. An
                    accessible name is both the fix and the thing that should
                    have been there anyway. */}
                <ul
                  aria-label="References to import"
                  className="border-border divide-border divide-y rounded-lg border"
                >
                  {preview.works.map((work, index) => (
                    <li key={index} className="p-3">
                      <p className="text-ink text-ui font-medium">{work.title}</p>
                      <p className="text-muted text-fine mt-0.5">
                        {work.authors || "Unknown authors"}
                        {work.venue && ` · ${work.venue}`}
                        {work.year && ` · ${work.year}`}
                        {work.doi && ` · doi:${work.doi}`}
                        {!work.doi && work.arxivId && ` · arXiv:${work.arxivId}`}
                      </p>
                    </li>
                  ))}
                </ul>

                <Button onClick={onCommit} disabled={pending}>
                  {pending
                    ? "Adding…"
                    : `Add ${preview.works.length} ${preview.works.length === 1 ? "paper" : "papers"}`}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

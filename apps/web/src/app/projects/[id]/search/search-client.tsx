"use client";

import type { ScoredWork } from "@porcupine/discovery";
import { useState, useTransition } from "react";

import { Button, Field } from "@/components/ui";

import { addWorkToProject, searchWorks, type SearchResults } from "./actions";

/**
 * The search surface.
 *
 * Two things here are deliberate and easy to get wrong:
 *
 *   1. Provider failures are shown as a NOTE beside the results, never as an
 *      error state that replaces them. Five providers means five chances for
 *      one to be down; a user searching their thesis topic wants the four
 *      sets that came back.
 *
 *   2. Every result explains why it ranked where it did. A researcher who
 *      cannot say why a paper surfaced cannot defend their search strategy in
 *      a methods section, and a systematic review lives on that defence.
 */
export function SearchClient({
  projectId,
  hasQuestions,
}: {
  projectId: string;
  hasQuestions: boolean;
}) {
  const [terms, setTerms] = useState("");
  const [fromYear, setFromYear] = useState("");
  const [toYear, setToYear] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const response = await searchWorks({
        projectId,
        terms,
        ...(fromYear ? { fromYear: Number(fromYear) } : {}),
        ...(toYear ? { toYear: Number(toYear) } : {}),
      });

      if (response.ok) setResults(response.data);
      else {
        setError(response.error);
        setResults(null);
      }
    });
  }

  return (
    <section className="space-y-6">
      <form onSubmit={onSubmit} className="space-y-4" aria-describedby="search-help">
        <Field
          label="Search terms"
          id="terms"
          hint="Searches five bibliographic databases at once."
        >
          {/* `required` only, deliberately no `minLength`. Native constraint
              bubbles are not reliably announced by screen readers and vanish
              on the next interaction, so length validation happens server-side
              and reports through the aria-live region below — which is the
              same path every other error takes. */}
          <input
            id="terms"
            name="terms"
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            required
            className="border-border bg-surface text-ink min-h-11 w-full rounded-lg border px-3"
          />
        </Field>

        <div className="flex gap-4">
          <Field label="From year" id="fromYear">
            <input
              id="fromYear"
              type="number"
              inputMode="numeric"
              min={1400}
              max={2200}
              value={fromYear}
              onChange={(e) => setFromYear(e.target.value)}
              className="border-border bg-surface text-ink min-h-11 w-32 rounded-lg border px-3"
            />
          </Field>
          <Field label="To year" id="toYear">
            <input
              id="toYear"
              type="number"
              inputMode="numeric"
              min={1400}
              max={2200}
              value={toYear}
              onChange={(e) => setToYear(e.target.value)}
              className="border-border bg-surface text-ink min-h-11 w-32 rounded-lg border px-3"
            />
          </Field>
        </div>

        <Button type="submit" disabled={pending}>
          {pending ? "Searching…" : "Search"}
        </Button>
      </form>

      <p id="search-help" className="text-muted text-sm">
        {hasQuestions
          ? "Results are ranked against this project's research questions."
          : "Add research questions to this project and results will be ranked against them."}
      </p>

      {/* aria-live so a screen reader hears the outcome without moving focus,
          which would lose the user's place in the form. */}
      <div aria-live="polite" className="space-y-4">
        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}

        {results && (
          <>
            {results.failures.length > 0 && (
              <div className="border-border bg-surface rounded-lg border p-3 text-sm">
                <p className="text-ink font-medium">Some sources did not respond</p>
                <ul className="text-muted mt-1 space-y-0.5">
                  {results.failures.map((failure) => (
                    <li key={failure.provider}>
                      <strong>{failure.provider}</strong>: {failure.message}
                    </li>
                  ))}
                </ul>
                <p className="text-muted mt-2">
                  The results below are from the sources that did respond.
                </p>
              </div>
            )}

            <p className="text-muted text-sm">
              {results.ranked.length} {results.ranked.length === 1 ? "result" : "results"}{" "}
              after merging duplicates across sources.
            </p>

            <ul className="space-y-3">
              {results.ranked.map((scored) => (
                <ResultCard
                  key={identityOf(scored)}
                  scored={scored}
                  projectId={projectId}
                  alreadyAdded={results.alreadyAdded.some((id) =>
                    [
                      scored.work.doi,
                      scored.work.arxivId,
                      scored.work.openalexId,
                      scored.work.pmid,
                    ].includes(id),
                  )}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function identityOf(scored: ScoredWork): string {
  const { doi, arxivId, openalexId, pmid, title } = scored.work;
  return doi ?? arxivId ?? openalexId ?? pmid ?? title;
}

function ResultCard({
  scored,
  projectId,
  alreadyAdded,
}: {
  scored: ScoredWork;
  projectId: string;
  alreadyAdded: boolean;
}) {
  const [added, setAdded] = useState(alreadyAdded);
  const [failed, setFailed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const { work, signals, matched } = scored;
  const authors = work.authors
    .slice(0, 3)
    .map((a) => a.name)
    .join(", ");
  const more = work.authors.length > 3 ? ` +${work.authors.length - 3}` : "";

  function onAdd() {
    setFailed(null);
    startTransition(async () => {
      const response = await addWorkToProject({
        projectId,
        work: {
          doi: work.doi,
          arxivId: work.arxivId,
          openalexId: work.openalexId,
          pmid: work.pmid,
          title: work.title,
          abstract: work.abstract,
          authors: work.authors,
          venue: work.venue,
          publishedYear: work.publishedYear,
          publishedOn: work.publishedOn,
          type: work.type,
          language: work.language,
          oaStatus: work.oaStatus,
          oaPdfUrl: work.oaPdfUrl,
          citedByCount: work.citedByCount,
          referencedWorks: work.referencedWorks,
        },
      });

      if (response.ok) setAdded(true);
      else setFailed(response.error);
    });
  }

  return (
    <li className="border-border bg-surface rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-ink font-medium">{work.title}</h3>
          <p className="text-muted mt-1 text-sm">
            {authors}
            {more}
            {work.venue && ` · ${work.venue}`}
            {work.publishedYear && ` · ${work.publishedYear}`}
          </p>
        </div>

        <Button
          variant={added ? "ghost" : "primary"}
          onClick={onAdd}
          disabled={added || pending}
        >
          {added ? "In library" : pending ? "Adding…" : "Add"}
        </Button>
      </div>

      {work.abstract && (
        <p className="text-muted mt-2 line-clamp-3 text-sm">{work.abstract}</p>
      )}

      <div className="text-muted mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {/* The "why is this here?" affordance. Without it the ranking is a
            black box, and a black box cannot go in a methods section. */}
        {matched.length > 0 && (
          <span>
            Matched: <strong className="text-ink">{matched.join(", ")}</strong>
          </span>
        )}
        {work.citedByCount > 0 && (
          <span>{work.citedByCount.toLocaleString()} citations</span>
        )}
        {work.oaPdfUrl && <span className="text-accent">Open access</span>}
        {signals.titleMatch > 0 && <span>title match</span>}
        {work.doi && <span className="truncate">doi:{work.doi}</span>}
      </div>

      {failed && (
        <p role="alert" className="text-danger mt-2 text-sm">
          {failed}
        </p>
      )}
    </li>
  );
}

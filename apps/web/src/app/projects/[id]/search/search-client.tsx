"use client";

import type { ScoredWork } from "@porcupine/discovery";
import { useRef, useState, useTransition } from "react";

import { Button, Field, Input, Skeleton } from "@/components/ui";

import { addWorkToProject, searchWorks, type SearchResults } from "./actions";

/**
 * The search surface.
 *
 * Three things here are deliberate and easy to get wrong:
 *
 *   1. Provider failures are shown as a NOTE beside the results, never as an
 *      error state that replaces them. Five providers means five chances for
 *      one to be down; a user searching their thesis topic wants the four
 *      sets that came back.
 *
 *   2. Every result explains why it ranked where it did. A researcher who
 *      cannot say why a paper surfaced cannot defend their search strategy in
 *      a methods section, and a systematic review lives on that defence.
 *
 *   3. Nothing is a blank rectangle while it waits. The previous version's
 *      only feedback was the button reading "Searching…", for a request that
 *      fans out to five external APIs and routinely takes several seconds —
 *      long enough that people pressed it again.
 */
export function SearchClient({
  projectId,
  hasQuestions,
  suggestions,
}: {
  projectId: string;
  hasQuestions: boolean;
  /** Keywords from this project's research questions. */
  suggestions: string[];
}) {
  const [terms, setTerms] = useState("");
  const [fromYear, setFromYear] = useState("");
  const [toYear, setToYear] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searched, setSearched] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  function run(query: string) {
    setError(null);
    setSearched(query);

    startTransition(async () => {
      const response = await searchWorks({
        projectId,
        terms: query,
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

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    run(terms);
  }

  /** Add a keyword to the query rather than replacing it, then search. */
  function addTerm(keyword: string) {
    const next = terms.trim() ? `${terms.trim()} ${keyword}` : keyword;
    setTerms(next);
    input.current?.focus();
  }

  return (
    <section className="flex flex-col gap-6">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {/* The query and its button on one line, which is what a search bar
            is. They were stacked before, with the button below a pair of year
            fields — so the primary action sat third in the reading order,
            under two inputs almost nobody fills in. */}
        <Field
          label="Search terms"
          id="terms"
          hint="Searches OpenAlex, Crossref, arXiv, Europe PMC and Semantic Scholar at once."
        >
          <div className="flex gap-2">
            {/* `required` only, deliberately no `minLength`. Native constraint
                bubbles are not reliably announced by screen readers and vanish
                on the next interaction, so length validation happens
                server-side and reports through the aria-live region below —
                the same path every other error takes. */}
            <Input
              id="terms"
              name="terms"
              ref={input}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              required
              autoComplete="off"
              placeholder="e.g. spaced repetition medical education"
              className="border-border bg-raised text-ink text-ui min-h-11 w-full flex-1 rounded-lg border px-3"
            />
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Searching…" : "Search"}
            </Button>
          </div>
        </Field>

        {/* Years are a refinement, so they sit below the query in a quieter
            row rather than between it and the button. */}
        <div className="flex flex-wrap items-end gap-4">
          <Field label="From year" id="fromYear">
            <Input
              id="fromYear"
              type="number"
              inputMode="numeric"
              min={1400}
              max={2200}
              placeholder="Any"
              value={fromYear}
              onChange={(e) => setFromYear(e.target.value)}
              className="border-border bg-raised text-ink text-ui min-h-11 w-28 rounded-lg border px-3"
            />
          </Field>
          <Field label="To year" id="toYear">
            <Input
              id="toYear"
              type="number"
              inputMode="numeric"
              min={1400}
              max={2200}
              placeholder="Any"
              value={toYear}
              onChange={(e) => setToYear(e.target.value)}
              className="border-border bg-raised text-ink text-ui min-h-11 w-28 rounded-lg border px-3"
            />
          </Field>
        </div>
      </form>

      {/* Terms lifted straight from the project's own research questions.
          Staring at an empty search box is the hardest moment on this page,
          and the project already said what it is about. */}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-muted text-fine">From your questions:</span>
          {suggestions.map((keyword) => (
            <button
              key={keyword}
              type="button"
              onClick={() => addTerm(keyword)}
              className="border-rule text-muted hover:border-border hover:text-ink hover:bg-surface focus-visible:ring-accent text-fine inline-flex min-h-8 items-center rounded-full border px-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              + {keyword}
            </button>
          ))}
        </div>
      )}

      <p id="search-help" className="text-muted text-fine">
        {hasQuestions
          ? "Results are ranked against this project's research questions."
          : "Add research questions to this project and results will be ranked against them."}
      </p>

      {/* aria-live so a screen reader hears the outcome without moving focus,
          which would lose the user's place in the form. */}
      <div aria-live="polite" className="flex flex-col gap-4">
        {error && (
          <p role="alert" className="text-danger text-ui">
            {error}
          </p>
        )}

        {pending && <ResultsSkeleton />}

        {!pending && results && (
          <>
            {results.failures.length > 0 && (
              <div className="border-border bg-surface text-ui rounded-lg border p-3">
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

            {results.ranked.length === 0 ? (
              <div className="border-rule rounded-[--radius-card] border border-dashed p-8 text-center">
                <p className="text-ink text-ui font-medium">
                  Nothing matched “{searched}”.
                </p>
                <p className="text-muted text-fine mx-auto mt-1 max-w-sm text-pretty">
                  Try fewer words, or the words an author would put in a title. Year
                  filters narrow this further — clear them if they are set.
                </p>
              </div>
            ) : (
              <>
                <p className="text-muted text-ui">
                  {results.ranked.length}{" "}
                  {results.ranked.length === 1 ? "result" : "results"} after merging
                  duplicates across sources.
                </p>

                <ul className="flex flex-col gap-3">
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
          </>
        )}

        {!pending && !results && !error && (
          <div className="border-rule rounded-[--radius-card] border border-dashed p-8 text-center">
            <p className="text-ink text-ui font-medium">
              Five databases, one search box.
            </p>
            <p className="text-muted text-fine mx-auto mt-1 max-w-md text-pretty">
              Records describing the same paper are merged, so a DOI that appears in three
              of them arrives here once. Nothing is added to your library until you say
              so.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/** Result-shaped placeholders, so the page keeps its geometry while it waits. */
function ResultsSkeleton() {
  return (
    <ul className="flex flex-col gap-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <li key={i} className="border-rule rounded-[--radius-card] border p-4">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="mt-2 h-4 w-1/2" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-1 h-4 w-5/6" />
        </li>
      ))}
    </ul>
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
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();

  const { work, signals, matched } = scored;
  const authors = work.authors
    .slice(0, 3)
    .map((a) => a.name)
    .join(", ");
  const more = work.authors.length > 3 ? ` +${work.authors.length - 3}` : "";
  const link = work.doi
    ? `https://doi.org/${work.doi}`
    : (work.oaPdfUrl ?? (work.arxivId ? `https://arxiv.org/abs/${work.arxivId}` : null));

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
    <li
      className={cx(
        "rounded-[--radius-card] border p-4 transition-colors",
        // An added paper stays in the list rather than vanishing — you are
        // reading a ranking, and having rows disappear underneath you loses
        // your place. It just stops looking like something to act on.
        added ? "border-rule bg-surface/40" : "border-border bg-raised",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-ink leading-snug font-medium text-pretty">
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent underline-offset-4 hover:underline"
              >
                {work.title}
              </a>
            ) : (
              work.title
            )}
          </h3>
          <p className="meta mt-1">
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
          // "Add" alone repeats forty times down the page and tells a screen
          // reader nothing about which one it is on.
          aria-label={added ? `${work.title} is in your library` : `Add ${work.title}`}
        >
          {added ? "In library" : pending ? "Adding…" : "Add"}
        </Button>
      </div>

      {work.abstract && (
        <>
          <p
            className={cx(
              "text-ink-soft text-ui mt-2 text-pretty",
              !expanded && "line-clamp-3",
            )}
          >
            {work.abstract}
          </p>
          {/* Screening starts here, not on the screening page: deciding
              whether a result is worth adding is exactly the moment someone
              needs more than three lines. */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="text-accent text-fine focus-visible:ring-accent mt-1 rounded underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            {expanded ? "Show less" : "Show more"}
          </button>
        </>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {/* The "why is this here?" affordance. Without it the ranking is a
            black box, and a black box cannot go in a methods section. */}
        {matched.length > 0 && <Chip tone="accent">Matched: {matched.join(", ")}</Chip>}
        {signals.titleMatch > 0 && <Chip>title match</Chip>}
        {work.oaPdfUrl && <Chip tone="accent">Open access</Chip>}
        {work.citedByCount > 0 && (
          <Chip>{work.citedByCount.toLocaleString()} citations</Chip>
        )}
        {work.doi && <Chip mono>doi:{work.doi}</Chip>}
      </div>

      {failed && (
        <p role="alert" className="text-danger text-ui mt-2">
          {failed}
        </p>
      )}
    </li>
  );
}

function Chip({
  children,
  tone = "muted",
  mono = false,
}: {
  children: React.ReactNode;
  tone?: "muted" | "accent";
  mono?: boolean;
}) {
  return (
    <span
      className={cx(
        "text-fine inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5",
        mono && "font-mono",
        tone === "accent"
          ? "bg-accent-soft text-accent"
          : "border-rule text-muted border",
      )}
    >
      {children}
    </span>
  );
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

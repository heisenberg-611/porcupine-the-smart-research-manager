"use client";

import type { ScoredWork } from "@Porcupine/discovery";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

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
  const [isLoaded, setIsLoaded] = useState(false);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const STORAGE_KEY = `Porcupine-search-${projectId}`;

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        setTerms(parsed.terms ?? "");
        setFromYear(parsed.fromYear ?? "");
        setToYear(parsed.toYear ?? "");
        setResults(parsed.results ?? null);
        setSearched(parsed.searched ?? null);
      }
    } catch {
      // Ignore parse errors from stale/corrupt session storage
    }
    setIsLoaded(true);
  }, [STORAGE_KEY]);

  useEffect(() => {
    if (!isLoaded) return;
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ terms, fromYear, toYear, results, searched }),
    );
  }, [isLoaded, STORAGE_KEY, terms, fromYear, toYear, results, searched]);

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
      <div className="from-ui/5 to-surface ring-border relative rounded-[--radius-card] border-t border-white/5 bg-gradient-to-br p-6 shadow-sm ring-1">
        <form onSubmit={onSubmit} className="relative z-10 flex flex-col gap-4">
          <Field
            label="Search terms"
            id="terms"
            hint="Searches OpenAlex, Crossref, arXiv, Europe PMC and Semantic Scholar at once."
          >
            <div className="mt-1 flex gap-2">
              <Input
                id="terms"
                name="terms"
                ref={input}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                required
                autoComplete="off"
                placeholder="e.g. spaced repetition medical education"
                className="border-border bg-raised text-ink text-ui focus:border-accent focus:ring-accent min-h-12 w-full flex-1 rounded-xl border px-4 shadow-sm transition-all"
              />
              <Button
                type="submit"
                variant="primary"
                className="rounded-xl px-6 font-medium shadow-sm transition-all hover:shadow-md"
                busy={pending}
                busyLabel="Searching…"
              >
                Search
              </Button>
            </div>
          </Field>

          <div className="mt-2 flex flex-wrap items-end gap-4">
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
                className="border-border bg-raised text-ink text-ui focus:border-accent min-h-11 w-28 rounded-xl border px-3 shadow-sm transition-all"
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
                className="border-border bg-raised text-ink text-ui focus:border-accent min-h-11 w-28 rounded-xl border px-3 shadow-sm transition-all"
              />
            </Field>
          </div>
        </form>
      </div>

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
        {hasQuestions ? (
          <>
            Results are ranked against this project&rsquo;s{" "}
            <Link
              href={`/projects/${projectId}/questions`}
              className="text-accent underline underline-offset-4"
            >
              research questions
            </Link>
            .
          </>
        ) : (
          <>
            {/* This sentence used to end here, as an instruction with no
                destination — there was no screen for research questions at
                all, so the ranking scored against an empty set and every
                result reported matching nothing. */}
            This project has no research questions, so results are ranked by citation
            count alone.{" "}
            <Link
              href={`/projects/${projectId}/questions`}
              className="text-accent underline underline-offset-4"
            >
              Add some
            </Link>{" "}
            and search will rank against them.
          </>
        )}
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
                <div className="flex flex-col gap-2">
                  <p className="text-muted text-ui">
                    {results.ranked.length}{" "}
                    {results.ranked.length === 1 ? "result" : "results"} after merging
                    duplicates across sources.
                  </p>
                  {results.counts && results.counts.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted text-fine">Found:</span>
                      {results.counts.map((c) => (
                        <Chip key={c.provider} tone="muted">
                          {c.provider}: {c.count}
                        </Chip>
                      ))}
                    </div>
                  )}
                </div>

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
        "rounded-xl border p-5 transition-all duration-300",
        // An added paper stays in the list rather than vanishing — you are
        // reading a ranking, and having rows disappear underneath you loses
        // your place. It just stops looking like something to act on.
        added
          ? "border-rule bg-surface/40 opacity-70"
          : "border-border bg-raised hover:border-accent/40 hover:-translate-y-0.5 hover:shadow-md",
      )}
    >
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0">
          <h3 className="text-ink text-lg leading-snug font-semibold text-pretty">
            {link ? (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent underline-offset-4 transition-colors hover:underline"
              >
                {work.title}
              </a>
            ) : (
              work.title
            )}
          </h3>
          <p className="meta mt-1.5 text-sm">
            {authors}
            {more}
            {work.venue && ` · ${work.venue}`}
            {work.publishedYear && ` · ${work.publishedYear}`}
          </p>
        </div>

        <Button
          variant={added ? "ghost" : "primary"}
          onClick={onAdd}
          disabled={added}
          busy={pending}
          busyLabel="Adding…"
          // "Add" alone repeats forty times down the page and tells a screen
          // reader nothing about which one it is on.
          aria-label={added ? `${work.title} is in your library` : `Add ${work.title}`}
          className={cx(
            "shrink-0 rounded-full font-medium transition-all",
            added ? "" : "shadow-sm hover:shadow-md",
          )}
        >
          {added ? "In library" : "Add to library"}
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
            className="text-accent focus-visible:ring-accent hover:text-accent-heavy mt-2 rounded text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            {expanded ? "Show less" : "Show full abstract"}
          </button>
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
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
        "inline-flex max-w-full items-center truncate rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
        mono && "font-mono tracking-tight",
        tone === "accent"
          ? "bg-accent/10 text-accent ring-accent/20 ring-1 ring-inset"
          : "bg-surface text-ink ring-border ring-1 ring-inset",
      )}
    >
      {children}
    </span>
  );
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

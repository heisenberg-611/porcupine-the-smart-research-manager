"use client";

import type { ProviderId, ScoredWork, WorkInput } from "@Porcupine/discovery";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { MarkdownViewerDialog } from "@/components/markdown-viewer-dialog";
import { Button, Field, Input, Skeleton } from "@/components/ui";
import {
  downloadSearchExportMarkdown,
  formatSearchExportMarkdown,
  generateSearchExportFilename,
} from "@/lib/export/search-markdown";

import { addWorkToProject, searchWorks, type SearchResults } from "./actions";

const PROVIDER_METADATA: Record<
  ProviderId,
  { label: string; badge: string; description: string }
> = {
  doaj: {
    label: "DOAJ",
    badge: "DOAJ",
    description: "Psychology & Social Sciences (20k+ peer-reviewed OA journals)",
  },
  openalex: {
    label: "OpenAlex",
    badge: "OpenAlex",
    description: "Global citation graph (250M+ multidisciplinary papers)",
  },
  europepmc: {
    label: "Europe PMC",
    badge: "Europe PMC",
    description: "Biomedical, psychiatry & behavioral health (PMIDs)",
  },
  crossref: {
    label: "Crossref",
    badge: "Crossref",
    description: "Official publisher DOI registry & metadata",
  },
  semanticscholar: {
    label: "Semantic Scholar",
    badge: "Semantic Scholar",
    description: "Conferences, CS & multidisciplinary citations",
  },
  arxiv: {
    label: "arXiv",
    badge: "arXiv",
    description: "Preprints (CS, Physics, Math, Quant-Bio)",
  },
};

const ALL_PROVIDERS: ProviderId[] = [
  "doaj",
  "openalex",
  "europepmc",
  "crossref",
  "semanticscholar",
  "arxiv",
];

const PRESETS: Array<{ label: string; providers: ProviderId[] }> = [
  { label: "All Databases (6)", providers: ALL_PROVIDERS },
  { label: "Psychology & Social", providers: ["doaj", "openalex", "crossref"] },
  { label: "Biomedical & Clinical", providers: ["europepmc", "doaj", "openalex", "crossref"] },
  { label: "CS & Preprints", providers: ["semanticscholar", "arxiv", "openalex", "crossref"] },
];

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
  const [selectedProviders, setSelectedProviders] = useState<ProviderId[]>(ALL_PROVIDERS);
  const [showSourceSelector, setShowSourceSelector] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searched, setSearched] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const [activeSourceFilter, setActiveSourceFilter] = useState<string>("ALL");
  const [sortBy, setSortBy] = useState<"relevance" | "citations" | "year" | "title">("relevance");
  const [exported, setExported] = useState(false);
  const [copied, setCopied] = useState(false);
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
        if (Array.isArray(parsed.selectedProviders) && parsed.selectedProviders.length > 0) {
          setSelectedProviders(parsed.selectedProviders);
        }
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
      JSON.stringify({ terms, fromYear, toYear, results, searched, selectedProviders }),
    );
  }, [isLoaded, STORAGE_KEY, terms, fromYear, toYear, results, searched, selectedProviders]);

  function toggleProvider(id: ProviderId) {
    setSelectedProviders((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) return prev; // Keep at least one provider
        return prev.filter((p) => p !== id);
      }
      return [...prev, id];
    });
  }

  function applyPreset(providers: ProviderId[]) {
    setSelectedProviders(providers);
  }

  function run(query: string) {
    setError(null);
    setSearched(query);
    setFilterQuery("");
    setActiveSourceFilter("ALL");

    startTransition(async () => {
      const response = await searchWorks({
        projectId,
        terms: query,
        ...(fromYear ? { fromYear: Number(fromYear) } : {}),
        ...(toYear ? { toYear: Number(toYear) } : {}),
        providers: selectedProviders.length > 0 ? selectedProviders : ALL_PROVIDERS,
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

  function addTerm(keyword: string) {
    const next = terms.trim() ? `${terms.trim()} ${keyword}` : keyword;
    setTerms(next);
    input.current?.focus();
  }

  // Count available sources on loaded results
  const sourceCounts = useMemo(() => {
    if (!results) return {};
    const counts: Record<string, number> = {};
    for (const scored of results.ranked) {
      const sources = getWorkSources(scored.work);
      for (const s of sources) {
        counts[s] = (counts[s] ?? 0) + 1;
      }
    }
    return counts;
  }, [results]);

  // Filter and sort the loaded results
  const filteredAndSortedRanked = useMemo(() => {
    if (!results) return [];
    let list = results.ranked;

    // 1. Filter by source provider
    if (activeSourceFilter !== "ALL") {
      list = list.filter((scored) => {
        const sources = getWorkSources(scored.work);
        return sources.includes(activeSourceFilter);
      });
    }

    // 2. Filter by searchbox query
    const q = filterQuery.trim().toLowerCase();
    if (q) {
      const tokens = q.split(/\s+/).filter(Boolean);
      list = list.filter((scored) => {
        const { work, matched } = scored;
        const authorStr = Array.isArray(work.authors)
          ? work.authors
              .map((a) =>
                typeof a === "string"
                  ? a
                  : typeof a === "object" && a && "name" in a
                    ? `${a.name} ${"affiliation" in a && a.affiliation ? a.affiliation : ""}`
                    : "",
              )
              .join(" ")
              .toLowerCase()
          : "";

        const targetText = [
          work.title,
          work.abstract ?? "",
          authorStr,
          work.venue ?? "",
          work.publishedYear ? String(work.publishedYear) : "",
          work.doi ?? "",
          work.arxivId ?? "",
          work.pmid ?? "",
          work.openalexId ?? "",
          ...(work.sources ?? []),
          matched.join(" "),
        ]
          .join(" ")
          .toLowerCase();

        return tokens.every((token) => targetText.includes(token));
      });
    }

    // 3. Sort
    return [...list].sort((a, b) => {
      if (sortBy === "citations") {
        return b.work.citedByCount - a.work.citedByCount;
      }
      if (sortBy === "year") {
        const yA = a.work.publishedYear ?? 0;
        const yB = b.work.publishedYear ?? 0;
        return yB - yA;
      }
      if (sortBy === "title") {
        return a.work.title.localeCompare(b.work.title);
      }
      // Default: relevance score
      if (b.score !== a.score) return b.score - a.score;
      return a.work.title.localeCompare(b.work.title);
    });
  }, [results, activeSourceFilter, filterQuery, sortBy]);

  function getMarkdownContent() {
    if (!results || results.ranked.length === 0) return null;
    const rankedToExport =
      (filterQuery.trim().length > 0 || activeSourceFilter !== "ALL") &&
      filteredAndSortedRanked.length > 0
        ? filteredAndSortedRanked
        : results.ranked;
    return formatSearchExportMarkdown({
      terms: searched || terms || "search-results",
      fromYear: fromYear || undefined,
      toYear: toYear || undefined,
      ranked: rankedToExport,
      counts: results.counts,
      failures: results.failures,
    });
  }

  function onExportMarkdown() {
    const md = getMarkdownContent();
    if (!md) return;

    const filename = generateSearchExportFilename(searched || terms || "search-results");
    downloadSearchExportMarkdown(md, filename);
    setExported(true);
    setTimeout(() => setExported(false), 2500);
  }

  async function onCopyMarkdown() {
    const md = getMarkdownContent();
    if (!md) return;

    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Ignore if clipboard permissions are not available
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="from-surface/80 via-raised/60 to-surface border-border/70 relative rounded-2xl border bg-gradient-to-br p-6 shadow-sm ring-1 ring-white/5">
        <form onSubmit={onSubmit} className="relative z-10 flex flex-col gap-4">
          <Field
            label="Search terms"
            id="terms"
            hint="Federated search across selected open research databases."
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
                placeholder="e.g. seeking external validation social self-esteem"
                className="border-border/70 bg-surface text-ink text-ui focus:border-accent focus:ring-accent min-h-12 w-full flex-1 rounded-2xl border px-4 shadow-xs transition-all focus:ring-2 focus:outline-none"
              />
              <Button
                type="submit"
                variant="primary"
                className="rounded-2xl px-6 font-medium shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                busy={pending}
                busyLabel="Searching…"
              >
                Search
              </Button>
            </div>
          </Field>

          {/* Source Selection & Year Filters Bar */}
          <div className="mt-1 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setShowSourceSelector((v) => !v)}
                className="border-border/80 bg-surface text-ink hover:border-accent/40 text-fine inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 font-medium shadow-2xs transition-all"
              >
                <DatabaseIcon className="text-accent size-3.5" />
                <span>
                  Sources: <strong>{selectedProviders.length} of {ALL_PROVIDERS.length}</strong> active
                </span>
                <span className="text-muted text-xs">{showSourceSelector ? "▲" : "▼"}</span>
              </button>

              <div className="flex items-center gap-2">
                <span className="text-muted text-fine">Years:</span>
                <Input
                  id="fromYear"
                  type="number"
                  inputMode="numeric"
                  min={1400}
                  max={2200}
                  placeholder="From"
                  value={fromYear}
                  onChange={(e) => setFromYear(e.target.value)}
                  className="border-border/70 bg-surface text-ink text-fine min-h-8 w-20 rounded-lg border px-2 shadow-2xs"
                />
                <span className="text-muted text-fine">–</span>
                <Input
                  id="toYear"
                  type="number"
                  inputMode="numeric"
                  min={1400}
                  max={2200}
                  placeholder="To"
                  value={toYear}
                  onChange={(e) => setToYear(e.target.value)}
                  className="border-border/70 bg-surface text-ink text-fine min-h-8 w-20 rounded-lg border px-2 shadow-2xs"
                />
              </div>
            </div>

            {/* Quick Source Preset Links */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted text-[11px]">Presets:</span>
              {PRESETS.map((preset) => {
                const isSelected =
                  preset.providers.length === selectedProviders.length &&
                  preset.providers.every((p) => selectedProviders.includes(p));
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyPreset(preset.providers)}
                    className={cx(
                      "rounded-lg px-2 py-0.5 text-[11px] font-medium transition-all",
                      isSelected
                        ? "bg-accent/15 text-accent ring-1 ring-accent/30 font-semibold"
                        : "text-muted hover:text-ink hover:bg-surface/80 bg-surface/40",
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Expandable Source Picker */}
          {showSourceSelector && (
            <div className="border-border/60 bg-surface/90 flex flex-col gap-3 rounded-xl border p-3.5 shadow-xs animate-in fade-in zoom-in-95 duration-100">
              <div className="flex items-center justify-between">
                <p className="text-ink text-xs font-semibold">
                  Choose which databases to query before searching:
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedProviders(ALL_PROVIDERS)}
                    className="text-accent hover:underline text-fine font-medium"
                  >
                    Select all
                  </button>
                  <span className="text-muted">·</span>
                  <button
                    type="button"
                    onClick={() => setSelectedProviders(["doaj", "openalex"])}
                    className="text-accent hover:underline text-fine font-medium"
                  >
                    Psychology default
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                {ALL_PROVIDERS.map((id) => {
                  const meta = PROVIDER_METADATA[id];
                  const isChecked = selectedProviders.includes(id);
                  return (
                    <label
                      key={id}
                      className={cx(
                        "flex cursor-pointer select-none items-start gap-2.5 rounded-xl border p-2.5 transition-all",
                        isChecked
                          ? "border-accent/40 bg-accent/5 ring-1 ring-accent/20"
                          : "border-border/60 bg-surface/50 opacity-60 hover:opacity-100",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleProvider(id)}
                        className="accent-accent mt-0.5 size-4 rounded"
                      />
                      <div className="min-w-0">
                        <p className="text-ink text-xs font-semibold">{meta.label}</p>
                        <p className="text-muted text-[11px] leading-snug">{meta.description}</p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </form>
      </div>

      {/* Suggested question keywords */}
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
            </Link>{" "}
            with cross-domain disambiguation.
          </>
        ) : (
          <>
            This project has no research questions yet.{" "}
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

      {/* Results Section */}
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
              <div className="border-border/70 bg-surface text-ui rounded-2xl border p-4 shadow-xs">
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
              <div className="border-rule/80 bg-surface/30 rounded-2xl border border-dashed p-8 text-center shadow-xs">
                <p className="text-ink text-ui font-medium">
                  Nothing matched “{searched}”.
                </p>
                <p className="text-muted text-fine mx-auto mt-1 max-w-sm text-pretty">
                  Try fewer words or broaden your selected sources. Year
                  filters narrow this further — clear them if they are set.
                </p>
              </div>
            ) : (
              <>
                {/* Result Controls Banner */}
                <div className="border-border/70 from-surface/90 via-raised/70 to-surface flex flex-col gap-4 rounded-2xl border bg-gradient-to-br p-5 shadow-xs">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-col gap-1.5">
                      <p className="text-ink text-ui font-semibold">
                        Showing {filteredAndSortedRanked.length} of {results.ranked.length}{" "}
                        {results.ranked.length === 1 ? "paper" : "papers"}
                        <span className="text-muted font-normal">
                          {" "}
                          · duplicates merged across sources
                        </span>
                      </p>
                      {results.counts && results.counts.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-muted text-fine">Fetched:</span>
                          {results.counts.map((c) => (
                            <Chip key={c.provider} tone="muted">
                              {c.provider}: {c.count}
                            </Chip>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <MarkdownViewerDialog
                        content={getMarkdownContent() ?? ""}
                        title={`Search Export: ${searched || terms}`}
                        filename={generateSearchExportFilename(
                          searched || terms || "search-results",
                        )}
                        triggerLabel="Preview Markdown"
                        triggerVariant="ghost"
                        triggerClassName="border-border/70 bg-surface/80 hover:bg-surface text-ink hover:border-accent/40 rounded-full border text-sm font-medium shadow-xs transition-all"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={onExportMarkdown}
                        className="border-border/70 bg-surface/80 hover:bg-surface text-ink hover:border-accent/40 rounded-full border text-sm font-medium shadow-xs transition-all"
                        aria-label={`Export ${filteredAndSortedRanked.length} papers to Markdown`}
                      >
                        <DownloadIcon className="text-accent size-4" />
                        <span>
                          {exported
                            ? "Exported .md!"
                            : "Export for AI (.md)"}
                        </span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={onCopyMarkdown}
                        className="border-border/70 bg-surface/80 hover:bg-surface text-ink hover:border-accent/40 rounded-full border text-sm font-medium shadow-xs transition-all"
                        aria-label="Copy paper details and abstracts to clipboard as Markdown"
                      >
                        <CopyIcon className="text-accent size-4" />
                        <span>{copied ? "Copied!" : "Copy markdown"}</span>
                      </Button>
                    </div>
                  </div>

                  {/* Filter by Source Provider & Sort Options */}
                  <div className="border-border/60 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                    {/* Source Provider Filter Pills */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-muted text-fine">View source:</span>
                      <button
                        type="button"
                        onClick={() => setActiveSourceFilter("ALL")}
                        className={cx(
                          "rounded-full px-2.5 py-1 text-xs font-medium transition-all",
                          activeSourceFilter === "ALL"
                            ? "bg-accent text-accent-ink font-semibold shadow-xs"
                            : "bg-surface text-ink hover:bg-surface/80 border border-border/70",
                        )}
                      >
                        All Sources ({results.ranked.length})
                      </button>

                      {ALL_PROVIDERS.map((pId) => {
                        const count = sourceCounts[pId] ?? 0;
                        if (count === 0) return null;
                        const meta = PROVIDER_METADATA[pId];
                        const isActive = activeSourceFilter === pId;
                        return (
                          <button
                            key={pId}
                            type="button"
                            onClick={() => setActiveSourceFilter(isActive ? "ALL" : pId)}
                            className={cx(
                              "rounded-full px-2.5 py-1 text-xs font-medium transition-all",
                              isActive
                                ? "bg-accent text-accent-ink font-semibold shadow-xs"
                                : "bg-surface text-ink hover:bg-surface/80 border border-border/70",
                            )}
                          >
                            {meta.badge} ({count})
                          </button>
                        );
                      })}
                    </div>

                    {/* Sort By Dropdown */}
                    <div className="flex items-center gap-2">
                      <span className="text-muted text-fine">Sort by:</span>
                      <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                        className="border-border/70 bg-surface text-ink text-fine focus:border-accent focus:ring-accent rounded-xl border px-2.5 py-1 shadow-2xs focus:outline-none"
                      >
                        <option value="relevance">Relevance & Match</option>
                        <option value="citations">Most Cited First</option>
                        <option value="year">Newest First</option>
                        <option value="title">Title (A-Z)</option>
                      </select>
                    </div>
                  </div>

                  {/* Filter within loaded results input */}
                  <div className="relative">
                    <div className="text-muted pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                      <SearchFilterIcon className="size-4" />
                    </div>
                    <Input
                      id="filter-results"
                      name="filter-results"
                      type="text"
                      role="searchbox"
                      value={filterQuery}
                      onChange={(e) => setFilterQuery(e.target.value)}
                      placeholder="Search within loaded results (filter by keyword, author, abstract, year, DOI...)"
                      className="border-border/70 bg-surface/90 text-ink text-ui placeholder:text-muted/60 focus:border-accent focus:ring-accent min-h-11 w-full rounded-xl border pr-9 pl-10 shadow-2xs transition-all focus:ring-2 focus:outline-none"
                    />
                    {filterQuery && (
                      <button
                        type="button"
                        onClick={() => setFilterQuery("")}
                        aria-label="Clear filter"
                        className="text-muted hover:text-ink absolute inset-y-0 right-0 flex items-center pr-3 text-sm font-semibold transition-colors"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {filteredAndSortedRanked.length === 0 ? (
                  <div className="border-rule/80 bg-surface/30 rounded-2xl border border-dashed p-8 text-center shadow-xs">
                    <p className="text-ink text-ui font-medium">
                      No loaded papers match your active filter.
                    </p>
                    <p className="text-muted text-fine mx-auto mt-1 max-w-sm text-pretty">
                      Try switching to &ldquo;All Sources&rdquo; or clearing the searchbox filter.
                    </p>
                    <div className="mt-3 flex justify-center gap-2">
                      {activeSourceFilter !== "ALL" && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setActiveSourceFilter("ALL")}
                          className="border-border/70 rounded-full border text-sm"
                        >
                          View all sources
                        </Button>
                      )}
                      {filterQuery && (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setFilterQuery("")}
                          className="border-border/70 rounded-full border text-sm"
                        >
                          Clear text filter
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {filteredAndSortedRanked.map((scored) => (
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
                )}
              </>
            )}
          </>
        )}

        {!pending && !results && !error && (
          <div className="border-rule/80 bg-surface/30 rounded-2xl border border-dashed p-8 text-center shadow-xs">
            <p className="text-ink text-ui font-medium">
              Six databases, one search box.
            </p>
            <p className="text-muted text-fine mx-auto mt-1 max-w-md text-pretty">
              Searches DOAJ, OpenAlex, Europe PMC, Crossref, Semantic Scholar, and arXiv.
              Duplicates are merged across sources, so a paper that appears in three of
              them arrives here once.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function ResultsSkeleton() {
  return (
    <ul className="flex flex-col gap-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="border-rule/70 bg-surface/30 rounded-2xl border p-5 shadow-xs"
        >
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="mt-2 h-4 w-1/2" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-1 h-4 w-5/6" />
        </li>
      ))}
    </ul>
  );
}

function getWorkSources(work: WorkInput): string[] {
  if (work.sources && work.sources.length > 0) return work.sources;
  const s: string[] = [];
  if (work.arxivId) s.push("arxiv");
  if (work.pmid) s.push("europepmc");
  if (work.openalexId) s.push("openalex");
  if (work.doi) s.push("crossref");
  return s.length > 0 ? s : ["other"];
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

  const sources = getWorkSources(work);

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
        "rounded-2xl border p-6 shadow-xs transition-all duration-300",
        added
          ? "border-rule/60 bg-surface/40 opacity-70"
          : "border-border/70 bg-raised/70 hover:border-accent/40 hover:bg-raised hover:-translate-y-0.5 hover:shadow-md",
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
        {/* Source Provider Badges */}
        {sources.map((s) => (
          <span
            key={s}
            className="bg-accent/10 text-accent ring-accent/25 inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold tracking-wide uppercase ring-1"
          >
            {s}
          </span>
        ))}

        {matched.length > 0 && <Chip tone="accent">Matched: {matched.join(", ")}</Chip>}
        {signals.titleMatch > 0 && (
          <Chip tone={signals.titleMatch >= 0.7 ? "accent" : "muted"}>
            Title match {(signals.titleMatch * 100).toFixed(0)}%
          </Chip>
        )}
        {signals.abstractMatch > 0 && (
          <Chip>Abstract match {(signals.abstractMatch * 100).toFixed(0)}%</Chip>
        )}
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

function DatabaseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M10 2c-4.418 0-8 1.343-8 3v10c0 1.657 3.582 3 8 3s8-1.343 8-3V5c0-1.657-3.582-3-8-3ZM4 5c0-.66 2.37-1.5 6-1.5s6 .84 6 1.5-2.37 1.5-6 1.5-6-.84-6-1.5Zm12 4.673C14.78 10.518 12.535 11 10 11s-4.78-.482-6-1.327V7.525C5.455 8.423 7.6 9 10 9s4.545-.577 6-1.475v2.148Zm0 3.327C14.78 13.845 12.535 14.327 10 14.327s-4.78-.482-6-1.327V10.852C5.455 11.75 7.6 12.327 10 12.327s4.545-.577 6-1.475V13Z" />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M4.5 2A1.5 1.5 0 0 0 3 3.5v13A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.378 2H4.5Zm4.75 6.75a.75.75 0 0 1 1.5 0v3.94l1.22-1.22a.75.75 0 1 1 1.06 1.06l-2.5 2.5a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 1 1 1.06-1.06l1.22 1.22V8.75Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12a1.5 1.5 0 0 1 .439 1.061V14.5A1.5 1.5 0 0 1 15.5 16h-7A1.5 1.5 0 0 1 7 14.5v-11Z" />
      <path d="M5 6a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 18h7a1.5 1.5 0 0 0 1.5-1.5v-.5H7A2.5 2.5 0 0 1 4.5 13.5V6H5Z" />
    </svg>
  );
}

function SearchFilterIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M9 3.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM2 9a7 7 0 1 1 12.452 4.391l3.328 3.329a.75.75 0 1 1-1.06 1.06l-3.329-3.328A7 7 0 0 1 2 9Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

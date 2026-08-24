"use client";

import { useMemo, useState, useEffect } from "react";
import {
  BADGE_STYLES,
  CATEGORY_COLORS,
  type Contributor,
} from "@/lib/contributors";

const PAGE_SIZE = 6;

export function ContributorsView({
  contributors,
}: {
  contributors: Contributor[];
}) {
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Reset pagination to page 1 whenever category or search filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedCategory, searchQuery]);

  const categories = useMemo(() => {
    const counts: Record<string, number> = { ALL: contributors.length };
    for (const c of contributors) {
      counts[c.type] = (counts[c.type] ?? 0) + 1;
    }
    return counts;
  }, [contributors]);

  const filteredContributors = useMemo(() => {
    return contributors.filter((c) => {
      if (selectedCategory !== "ALL" && c.type !== selectedCategory) return false;

      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase();
        const matchesName = c.name.toLowerCase().includes(q);
        const matchesRole = c.role.toLowerCase().includes(q);
        const matchesContribution = c.contribution.toLowerCase().includes(q);
        const matchesBadge = c.badge.toLowerCase().includes(q);
        return matchesName || matchesRole || matchesContribution || matchesBadge;
      }

      return true;
    });
  }, [contributors, selectedCategory, searchQuery]);

  const totalPages = Math.ceil(filteredContributors.length / PAGE_SIZE) || 1;
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, filteredContributors.length);
  const paginatedContributors = filteredContributors.slice(startIndex, endIndex);

  return (
    <div className="flex flex-col gap-8">
      {/* Search & Filter Toolbar */}
      <div className="border-border/70 bg-raised/70 flex flex-col gap-4 rounded-2xl border p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {Object.entries(categories).map(([cat, count]) => {
            const isActive = selectedCategory === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`focus-visible:ring-accent rounded-xl px-3 py-1.5 font-mono text-xs font-semibold transition-all focus-visible:ring-2 focus-visible:outline-none ${
                  isActive
                    ? "bg-accent text-white shadow-xs"
                    : "bg-surface text-muted hover:text-ink hover:bg-surface-hover"
                }`}
              >
                {cat === "ALL" ? "All Contributors" : cat} ({count})
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="w-full sm:max-w-xs">
          <input
            type="text"
            placeholder="Search by name, role, feedback..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="border-border/80 bg-surface/90 text-ink placeholder:text-muted/70 focus-visible:ring-accent w-full rounded-xl border px-3.5 py-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
          />
        </div>
      </div>

      {/* Contributor Cards Grid */}
      {filteredContributors.length === 0 ? (
        <div className="border-border/60 bg-raised/40 rounded-2xl border p-12 text-center">
          <p className="text-muted text-ui">No contributors found matching your criteria.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {paginatedContributors.map((c, index) => {
            const initials = c.name
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase();

            const badgeStyle = BADGE_STYLES[c.badge] || {
              bg: "bg-accent/15",
              text: "text-accent",
              border: "border-accent/25",
            };

            const catColor = CATEGORY_COLORS[c.type] || "bg-raised text-ink border-border";

            return (
              <div
                key={`${c.id || "contributor"}-${startIndex + index}`}
                className="border-border/70 bg-raised/80 flex flex-col justify-between rounded-2xl border p-6 shadow-xs transition-all hover:border-accent/40 hover:shadow-md hover:-translate-y-0.5"
              >
                <div>
                  {/* Top Header: Avatar + Name + Link */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="bg-accent/15 text-accent flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-mono text-sm font-bold shadow-xs">
                        {initials}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-ink font-serif text-lg font-bold">
                            {c.name}
                          </h3>
                          {c.link && (
                            <a
                              href={c.link}
                              target="_blank"
                              rel="noreferrer"
                              className="text-muted hover:text-accent focus-visible:ring-accent rounded p-0.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                              aria-label={`Profile link for ${c.name}`}
                            >
                              ↗
                            </a>
                          )}
                        </div>
                        <p className="text-muted text-fine truncate mt-0.5">
                          {c.role}
                        </p>
                      </div>
                    </div>

                    <span className="text-muted font-mono text-[11px] shrink-0">
                      {c.date}
                    </span>
                  </div>

                  {/* Badge & Category Chips */}
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {c.badge ? (
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-xs font-bold ${badgeStyle.bg} ${badgeStyle.text} ${badgeStyle.border}`}
                      >
                        {c.badge}
                      </span>
                    ) : null}

                    <span
                      className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${catColor}`}
                    >
                      {c.type}
                    </span>
                  </div>

                  {/* Contribution Detail Quote */}
                  <div className="border-border/60 bg-surface/70 text-ink-soft text-ui mt-4 rounded-xl border p-3.5 leading-relaxed italic">
                    "{c.contribution}"
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Footer (shown when items exceed PAGE_SIZE of 6) */}
      {filteredContributors.length > PAGE_SIZE && (
        <div className="border-border/70 bg-raised/70 flex flex-col items-center justify-between gap-4 rounded-2xl border px-6 py-4 shadow-xs sm:flex-row">
          <p className="text-muted font-mono text-xs">
            Showing <span className="text-ink font-semibold">{startIndex + 1}–{endIndex}</span> of{" "}
            <span className="text-ink font-semibold">{filteredContributors.length}</span> contributors
          </p>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="border-border/80 bg-surface text-ink hover:bg-surface-hover focus-visible:ring-accent disabled:opacity-40 disabled:pointer-events-none rounded-xl border px-3 py-1.5 font-mono text-xs font-semibold shadow-xs transition-all focus-visible:ring-2 focus-visible:outline-none"
            >
              ← Previous
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
              const isCurrent = pageNum === currentPage;
              return (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => setCurrentPage(pageNum)}
                  className={`focus-visible:ring-accent min-w-[32px] rounded-xl px-2.5 py-1.5 font-mono text-xs font-semibold transition-all focus-visible:ring-2 focus-visible:outline-none ${
                    isCurrent
                      ? "bg-accent text-white shadow-xs"
                      : "border-border/80 bg-surface text-muted hover:text-ink hover:bg-surface-hover border"
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="border-border/80 bg-surface text-ink hover:bg-surface-hover focus-visible:ring-accent disabled:opacity-40 disabled:pointer-events-none rounded-xl border px-3 py-1.5 font-mono text-xs font-semibold shadow-xs transition-all focus-visible:ring-2 focus-visible:outline-none"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Give Feedback & Contribute Banner */}
      <div className="border-border/70 bg-surface/80 rounded-2xl border p-8 shadow-xs text-center sm:text-left sm:flex sm:items-center sm:justify-between gap-6">
        <div>
          <h3 className="text-ink font-serif text-xl font-bold">
            Want to help upgrade porcupineResearch?
          </h3>
          <p className="text-muted text-ui mt-1.5 max-w-xl">
            We welcome all user feedback, feature suggestions, review methodology advice, bug reports, and code contributions. Your name and recognition badge will be immortalized here!
          </p>
        </div>

        <div className="mt-4 sm:mt-0 shrink-0 flex flex-wrap items-center gap-3">
          <a
            href="mailto:dhrubojyoti.saha@g.bracu.ac.bd?subject=porcupineResearch%20Feedback%20%26%20Contribution"
            className="bg-accent text-accent-ink focus-visible:ring-accent rounded-xl px-5 py-2.5 font-semibold shadow-xs transition-all hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none inline-block text-xs"
          >
            Send Feedback ✉️
          </a>
          <a
            href="https://github.com/heisenberg-611"
            target="_blank"
            rel="noreferrer"
            className="border-border text-ink hover:bg-surface-hover focus-visible:ring-accent rounded-xl border px-5 py-2.5 font-semibold shadow-xs transition-all focus-visible:ring-2 focus-visible:outline-none inline-block text-xs"
          >
            GitHub Repository 🐙
          </a>
        </div>
      </div>
    </div>
  );
}

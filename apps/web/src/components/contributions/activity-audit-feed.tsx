"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ActivityActionType, ProjectActivityEvent } from "@/lib/contributions";

const ACTION_TYPE_COLORS: Record<ActivityActionType, string> = {
  SCREENING: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  EXTRACTION: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  COLLECTION: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  QUESTION: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  PROTOCOL: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
  ANNOTATION: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20",
  RECONCILIATION: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  LOGIN: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
  LOGOUT: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
};

export function ActivityAuditFeed({
  events,
  members,
}: {
  events: ProjectActivityEvent[];
  members: Array<{ userId: string; name: string }>;
}) {
  const [selectedMember, setSelectedMember] = useState<string>("ALL");
  const [selectedType, setSelectedType] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (selectedMember !== "ALL" && e.actorId !== selectedMember) return false;
      if (selectedType !== "ALL" && e.type !== selectedType) return false;

      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = e.targetTitle.toLowerCase().includes(q);
        const matchesActor = e.actorName.toLowerCase().includes(q);
        const matchesAction = e.action.toLowerCase().includes(q);
        const matchesDetails = e.details?.toLowerCase().includes(q) ?? false;
        return matchesTitle || matchesActor || matchesAction || matchesDetails;
      }

      return true;
    });
  }, [events, selectedMember, selectedType, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
  const activePage = Math.min(currentPage, totalPages);

  const startIndex = (activePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredEvents.length);
  const displayedEvents = filteredEvents.slice(startIndex, endIndex);

  const handleMemberChange = (val: string) => {
    setSelectedMember(val);
    setCurrentPage(1);
  };

  const handleTypeChange = (val: string) => {
    setSelectedType(val);
    setCurrentPage(1);
  };

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setCurrentPage(1);
  };

  const handlePageSizeChange = (val: number) => {
    setPageSize(val);
    setCurrentPage(1);
  };

  return (
    <div className="border-border/70 bg-raised/70 overflow-hidden rounded-2xl border shadow-xs">
      {/* Header & Filter Controls */}
      <div className="border-border/50 flex flex-col gap-4 border-b p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-ink text-heading font-semibold">
              Granular Activity & Audit Log
            </h3>
            <p className="text-muted text-fine mt-1">
              Every micro-action recorded chronologically across research and session events.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-muted font-mono text-xs">Show</span>
            <select
              value={pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              aria-label="Select items per page"
              className="border-border/80 bg-surface text-ink focus-visible:ring-accent rounded-lg border px-2.5 py-1 font-mono text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none"
            >
              <option value={50}>50 per view</option>
              <option value={100}>100 per view</option>
              <option value={25}>25 per view</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* Member Filter */}
          <div>
            <label htmlFor="member-filter" className="text-muted text-[11px] font-medium uppercase tracking-wider">
              Filter by Member
            </label>
            <select
              id="member-filter"
              value={selectedMember}
              onChange={(e) => handleMemberChange(e.target.value)}
              className="border-border/80 bg-surface/80 text-ink focus-visible:ring-accent mt-1 w-full rounded-xl border px-3 py-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
            >
              <option value="ALL">All Contributors ({members.length})</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {/* Action Type Filter */}
          <div>
            <label htmlFor="type-filter" className="text-muted text-[11px] font-medium uppercase tracking-wider">
              Filter by Action Type
            </label>
            <select
              id="type-filter"
              value={selectedType}
              onChange={(e) => handleTypeChange(e.target.value)}
              className="border-border/80 bg-surface/80 text-ink focus-visible:ring-accent mt-1 w-full rounded-xl border px-3 py-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
            >
              <option value="ALL">All Action Types</option>
              <option value="SCREENING">Screening Decisions</option>
              <option value="EXTRACTION">Data Extractions</option>
              <option value="COLLECTION">Library Paper Imports</option>
              <option value="ANNOTATION">PDF Annotations & Highlights</option>
              <option value="QUESTION">Research Questions</option>
              <option value="PROTOCOL">Protocols</option>
              <option value="RECONCILIATION">Reconciliation</option>
              <option value="LOGIN">Sign In / Active Session</option>
              <option value="LOGOUT">Sign Out / Revocation</option>
            </select>
          </div>

          {/* Search Box */}
          <div>
            <label htmlFor="search-filter" className="text-muted text-[11px] font-medium uppercase tracking-wider">
              Search Keyword
            </label>
            <input
              id="search-filter"
              type="text"
              placeholder="Search paper title, actor, note..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="border-border/80 bg-surface/80 text-ink focus-visible:ring-accent mt-1 w-full rounded-xl border px-3 py-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Scrollable Audit List Container */}
      {displayedEvents.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-muted text-ui">No actions match the selected filters.</p>
        </div>
      ) : (
        <div className="divide-border/40 max-h-[600px] divide-y overflow-y-auto overscroll-contain scrollbar-thin">
          {displayedEvents.map((event) => {
            const initials = event.actorName
              .split(" ")
              .map((n) => n[0])
              .join("")
              .slice(0, 2)
              .toUpperCase() || "U";

            const relativeTime = formatRelativeTime(new Date(event.timestamp));
            const exactTime = new Date(event.timestamp).toLocaleString();
            const badgeColor =
              ACTION_TYPE_COLORS[event.type] || "bg-raised text-ink border-border";

            return (
              <div
                key={event.id}
                className="hover:bg-surface/50 flex items-start gap-4 p-4 transition-colors sm:px-6"
              >
                {/* Avatar */}
                <div className="bg-accent/15 text-accent flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold">
                  {initials}
                </div>

                {/* Event details */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ink text-xs font-semibold">
                      {event.actorName}
                    </span>

                    <span
                      className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase ${badgeColor}`}
                    >
                      {event.type}
                    </span>

                    <span className="text-muted text-xs">
                      {event.action}
                    </span>
                  </div>

                  {/* Target paper / session */}
                  <div className="mt-1">
                    {event.targetHref ? (
                      <Link
                        href={event.targetHref}
                        className="text-ink hover:text-accent text-xs font-medium underline-offset-4 hover:underline"
                      >
                        {event.targetTitle}
                      </Link>
                    ) : (
                      <span className="text-ink text-xs font-medium">
                        {event.targetTitle}
                      </span>
                    )}
                  </div>

                  {/* Details / Notes */}
                  {event.details && (
                    <div className="text-muted bg-surface/60 border-border/50 mt-1.5 rounded-lg border px-3 py-1.5 text-xs italic">
                      {event.details}
                    </div>
                  )}

                  {/* Timestamp */}
                  <div
                    title={exactTime}
                    className="text-muted/80 mt-1.5 font-mono text-[11px]"
                  >
                    {relativeTime} · {exactTime}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Numbered Pagination & Controls Footer */}
      {filteredEvents.length > 0 && (
        <div className="border-border/50 bg-surface/40 flex flex-wrap items-center justify-between gap-4 border-t px-6 py-3.5">
          <div className="text-muted font-mono text-xs">
            Showing <span className="text-ink font-bold tabular-nums">{startIndex + 1}</span>–
            <span className="text-ink font-bold tabular-nums">{endIndex}</span> of{" "}
            <span className="text-ink font-bold tabular-nums">{filteredEvents.length}</span> actions
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={activePage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="border-border bg-surface text-ink hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              ← Previous
            </button>

            <span className="text-muted px-2 font-mono text-xs tabular-nums">
              Page <strong className="text-ink">{activePage}</strong> of {totalPages}
            </span>

            <button
              type="button"
              disabled={activePage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              className="border-border bg-surface text-ink hover:bg-surface-hover disabled:opacity-40 disabled:cursor-not-allowed rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toISOString().slice(0, 10);
}

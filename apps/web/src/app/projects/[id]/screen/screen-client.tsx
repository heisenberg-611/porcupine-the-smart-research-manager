"use client";

import {
  EXCLUSION_REASONS,
  screenStatusLabel,
  type ExclusionReason,
} from "@Porcupine/shared";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";

import { AccessHelp, type AccessRoute } from "@/components/access-route";
import { SourceLinks } from "@/components/source-links";
import { Button, FormattedText, Input, Select } from "@/components/ui";

import { assignWork, recordDecision } from "./actions";

export interface ScreenRow {
  id: string;
  screenStatus: string;
  excludeReason: string | null;
  assigneeId: string | null;
  dueAt: string | null;
  title: string;
  authors: string;
  venue: string | null;
  year: number | null;
  abstract: string | null;
  doi: string | null;
  arxivId: string | null;
  pmid: string | null;
  oaPdfUrl: string | null;
}

export interface Member {
  userId: string;
  name: string;
}

/**
 * The queue orders, as data rather than as a string union repeated in three
 * places.
 */
const SORT_MODES = [
  { value: "unscreened", label: "Unscreened first" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
] as const;

type SortMode = (typeof SORT_MODES)[number]["value"];

/**
 * The screening surface.
 *
 * One paper at a time, with formatted abstract and Include/Exclude as primary actions.
 * Supports keyboard shortcuts, in-queue live search, and real-time session progress tracking.
 */
export function ScreenClient({
  projectId,
  accessRoute,
  rows,
  members,
  reasonRequired,
  currentUserId,
}: {
  projectId: string;
  accessRoute: AccessRoute;
  rows: ScreenRow[];
  members: Member[];
  reasonRequired: boolean;
  currentUserId: string;
}) {
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState(0);
  const [deferred, setDeferred] = useState<Record<string, true>>({});
  const [reason, setReason] = useState<ExclusionReason | "">("");
  const [showKeys, setShowKeys] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("unscreened");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [queueSearch, setQueueSearch] = useState<string>("");
  /** Assignee and due date per paper, while the write is in flight. */
  const [edits, setEdits] = useState<
    Record<string, { assigneeId: string; dueAt: string }>
  >({});
  const [pending, startTransition] = useTransition();

  const remaining = rows
    .filter((row) => !done[row.id])
    .filter((row) => {
      if (assigneeFilter === "all") return true;
      if (assigneeFilter === "unassigned") return !row.assigneeId;
      return row.assigneeId === assigneeFilter;
    })
    .sort((a, b) => {
      const aDef = Number(!!deferred[a.id]);
      const bDef = Number(!!deferred[b.id]);
      if (aDef !== bDef) return aDef - bDef;

      switch (sortMode) {
        case "newest":
          return (b.year ?? 0) - (a.year ?? 0);
        case "oldest":
          return (a.year ?? 0) - (b.year ?? 0);
        case "unscreened": {
          const aNew = Number(a.screenStatus === "IDENTIFIED");
          const bNew = Number(b.screenStatus === "IDENTIFIED");
          return bNew - aNew;
        }
      }
    });

  const filteredQueue = remaining.filter((row) => {
    if (!queueSearch.trim()) return true;
    const q = queueSearch.toLowerCase();
    return (
      row.title.toLowerCase().includes(q) ||
      row.authors.toLowerCase().includes(q) ||
      (row.year ? String(row.year).includes(q) : false) ||
      (row.venue ? row.venue.toLowerCase().includes(q) : false)
    );
  });

  const current = remaining[Math.min(index, Math.max(remaining.length - 1, 0))];

  function select(id: string) {
    const at = remaining.findIndex((row) => row.id === id);
    if (at >= 0) setIndex(at);
  }

  function skip() {
    if (!current) return;
    setDeferred((prev) => ({ ...prev, [current.id]: true }));
    setIndex(0);
    decide("SCREENING");
  }

  function decide(toStatus: "INCLUDED" | "EXCLUDED" | "SCREENING") {
    if (!current) return;
    setError(null);

    if (toStatus === "EXCLUDED" && reasonRequired && !reason) {
      setError("Choose an exclusion reason before excluding this paper.");
      return;
    }

    const target = current;
    const chosenReason = toStatus === "EXCLUDED" ? reason || null : null;

    if (toStatus !== "SCREENING") {
      setDone((prev) => ({ ...prev, [target.id]: toStatus }));
      setIndex(0);
    }
    setReason("");
    setStatus(null);

    const rollBack = (why: string) => {
      setDone((prev) => {
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
      setReason(chosenReason ?? "");
      setError(`"${target.title}" was not recorded: ${why} It is back in the queue.`);
    };

    startTransition(async () => {
      try {
        const response = await recordDecision({
          projectId,
          projectWorkId: target.id,
          toStatus,
          excludeReason: chosenReason,
          seenStatus: target.screenStatus as typeof toStatus,
        });

        if (response.ok) {
          if (response.data.conflict) {
            setConflicts((n) => n + 1);
            setStatus(`Already screened by ${response.data.conflict.by} — moved on.`);
          }
          return;
        }

        rollBack(response.error);
      } catch {
        rollBack("the server could not be reached.");
      }
    });
  }

  const assignment = current
    ? (edits[current.id] ?? {
        assigneeId: current.assigneeId ?? "",
        dueAt: dueDayValue(current.dueAt),
      })
    : { assigneeId: "", dueAt: "" };

  function assign(assigneeId: string, dueAt: string) {
    if (!current) return;
    const target = current;
    setError(null);
    setStatus(null);
    setEdits((prev) => ({ ...prev, [target.id]: { assigneeId, dueAt } }));

    startTransition(async () => {
      const response = await assignWork({
        projectId,
        projectWorkId: target.id,
        assigneeId: assigneeId || null,
        dueAt: dueAt || null,
      });

      if (response.ok) {
        const name = members.find((m) => m.userId === assigneeId)?.name;
        const who = name ? `Assigned to ${name}` : "Assignment cleared";
        setStatus(dueAt ? `${who}, due ${dueDayLabel(dueAt)}.` : `${who}.`);
        return;
      }

      setEdits((prev) => {
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
      setError(response.error);
    });
  }

  const decided = Object.keys(done).length;
  const totalPool = remaining.length + decided;
  const progressPercent = totalPool > 0 ? Math.round((decided / totalPool) * 100) : 100;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const el = event.target as HTMLElement | null;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "SELECT" ||
        tag === "TEXTAREA" ||
        el?.isContentEditable
      ) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "i") {
        event.preventDefault();
        decide("INCLUDED");
      } else if (key === "e") {
        event.preventDefault();
        decide("EXCLUDED");
      } else if (key === "s") {
        event.preventDefault();
        skip();
      } else if (key === "?") {
        event.preventDefault();
        setShowKeys((v) => !v);
      } else if (/^[1-9]$/.test(key)) {
        const picked = EXCLUSION_REASONS[Number(key) - 1];
        if (picked) {
          event.preventDefault();
          setReason(picked.code);
          setStatus(`Exclusion reason: ${picked.label}. Press E to exclude.`);
        }
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (!current) {
    return (
      <div className="border-border/70 bg-surface/40 flex flex-col items-center justify-center rounded-3xl border-2 border-dashed p-10 sm:p-16 text-center shadow-xs">
        <div className="bg-accent/10 text-accent mb-4 flex size-14 items-center justify-center rounded-2xl ring-1 ring-accent/20">
          <CheckCircleIcon className="size-8" />
        </div>
        <h3 className="text-ink text-xl font-bold font-serif sm:text-2xl">
          {decided > 0 ? "Screening Queue Completed!" : "No Papers to Screen"}
        </h3>
        <p className="text-muted text-ui mt-2 max-w-md">
          {decided > 0
            ? `Fantastic work! You have recorded ${decided} ${decided === 1 ? "decision" : "decisions"} in this session. All papers in this queue are screened.`
            : "There are currently no papers in the screening queue. Add papers from search or import to begin screening."}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href={`/projects/${projectId}/evidence`}>
            <Button variant="primary">
              <span>View Evidence Table</span>
            </Button>
          </Link>
          <Link href={`/projects/${projectId}/extract`}>
            <Button variant="ghost">
              <span>Go to Extraction</span>
            </Button>
          </Link>
          <Link href={`/projects/${projectId}/search`}>
            <Button variant="ghost">
              <span>Find More Papers</span>
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      {/* Session Progress Header */}
      <div className="border-border/70 bg-surface/50 rounded-2xl border p-4 sm:p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 text-fine">
          <div className="flex flex-wrap items-center gap-2">
            <span className="bg-accent/15 text-accent font-semibold px-2.5 py-1 rounded-lg">
              {remaining.length} to screen
            </span>
            {decided > 0 && (
              <span className="bg-surface text-ink font-medium px-2.5 py-1 rounded-lg border border-border/70">
                ✓ {decided} decided this session
              </span>
            )}
            {Object.keys(deferred).length > 0 && (
              <span className="bg-surface text-muted px-2.5 py-1 rounded-lg border border-border/70">
                ↷ {Object.keys(deferred).length} skipped
              </span>
            )}
            {conflicts > 0 && (
              <span className="bg-danger/10 text-danger font-medium px-2.5 py-1 rounded-lg border border-danger/20">
                ⚠ {conflicts} handled by colleague
              </span>
            )}
          </div>
          <span className="text-muted font-medium">
            Session Progress: <strong className="text-ink">{progressPercent}%</strong>
          </span>
        </div>

        {/* Animated Progress Bar */}
        <div className="bg-surface/80 border-border/60 mt-3 h-2 w-full overflow-hidden rounded-full border">
          <div
            className="bg-accent h-full transition-all duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Main Screening Layout: Queue Column + Paper Detail */}
      <div className="lg:grid lg:grid-cols-[18rem_1fr] lg:gap-8 items-start">
        {/* Queue Navigation Column */}
        <nav
          aria-label="Screening queue"
          className="border-border/60 sticky top-[calc(var(--app-header-h)+1rem)] hidden max-h-[calc(100dvh-var(--app-header-h)-3rem)] flex-col gap-3 overflow-y-auto rounded-2xl border bg-surface/40 p-3.5 lg:flex shadow-xs"
        >
          {/* Filter & Sort Controls */}
          <div className="space-y-2">
            <Input
              type="search"
              value={queueSearch}
              onChange={(e) => setQueueSearch(e.target.value)}
              placeholder="Search queue…"
              aria-label="Filter queue papers"
              className="text-xs py-1.5"
            />
            <div className="grid grid-cols-2 gap-1.5">
              <Select
                value={sortMode}
                onChange={(event) => {
                  const picked = SORT_MODES.find((m) => m.value === event.target.value);
                  if (picked) setSortMode(picked.value);
                }}
                aria-label="Sort queue"
                className="text-xs py-1"
              >
                {SORT_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </Select>
              <Select
                value={assigneeFilter}
                onChange={(event) => setAssigneeFilter(event.target.value)}
                aria-label="Filter queue by assignee"
                className="text-xs py-1"
              >
                <option value="all">All assignees</option>
                <option value="unassigned">Unassigned</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="text-muted text-[0.7rem] px-1 font-semibold uppercase tracking-wider">
            Queue ({filteredQueue.length})
          </div>

          {filteredQueue.length === 0 ? (
            <p className="text-muted text-fine py-4 text-center italic">
              No matching papers in queue
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {filteredQueue.map((row) => {
                const isCurrent = row.id === current.id;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => select(row.id)}
                      aria-current={isCurrent ? "true" : undefined}
                      className={cx(
                        "focus-visible:ring-accent w-full rounded-xl px-3 py-2.5 text-left transition-all",
                        "focus-visible:ring-2 focus-visible:outline-none",
                        isCurrent
                          ? "bg-accent/15 border-accent/40 text-ink shadow-xs border"
                          : "hover:bg-surface/80 border-transparent border text-muted",
                      )}
                    >
                      <span
                        className={cx(
                          "text-fine block leading-snug line-clamp-2",
                          isCurrent ? "text-ink font-semibold" : "text-ink/80",
                        )}
                      >
                        {row.title}
                      </span>
                      <span className="text-muted text-[0.72rem] mt-1 flex flex-wrap items-center gap-1.5 opacity-90">
                        <span>{row.year ?? "No year"}</span>
                        {deferred[row.id] && (
                          <span className="text-amber-500 font-medium">· skipped</span>
                        )}
                        {row.assigneeId && (
                          <span>
                            · {members.find((m) => m.userId === row.assigneeId)?.name ?? "assigned"}
                          </span>
                        )}
                        {row.dueAt && <span>· due {dueDayLabel(dueDayValue(row.dueAt))}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        {/* Paper Detail & Decision Workspace */}
        <div className="flex min-w-0 flex-col gap-6">
          <article className="border-border/70 bg-raised rounded-2xl border p-6 sm:p-8 shadow-xs">
            {/* Status chip + Year */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="bg-accent/10 text-accent ring-accent/20 text-fine rounded-md px-2.5 py-0.5 font-semibold uppercase tracking-wider ring-1">
                {screenStatusLabel(current.screenStatus)}
              </span>
              {current.year && (
                <span className="text-muted text-fine font-medium">
                  Year: {current.year}
                </span>
              )}
            </div>

            <h2 className="text-ink text-xl sm:text-2xl font-bold font-serif leading-snug mt-3">
              {current.title}
            </h2>

            <div className="text-muted text-fine mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{current.authors}</span>
              {current.venue && (
                <>
                  <span>·</span>
                  <span className="italic">{current.venue}</span>
                </>
              )}
            </div>

            {/* Quick Links & Paywall Access */}
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border/50 pt-3">
              <SourceLinks title={current.title} work={current} />
              <AccessHelp
                route={accessRoute}
                doi={current.doi}
                title={current.title}
                oaPdfUrl={current.oaPdfUrl}
              />
            </div>

            {/* Abstract with rich formatting */}
            <div className="mt-6 border-t border-border/50 pt-5">
              <h4 className="text-ink text-fine font-semibold uppercase tracking-wider mb-2">
                Abstract
              </h4>
              {current.abstract ? (
                <div className="prose-porcupine text-ink/90 text-sm leading-relaxed max-w-none">
                  <FormattedText text={current.abstract} />
                </div>
              ) : (
                <p className="text-muted text-fine italic">
                  No abstract on record for this paper. Review the title or open the source links above.
                </p>
              )}
            </div>
          </article>

          {/* Decision Actions Bar */}
          <div className="border-border/70 bg-surface/50 rounded-2xl border p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              {/* Include */}
              <Button
                variant="primary"
                onClick={() => decide("INCLUDED")}
                className="font-semibold shadow-xs"
              >
                <CheckIcon className="size-4" />
                <span>Include</span>
                <Key>I</Key>
              </Button>

              {/* Exclude with Reason */}
              <div className="flex items-center gap-2 bg-surface border-border/70 rounded-xl border p-1 shadow-2xs">
                <Select
                  value={reason}
                  onChange={(event) =>
                    setReason(event.target.value as ExclusionReason | "")
                  }
                  aria-label="Exclusion reason"
                  className="text-xs py-1.5 max-w-[13rem]"
                >
                  <option value="">{reasonRequired ? "Exclusion reason…" : "No reason"}</option>
                  {EXCLUSION_REASONS.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </Select>

                <Button
                  variant="danger"
                  onClick={() => decide("EXCLUDED")}
                  className="text-xs font-semibold"
                >
                  <CrossIcon className="size-3.5" />
                  <span>Exclude</span>
                  <Key>E</Key>
                </Button>
              </div>

              {/* Skip */}
              <Button
                variant="ghost"
                disabled={pending}
                onClick={skip}
                className="text-xs font-medium"
              >
                <span>Skip</span>
                <Key>S</Key>
              </Button>
            </div>
          </div>

          {/* Assignment & Due Date Settings */}
          <div className="border-border/60 bg-surface/30 rounded-xl border p-4 flex flex-wrap items-center gap-4">
            <label className="text-muted text-fine flex min-w-[12rem] flex-1 flex-col gap-1">
              <span>Assign paper to</span>
              <Select
                value={assignment.assigneeId}
                onChange={(event) => assign(event.target.value, assignment.dueAt)}
                disabled={pending}
              >
                <option value="">Nobody</option>
                {members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.userId === currentUserId
                      ? `${member.name} (me)`
                      : member.name}
                  </option>
                ))}
              </Select>
            </label>

            <label className="text-muted text-fine flex flex-col gap-1">
              <span>Due by (23:59 UTC)</span>
              <Input
                type="date"
                value={assignment.dueAt}
                onChange={(event) => assign(assignment.assigneeId, event.target.value)}
                disabled={pending}
              />
            </label>
          </div>

          {/* Inline Feedback Alerts */}
          <div aria-live="polite">
            {status && (
              <div className="border-accent/30 bg-accent-soft text-ink text-fine rounded-xl border p-3">
                {status}
              </div>
            )}
            {error && (
              <div role="alert" className="border-danger/30 bg-danger-soft text-danger text-fine rounded-xl border p-3">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts Helper */}
      <div className="border-border/60 border-t pt-4">
        <button
          type="button"
          onClick={() => setShowKeys((v) => !v)}
          aria-expanded={showKeys}
          className="text-muted hover:text-ink text-fine focus-visible:ring-accent inline-flex items-center gap-2 rounded focus-visible:ring-2 focus-visible:outline-none"
        >
          <span>⌨️ Keyboard Shortcuts:</span>
          <span><Key>I</Key> Include</span>
          <span><Key>E</Key> Exclude</span>
          <span><Key>S</Key> Skip</span>
          <span><Key>1</Key>–<Key>9</Key> Reason</span>
          <span className="text-accent underline ml-1">{showKeys ? "Hide Guide" : "Show Guide (?)"}</span>
        </button>

        {showKeys && (
          <div className="border-border/60 bg-surface/60 mt-3 rounded-2xl border p-4 shadow-xs">
            <dl className="text-muted text-fine grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt><Key>I</Key></dt>
              <dd className="text-ink">Include this paper into the project</dd>
              <dt><Key>E</Key></dt>
              <dd className="text-ink">Exclude paper using the selected exclusion reason</dd>
              <dt><Key>S</Key></dt>
              <dd className="text-ink">Skip for now — records you looked and puts it at the end of the queue</dd>
              <dt><Key>1</Key>–<Key>9</Key></dt>
              <dd className="text-ink">Arm an exclusion reason by number</dd>
              <dt><Key>?</Key></dt>
              <dd className="text-ink">Toggle keyboard shortcuts guide</dd>
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
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
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
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
        d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CrossIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
    </svg>
  );
}

/*
 * A due date is a DAY, and the day is read in UTC.
 *
 * B-07 says store UTC, render in the viewer's zone, and state the deadline
 * semantics. The middle part is wrong for this particular value and right for
 * most others: the deadline is stored as 23:59:59.999Z on the day someone
 * picked, so rendering that instant in a zone ahead of UTC shows the NEXT day
 * — you choose the 20th and the app tells you the 21st. A date field promises
 * that the day you picked is the day you see.
 *
 * So both directions are UTC, and the semantics are stated on the control
 * rather than left for someone to infer.
 */
function dueDayValue(dueAt: string | null): string {
  if (!dueAt) return "";
  const at = new Date(dueAt);
  return Number.isNaN(at.getTime()) ? "" : at.toISOString().slice(0, 10);
}

function dueDayLabel(day: string): string {
  const at = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(at.getTime())
    ? day
    : at.toLocaleDateString(undefined, {
        timeZone: "UTC",
        month: "short",
        day: "numeric",
      });
}

/** A keycap. Small enough to be inline, distinct enough to be read as a key. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="border-border/80 bg-surface/90 text-ink mx-0.5 rounded-lg border px-2 py-0.5 font-mono text-[0.75rem] shadow-xs">
      {children}
    </kbd>
  );
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

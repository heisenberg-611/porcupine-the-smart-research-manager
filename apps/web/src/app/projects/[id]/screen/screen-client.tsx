"use client";

import {
  EXCLUSION_REASONS,
  screenStatusLabel,
  type ExclusionReason,
} from "@porcupine/shared";
import { useEffect, useState, useTransition } from "react";

import { AccessHelp, type AccessRoute } from "@/components/access-route";
import { SourceLinks } from "@/components/source-links";
import { Button, Input, Select } from "@/components/ui";

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
 *
 * The options are derived from this list and the value is narrowed back
 * through it, so a mode cannot exist in the dropdown without a matching
 * `case` below — the failure this replaces was an `as any` on the change
 * handler, which would have taken a renamed option, typechecked, and sorted
 * by nothing.
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
 * One paper at a time, with the abstract visible and Include/Exclude the
 * primary actions. That shape is deliberate: screening 300 papers is
 * repetitive work where the cost is per-decision, so anything that adds a
 * click or a scroll per paper multiplies by 300.
 *
 * The exclusion reason appears only when Exclude is chosen, and for a
 * systematic review it is required — enforced by the database, not by this
 * form, so a bulk action or import cannot route around it.
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
  /** Assignee and due date per paper, while the write is in flight. */
  const [edits, setEdits] = useState<
    Record<string, { assigneeId: string; dueAt: string }>
  >({});
  const [pending, startTransition] = useTransition();

  /*
   * Deferred papers sort to the END; they do not leave.
   *
   * Skip means "not now", and a queue that removes what you skipped has
   * quietly turned that into "never" — you would have to go and find the paper
   * again through the library to give it the second look you asked for.
   */
  const remaining = rows
    .filter((row) => !done[row.id])
    .filter((row) => {
      if (assigneeFilter === "all") return true;
      if (assigneeFilter === "unassigned") return !row.assigneeId;
      return row.assigneeId === assigneeFilter;
    })
    .sort((a, b) => {
      // Deferred items always sort to the very end
      const aDef = Number(!!deferred[a.id]);
      const bDef = Number(!!deferred[b.id]);
      if (aDef !== bDef) return aDef - bDef;

      switch (sortMode) {
        case "newest":
          return (b.year ?? 0) - (a.year ?? 0);
        case "oldest":
          return (a.year ?? 0) - (b.year ?? 0);
        case "unscreened": {
          // Untouched papers first; everything already looked at keeps its
          // relative order behind them.
          const aNew = Number(a.screenStatus === "IDENTIFIED");
          const bNew = Number(b.screenStatus === "IDENTIFIED");
          return bNew - aNew;
        }
      }
    });
  const current = remaining[Math.min(index, Math.max(remaining.length - 1, 0))];

  /** Jump to a paper picked from the list rather than the one next in order. */
  function select(id: string) {
    const at = remaining.findIndex((row) => row.id === id);
    if (at >= 0) setIndex(at);
  }

  /**
   * Record a decision and move on IMMEDIATELY, without waiting for the server.
   *
   * The round trip is 100–250 ms. One paper, that is imperceptible; three
   * hundred papers in an afternoon, it is a minute of thumb-twiddling
   * distributed into three hundred separate pauses, each one landing exactly
   * where the person had built up rhythm. Screening is the most repetitive
   * thing this product asks of anyone, and the cost is per-decision.
   *
   * Optimism is safe here specifically because the failure case is already
   * solved. `recordDecision` is a compare-and-swap against the status this
   * screen was showing, so a colleague deciding the same paper first is
   * refused by the database rather than silently overwritten — the
   * lost-update guard proved in pgtap.mjs. That gives a real answer to roll
   * back to, which is the thing most optimistic UIs do not have.
   *
   * Plain state rather than `useOptimistic`: `done` is client-only and does
   * not come back from the server, so there is nothing for React to reconcile
   * against. `useOptimistic` would add a rollback we would then have to
   * suppress.
   */
  /**
   * Defer: record that this paper was LOOKED AT and not decided.
   *
   * This button existed before and did `setIndex((i) => i + 1)` — nothing
   * else. Nothing was written, so a reload brought every skipped paper back in
   * its original place with no trace that anyone had opened it, and a
   * colleague sharing the queue could not tell either. It is also the whole
   * reason the Pipeline's SCREENING bar was always empty: the schema, the
   * transition table, the queue query and the PRISMA view all handle that
   * status, and the one control whose meaning IS that status never wrote it.
   */
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
      setError("Choose a reason before excluding — this is a systematic review.");
      return;
    }

    // Captured before the queue advances: by the time the response lands,
    // `current` is a different paper.
    const target = current;
    const chosenReason = toStatus === "EXCLUDED" ? reason || null : null;

    // A deferral stays in the queue; a verdict leaves it.
    if (toStatus !== "SCREENING") {
      setDone((prev) => ({ ...prev, [target.id]: toStatus }));
      setIndex(0);
    }
    setReason("");
    setStatus(null);

    // Put it back. The paper returns to the queue and, because the queue is
    // shown from the top, becomes the current one again — which is abrupt, and
    // is why the message names the paper rather than saying "failed". An
    // optimistic UI that swallows its own rollback is worse than no optimism,
    // because the decision looks recorded and is not.
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
          // Compare-and-swap: the status this screen was SHOWING when the
          // person decided. If the paper has moved since, the server refuses
          // rather than letting this decision overwrite a colleague's.
          seenStatus: target.screenStatus as typeof toStatus,
        });

        if (response.ok) {
          // Not an error — the paper is simply already handled. Naming who did
          // it explains why it left the queue, instead of leaving the person
          // wondering whether their click registered.
          if (response.data.conflict) {
            setConflicts((n) => n + 1);
            setStatus(`Already screened by ${response.data.conflict.by} — moved on.`);
          }
          return;
        }

        rollBack(response.error);
      } catch {
        // The case the first draft of this missed entirely, and the reason the
        // rollback test aborts the request rather than mocking a failed
        // response. A server action that cannot REACH the server throws; it
        // does not return `{ ok: false }`. Without this catch the rejection
        // escaped the transition, the paper stayed optimistically decided, and
        // the person was told nothing — the exact failure optimism is accused
        // of and usually guilty of. A dropped connection is the likeliest way
        // to lose a decision, not a refusal.
        rollBack("the server could not be reached.");
      }
    });
  }

  /**
   * Who, and by when — sent together, always, and held locally in between.
   *
   * `assignWork` writes both columns on every call: an omitted `dueAt` is
   * written as null, not left alone. So each control has to send the other's
   * value, and reading that value straight off `current` is a race. Picking an
   * assignee and then a date fires two requests, and the second one reads a
   * prop that only updates when `revalidatePath` has been round-tripped — so
   * the date would post `assigneeId: null` and quietly undo the assignment a
   * second earlier.
   *
   * The edit is therefore kept here, keyed by paper, and is what both controls
   * render from. It is the same shape as `done`: optimistic, with the server's
   * answer as the thing that rolls it back.
   */
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

      // Confirm it landed. A select that silently posts gives the user no way
      // to know whether the assignment took — and "did that save?" is the
      // question people answer by clicking it again.
      if (response.ok) {
        const name = members.find((m) => m.userId === assigneeId)?.name;
        const who = name ? `Assigned to ${name}` : "Assignment cleared";
        setStatus(dueAt ? `${who}, due ${dueDayLabel(dueAt)}.` : `${who}.`);
        return;
      }

      // Drop the edit so both controls fall back to what the server actually
      // holds, rather than showing a change that was refused.
      setEdits((prev) => {
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
      setError(response.error);
    });
  }

  const decided = Object.keys(done).length;

  /**
   * Screening without a mouse.
   *
   * Three hundred papers is three hundred round trips between the keyboard and
   * the pointer if the only way to include something is to click a button. The
   * shortcuts are single letters because that is what the hand can do without
   * looking: `i` and `e` for the two decisions, `s` to skip, digits to pick an
   * exclusion reason, `?` for the list.
   *
   * Not registered while focus is in a field. Typing "site" into the assignee
   * box should not include, exclude, skip and then exclude again — which is
   * what a naive document listener does, and it is the reason so many apps
   * quietly abandoned their shortcuts.
   *
   * Modifier chords are left alone too, so ⌘I and Ctrl+E still belong to the
   * browser.
   */
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
          // Announced, because otherwise pressing 3 changes a select the user
          // may not be looking at and nothing says which reason they armed.
          setStatus(`Exclusion reason: ${picked.label}. Press E to exclude.`);
        }
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // `decide` closes over `current` and `reason`, so the listener has to be
    // re-registered when they change. Omitting them is how a shortcut ends up
    // deciding on the paper before last.
  });

  if (!current) {
    return (
      <div className="border-border rounded-lg border border-dashed p-8 text-center">
        <p className="text-ink font-medium">
          {decided > 0 ? "That is everything for now." : "Nothing to screen."}
        </p>
        <p className="text-muted text-ui mt-1">
          {decided > 0
            ? `${decided} ${decided === 1 ? "decision" : "decisions"} recorded.`
            : "Papers appear here once they are added to the library."}
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <p className="text-muted text-ui" aria-live="polite">
        {remaining.length} left{decided > 0 && ` · ${decided} decided this session`}
        {/* Duplicated effort is worth showing. Four people sharing one queue
            will land on the same papers, and a screener who cannot see that
            has no way to know their afternoon overlapped a colleague's. */}
        {conflicts > 0 && ` · ${conflicts} already handled by someone else`}
      </p>

      {/* The pile, and the paper.

          The list is the part that was missing. This screen rendered exactly
          one <article> and a "{n} left" counter, which is the entire model of
          scope it offered for a task people do three hundred times in an
          afternoon: you could not see what was coming, could not tell whether
          the queue was one search or five, and could not pick the paper you
          were actually ready to judge.

          It is `lg` and up only. On a phone the one-at-a-time flow is right —
          there is no room for a column, and a list that pushes the abstract
          below the fold makes the common case worse to fix the rare one. */}
      <div className="lg:grid lg:grid-cols-[16rem_1fr] lg:gap-8">
        <nav
          aria-label="Screening queue"
          className="border-rule sticky top-[var(--app-header-h)] hidden max-h-[calc(100dvh-var(--app-header-h)-2rem)] overflow-y-auto border-r pr-3 lg:block"
        >
          {/* What the queue contains, and in what order. Both narrow the list
              below, so they sit above it rather than in a settings menu. */}
          <div className="mb-4 flex flex-col gap-2">
            <Select
              value={sortMode}
              onChange={(event) => {
                const picked = SORT_MODES.find((m) => m.value === event.target.value);
                if (picked) setSortMode(picked.value);
              }}
              aria-label="Sort queue"
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

          <ul className="flex flex-col gap-0.5">
            {remaining.map((row) => {
              const isCurrent = row.id === current.id;
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => select(row.id)}
                    aria-current={isCurrent ? "true" : undefined}
                    className={cx(
                      "focus-visible:ring-accent w-full rounded-lg px-2 py-2 text-left transition-colors",
                      "focus-visible:ring-2 focus-visible:outline-none",
                      isCurrent ? "bg-accent-soft" : "hover:bg-surface",
                    )}
                  >
                    <span
                      className={cx(
                        "text-fine block leading-snug text-pretty",
                        isCurrent ? "text-ink font-medium" : "text-muted",
                      )}
                    >
                      {row.title}
                    </span>
                    <span className="text-muted text-fine mt-0.5 block opacity-80">
                      {row.year ?? "no year"}
                      {/* Saying which ones you have already put off is the
                          point of putting them at the end. */}
                      {deferred[row.id] && " · skipped"}
                      {row.screenStatus !== "IDENTIFIED" &&
                        ` · ${screenStatusLabel(row.screenStatus)}`}
                      {row.assigneeId &&
                        ` · ${members.find((m) => m.userId === row.assigneeId)?.name ?? "assigned"}`}
                      {/* The day, not whether it has passed. Comparing against
                          `Date.now()` here would render differently on the
                          server and on the client and risk a hydration
                          mismatch; /assigned is a server component and is
                          where "Overdue" is said in red. */}
                      {row.dueAt && ` · due ${dueDayLabel(dueDayValue(row.dueAt))}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          <article className="border-rule border-t pt-6 lg:border-t-0 lg:pt-0">
            <h2 className="text-ink text-title">{current.title}</h2>
            <p className="meta mt-2">
              {current.authors}
              {current.venue && ` · ${current.venue}`}
              {current.year && ` · ${current.year}`}
            </p>

            {/* The link belongs HERE, next to the decision. This screen used to
            advise opening the paper first and then offer no way to do it. */}
            <SourceLinks className="mt-3" title={current.title} work={current} />
            {/* Paywalls are the everyday reality here, and the moment someone
                needs a way past one is the moment they are deciding about
                the paper. */}
            <AccessHelp
              className="mt-2"
              route={accessRoute}
              doi={current.doi}
              title={current.title}
              oaPdfUrl={current.oaPdfUrl}
            />

            {current.abstract ? (
              <p className="prose-body mt-5">{current.abstract}</p>
            ) : (
              <p className="text-muted measure text-ui mt-5 italic">
                No abstract on record — decide from the title, or open the paper above.
              </p>
            )}

            <p className="meta mt-6 uppercase">
              {screenStatusLabel(current.screenStatus)}
            </p>
          </article>

          <div className="flex flex-wrap items-end gap-3">
            {/* Deliberately NOT disabled while a request is in flight. Blocking
            the next decision on the previous one's round trip is precisely
            the pause the optimistic path exists to remove, and each request
            targets a different paper so they cannot race each other. */}
            <Button onClick={() => decide("INCLUDED")}>Include</Button>

            {/* The reason sits NEXT TO Exclude, not in a dialog after it.
                For a systematic review it is required, so a person who has
                to click Exclude before being told that has been made to do
                the decision twice. The 1–9 shortcuts set this same value. */}
            <div className="flex items-end gap-2">
              <label className="text-muted text-fine flex flex-col gap-1">
                Exclusion reason
                <Select
                  value={reason}
                  onChange={(event) =>
                    setReason(event.target.value as ExclusionReason | "")
                  }
                >
                  <option value="">{reasonRequired ? "Choose one…" : "None"}</option>
                  {EXCLUSION_REASONS.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </label>

              <Button variant="danger" onClick={() => decide("EXCLUDED")}>
                Exclude
              </Button>
            </div>

            <Button variant="ghost" disabled={pending} onClick={skip}>
              Skip for now
            </Button>
          </div>

          <div className="flex max-w-lg flex-wrap items-end gap-3">
            <label className="text-muted text-fine flex min-w-[12rem] flex-1 flex-col gap-1">
              Assign to
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

            {/* The deadline is stated on the control, not left to be
                inferred. "Due the 20th" is ambiguous across four timezones in
                a way nobody discovers until the day someone is called late by
                it — which is the hazard B-07 is about. */}
            <label className="text-muted text-fine flex flex-col gap-1">
              Due by (23:59 UTC)
              <Input
                type="date"
                value={assignment.dueAt}
                onChange={(event) => assign(assignment.assigneeId, event.target.value)}
                disabled={pending}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="border-rule border-t pt-3">
        <button
          type="button"
          onClick={() => setShowKeys((v) => !v)}
          aria-expanded={showKeys}
          className="text-muted hover:text-ink text-fine focus-visible:ring-accent inline-flex min-h-11 items-center rounded focus-visible:ring-2 focus-visible:outline-none"
        >
          {/* Visible, not hidden. A shortcut nobody is told about is a feature
              for the person who wrote it. */}
          Keyboard: <Key>I</Key> include · <Key>E</Key> exclude · <Key>S</Key> skip ·{" "}
          <Key>?</Key> all
        </button>

        {showKeys && (
          <dl className="text-muted text-fine mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt>
              <Key>I</Key>
            </dt>
            <dd>Include this paper</dd>
            <dt>
              <Key>E</Key>
            </dt>
            <dd>Exclude it, using the reason currently chosen</dd>
            <dt>
              <Key>S</Key>
            </dt>
            <dd>Skip for now — records that you looked, and moves it to the end</dd>
            <dt>
              <Key>1</Key>–<Key>9</Key>
            </dt>
            <dd>Choose an exclusion reason, in the order listed</dd>
            <dt>
              <Key>?</Key>
            </dt>
            <dd>Show or hide this list</dd>
          </dl>
        )}
      </div>

      <div aria-live="polite">
        {status && <p className="text-muted text-ui">{status}</p>}
        {error && (
          <p role="alert" className="text-danger text-ui">
            {error}
          </p>
        )}
      </div>
    </section>
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
    <kbd className="border-border bg-surface text-ink mx-0.5 rounded border px-1.5 py-0.5 font-mono text-[0.75rem]">
      {children}
    </kbd>
  );
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

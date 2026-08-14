"use client";

import {
  EXCLUSION_REASONS,
  screenStatusLabel,
  type ExclusionReason,
} from "@porcupine/shared";
import { useEffect, useState, useTransition } from "react";

import { Button, Select } from "@/components/ui";

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
}

export interface Member {
  userId: string;
  name: string;
}

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
  rows,
  members,
  reasonRequired,
  currentUserId,
}: {
  projectId: string;
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
  const [reason, setReason] = useState<ExclusionReason | "">("");
  const [showKeys, setShowKeys] = useState(false);
  const [pending, startTransition] = useTransition();

  const remaining = rows.filter((row) => !done[row.id]);
  const current = remaining[Math.min(index, remaining.length - 1)];

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

    setDone((prev) => ({ ...prev, [target.id]: toStatus }));
    setReason("");
    setIndex(0);
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

  function assign(userId: string) {
    if (!current) return;
    setError(null);
    setStatus(null);

    startTransition(async () => {
      const response = await assignWork({
        projectId,
        projectWorkId: current.id,
        assigneeId: userId || null,
      });

      // Confirm it landed. A select that silently posts gives the user no way
      // to know whether the assignment took — and "did that save?" is the
      // question people answer by clicking it again.
      if (response.ok) {
        const name = members.find((m) => m.userId === userId)?.name;
        setStatus(name ? `Assigned to ${name}.` : "Assignment cleared.");
      } else setError(response.error);
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
        setIndex((i) => i + 1);
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

      {/* The surface someone sees three hundred times in an afternoon. No
          card, no border: the paper IS the page. Title in the display serif,
          metadata quiet beneath it, abstract at reading size and measure. */}
      <article className="border-rule border-t pt-6">
        <h2 className="text-ink text-title">{current.title}</h2>
        <p className="meta mt-2">
          {current.authors}
          {current.venue && ` · ${current.venue}`}
          {current.year && ` · ${current.year}`}
        </p>

        {current.abstract ? (
          <p className="prose-body mt-5">{current.abstract}</p>
        ) : (
          <p className="text-muted measure text-ui mt-5 italic">
            No abstract — decide from the title, or open the paper first.
          </p>
        )}

        <p className="meta mt-6 uppercase">{screenStatusLabel(current.screenStatus)}</p>
      </article>

      <div className="flex flex-wrap items-end gap-3">
        {/* Deliberately NOT disabled while a request is in flight. Blocking
            the next decision on the previous one's round trip is precisely
            the pause the optimistic path exists to remove, and each request
            targets a different paper so they cannot race each other. */}
        <Button onClick={() => decide("INCLUDED")}>Include</Button>

        <div className="flex items-end gap-2">
          <label className="text-muted text-fine flex flex-col gap-1">
            Exclusion reason
            <Select
              value={reason}
              onChange={(e) => setReason(e.target.value as ExclusionReason | "")}
              className="border-border bg-surface text-ink text-ui min-h-11 rounded-lg border px-2"
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

        <Button variant="ghost" onClick={() => setIndex((i) => i + 1)}>
          Skip
        </Button>
      </div>

      <label className="text-muted text-fine flex max-w-xs flex-col gap-1">
        Assign to
        <Select
          value={current.assigneeId ?? ""}
          onChange={(e) => assign(e.target.value)}
          disabled={pending}
          className="border-border bg-surface text-ink text-ui min-h-11 rounded-lg border px-2"
        >
          <option value="">Nobody</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.userId === currentUserId ? `${m.name} (me)` : m.name}
            </option>
          ))}
        </Select>
      </label>

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
            <dd>Skip — leaves it undecided and shows the next</dd>
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

/** A keycap. Small enough to be inline, distinct enough to be read as a key. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="border-border bg-surface text-ink mx-0.5 rounded border px-1.5 py-0.5 font-mono text-[0.75rem]">
      {children}
    </kbd>
  );
}

"use client";

import {
  EXCLUSION_REASONS,
  screenStatusLabel,
  type ExclusionReason,
} from "@porcupine/shared";
import { useState, useTransition } from "react";

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
  const [pending, startTransition] = useTransition();

  const remaining = rows.filter((row) => !done[row.id]);
  const current = remaining[Math.min(index, remaining.length - 1)];

  function decide(toStatus: "INCLUDED" | "EXCLUDED" | "SCREENING") {
    if (!current) return;
    setError(null);

    if (toStatus === "EXCLUDED" && reasonRequired && !reason) {
      setError("Choose a reason before excluding — this is a systematic review.");
      return;
    }

    startTransition(async () => {
      const response = await recordDecision({
        projectId,
        projectWorkId: current.id,
        toStatus,
        excludeReason: toStatus === "EXCLUDED" ? reason || null : null,
        // Compare-and-swap: the status this screen was SHOWING when the
        // person decided. If the paper has moved since, the server refuses
        // rather than letting this decision overwrite a colleague's.
        seenStatus: current.screenStatus as typeof toStatus,
      });

      if (response.ok) {
        setDone((prev) => ({ ...prev, [current.id]: toStatus }));
        setReason("");
        setIndex(0);

        // Not an error — the paper is simply already handled. Naming who did
        // it explains why it left the queue, instead of leaving the person
        // wondering whether their click registered.
        if (response.data.conflict) {
          setConflicts((n) => n + 1);
          setStatus(`Already screened by ${response.data.conflict.by} — moved on.`);
        } else {
          setStatus(null);
        }
      } else setError(response.error);
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
        <Button onClick={() => decide("INCLUDED")} disabled={pending}>
          Include
        </Button>

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
          <Button variant="danger" onClick={() => decide("EXCLUDED")} disabled={pending}>
            Exclude
          </Button>
        </div>

        <Button variant="ghost" onClick={() => setIndex((i) => i + 1)} disabled={pending}>
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

"use client";

import {
  EXCLUSION_REASONS,
  screenStatusLabel,
  type ExclusionReason,
} from "@porcupine/shared";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui";

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
      });

      if (response.ok) {
        setDone((prev) => ({ ...prev, [current.id]: toStatus }));
        setReason("");
        setIndex(0);
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
        <p className="text-muted mt-1 text-sm">
          {decided > 0
            ? `${decided} ${decided === 1 ? "decision" : "decisions"} recorded.`
            : "Papers appear here once they are added to the library."}
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <p className="text-muted text-sm" aria-live="polite">
        {remaining.length} left{decided > 0 && ` · ${decided} decided this session`}
      </p>

      <article className="border-border bg-surface rounded-lg border p-5">
        <h2 className="text-ink text-lg font-medium">{current.title}</h2>
        <p className="text-muted mt-1 text-sm">
          {current.authors}
          {current.venue && ` · ${current.venue}`}
          {current.year && ` · ${current.year}`}
        </p>

        {current.abstract ? (
          <p className="text-ink/80 mt-4 text-sm leading-relaxed">{current.abstract}</p>
        ) : (
          <p className="text-muted mt-4 text-sm italic">
            No abstract — decide from the title, or open the paper first.
          </p>
        )}

        <p className="text-muted mt-4 font-mono text-xs uppercase">
          {screenStatusLabel(current.screenStatus)}
        </p>
      </article>

      <div className="flex flex-wrap items-end gap-3">
        <Button onClick={() => decide("INCLUDED")} disabled={pending}>
          Include
        </Button>

        <div className="flex items-end gap-2">
          <label className="text-muted flex flex-col gap-1 text-xs">
            Exclusion reason
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as ExclusionReason | "")}
              className="border-border bg-surface text-ink min-h-11 rounded-lg border px-2 text-sm"
            >
              <option value="">{reasonRequired ? "Choose one…" : "None"}</option>
              {EXCLUSION_REASONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <Button variant="danger" onClick={() => decide("EXCLUDED")} disabled={pending}>
            Exclude
          </Button>
        </div>

        <Button variant="ghost" onClick={() => setIndex((i) => i + 1)} disabled={pending}>
          Skip
        </Button>
      </div>

      <label className="text-muted flex max-w-xs flex-col gap-1 text-xs">
        Assign to
        <select
          value={current.assigneeId ?? ""}
          onChange={(e) => assign(e.target.value)}
          disabled={pending}
          className="border-border bg-surface text-ink min-h-11 rounded-lg border px-2 text-sm"
        >
          <option value="">Nobody</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.userId === currentUserId ? `${m.name} (me)` : m.name}
            </option>
          ))}
        </select>
      </label>

      <div aria-live="polite">
        {status && <p className="text-muted text-sm">{status}</p>}
        {error && (
          <p role="alert" className="text-danger text-sm">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

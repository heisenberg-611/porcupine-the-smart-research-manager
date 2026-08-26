"use client";

import {
  EXCLUSION_REASONS,
  type ExclusionReason,
  exclusionReasonLabel,
  type ScreenStatus,
} from "@Porcupine/shared";
import { useEffect, useRef, useState, useTransition } from "react";

import { recordDecision } from "@/app/projects/[id]/screen/actions";
import { Button, Select, Textarea } from "@/components/ui";

export function LibraryRowActions({
  projectId,
  projectWorkId,
  paperTitle,
  currentStatus,
  currentReason,
  isSystematicReview,
}: {
  projectId: string;
  projectWorkId: string;
  paperTitle: string;
  currentStatus: string;
  currentReason: string | null;
  isSystematicReview: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedReason, setSelectedReason] = useState<ExclusionReason | "">(
    (currentReason as ExclusionReason) || "WRONG_POPULATION",
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isExcluded = currentStatus === "EXCLUDED";

  const openDialog = () => {
    setError(null);
    setSelectedReason((currentReason as ExclusionReason) || "WRONG_POPULATION");
    setNote("");
    dialogRef.current?.showModal();
  };

  const closeDialog = () => {
    dialogRef.current?.close();
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (e: MouseEvent) => {
      if (e.target === dialog) closeDialog();
    };
    dialog.addEventListener("click", handleCancel);
    return () => dialog.removeEventListener("click", handleCancel);
  }, []);

  const handleExclude = () => {
    if (isSystematicReview && !selectedReason) {
      setError("Please select an exclusion reason.");
      return;
    }

    startTransition(async () => {
      setError(null);
      const res = await recordDecision({
        projectId,
        projectWorkId,
        toStatus: "EXCLUDED",
        excludeReason: selectedReason ? (selectedReason as ExclusionReason) : null,
        note: note.trim() || null,
        seenStatus: currentStatus as ScreenStatus,
      });

      if (!res.ok) {
        setError(res.error);
        return;
      }

      closeDialog();
    });
  };

  const handleReInclude = () => {
    startTransition(async () => {
      setError(null);
      const res = await recordDecision({
        projectId,
        projectWorkId,
        toStatus: "INCLUDED",
        seenStatus: currentStatus as ScreenStatus,
      });

      if (!res.ok) {
        alert(res.error);
      }
    });
  };

  const statusTone =
    currentStatus === "EXCLUDED"
      ? "bg-rose-500/15 border-rose-500/30 text-rose-700 dark:text-rose-300"
      : currentStatus === "INCLUDED" ||
        currentStatus === "EXTRACTED" ||
        currentStatus === "SYNTHESIZED"
      ? "bg-accent/15 border-accent/30 text-accent"
      : currentStatus === "READING"
      ? "bg-purple-500/15 border-purple-500/30 text-purple-700 dark:text-purple-300"
      : "bg-surface border-border text-muted";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center rounded px-2 py-0.5 font-mono text-[10px] font-bold border ${statusTone}`}
        >
          {currentStatus}
        </span>
        {isExcluded && currentReason && (
          <span
            className="text-muted text-[10px] truncate max-w-[10rem]"
            title={exclusionReasonLabel(currentReason)}
          >
            {exclusionReasonLabel(currentReason)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {isExcluded ? (
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={handleReInclude}
              className="text-xs px-2.5 py-1 min-h-7 text-accent hover:bg-accent/10 rounded-lg"
              title="Include this paper back into review"
            >
              Re-include
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={openDialog}
              className="text-xs px-2.5 py-1 min-h-7 text-muted hover:text-ink hover:bg-surface rounded-lg"
              title="Change exclusion reason"
            >
              Edit reason
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={openDialog}
            className="text-xs px-2.5 py-1 min-h-7 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 rounded-lg font-medium"
            title="Exclude this paper from review"
          >
            Exclude
          </Button>
        )}
      </div>

      {/* Exclusion Reason Modal */}
      <dialog
        ref={dialogRef}
        className="bg-raised text-ink border-border/70 open:animate-in open:fade-in-0 open:zoom-in-95 m-auto max-w-md w-full rounded-2xl border p-6 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-xs"
      >
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-ink text-base font-bold">
              {isExcluded ? "Update Exclusion Reason" : "Exclude Paper from Review"}
            </h3>
            <p className="text-muted text-fine mt-1 line-clamp-2" title={paperTitle}>
              {paperTitle}
            </p>
          </div>

          <div className="space-y-3">
            <label className="block text-fine font-medium text-ink">
              Exclusion Category (PRISMA 2020)
              <Select
                value={selectedReason}
                onChange={(e) => setSelectedReason(e.target.value as ExclusionReason)}
                className="mt-1 w-full text-xs"
              >
                {EXCLUSION_REASONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="block text-fine font-medium text-ink">
              Specific Rationale Note (Optional)
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional notes or details for the review audit trail…"
                rows={3}
                className="mt-1 text-xs"
              />
            </label>
          </div>

          {error && (
            <div className="border-danger/30 bg-danger-soft/50 text-danger rounded-xl border p-3 text-xs">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={closeDialog}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={pending}
              busy={pending}
              busyLabel="Saving…"
              onClick={handleExclude}
              className="text-xs font-semibold"
            >
              Confirm Exclusion
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

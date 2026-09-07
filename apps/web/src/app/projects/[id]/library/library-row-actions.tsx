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
      ? "bg-danger-soft border-danger/30 text-danger"
      : currentStatus === "INCLUDED" ||
          currentStatus === "EXTRACTED" ||
          currentStatus === "SYNTHESIZED"
        ? "bg-accent-soft border-accent/30 text-accent"
        : currentStatus === "READING"
          ? "bg-purple-500/15 border-purple-500/30 text-purple-700 dark:text-purple-300"
          : "bg-surface border-border text-muted";

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Status Badge */}
        <span
          className={`inline-flex h-8 items-center rounded-xl border px-3 font-mono text-[11px] font-bold tracking-wider uppercase shadow-2xs ${statusTone}`}
        >
          {currentStatus}
        </span>

        {/* Action Button: Exclude or Re-include & Edit Reason */}
        {isExcluded ? (
          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={handleReInclude}
              className="focus-visible:ring-accent border-accent/30 bg-accent-soft text-accent hover:bg-accent hover:border-accent inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold shadow-xs transition-all duration-150 hover:-translate-y-0.5 hover:text-white hover:shadow-sm focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              title="Include this paper back into review"
            >
              <span aria-hidden="true" className="text-xs font-bold">
                ↩
              </span>
              <span>Re-include</span>
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={openDialog}
              className="focus-visible:ring-accent border-border bg-surface text-ink hover:bg-surface-raised hover:border-accent/50 inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold shadow-xs transition-all duration-150 hover:-translate-y-0.5 hover:shadow-sm focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              title="Change exclusion reason"
            >
              <span aria-hidden="true" className="text-[11px]">
                ✎
              </span>
              <span>Edit reason</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={openDialog}
            className="focus-visible:ring-danger border-danger/30 bg-danger-soft text-danger hover:bg-danger hover:border-danger inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold shadow-xs transition-all duration-150 hover:-translate-y-0.5 hover:text-white hover:shadow-sm focus-visible:ring-2 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
            title="Exclude this paper from review"
          >
            <span aria-hidden="true" className="text-xs font-bold">
              ✕
            </span>
            <span>Exclude</span>
          </button>
        )}
      </div>

      {/* Exclusion Reason Subtitle */}
      {isExcluded && currentReason && (
        <div
          className="text-muted bg-surface/80 border-border/70 flex max-w-[17rem] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs shadow-2xs"
          title={`Exclusion reason: ${exclusionReasonLabel(currentReason)}`}
        >
          <span className="text-ink-soft shrink-0 font-semibold">Reason:</span>
          <span className="truncate">{exclusionReasonLabel(currentReason)}</span>
        </div>
      )}

      {/* Exclusion Reason Modal */}
      <dialog
        ref={dialogRef}
        className="bg-raised text-ink border-border/70 open:animate-in open:fade-in-0 open:zoom-in-95 m-auto w-full max-w-md rounded-2xl border p-6 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-xs"
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
            <label className="text-fine text-ink block font-medium">
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

            <label className="text-fine text-ink block font-medium">
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

          <div className="border-border/60 flex items-center justify-end gap-2 border-t pt-2">
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

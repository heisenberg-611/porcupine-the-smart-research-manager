"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { deleteProject } from "@/app/projects/actions";
import { Button, Input } from "@/components/ui";

export function DeleteProjectDialog({
  projectId,
  projectTitle,
}: {
  projectId: string;
  projectTitle: string;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // We use state to track confirmation input
  const [confirmText, setConfirmText] = useState("");

  const expectedText = projectTitle;
  const canDelete = confirmText === expectedText;

  // Polyfill-free native dialog management.
  // showModal() gives us the focus trap, escape-to-close, and backdrop
  // that a professional warning needs.
  const open = () => {
    setError(null);
    setConfirmText("");
    dialogRef.current?.showModal();
  };

  const close = () => {
    dialogRef.current?.close();
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Handle clicks on the backdrop to close the dialog
    const handleCancel = (e: MouseEvent) => {
      if (e.target === dialog) {
        close();
      }
    };
    dialog.addEventListener("click", handleCancel);
    return () => dialog.removeEventListener("click", handleCancel);
  }, []);

  const handleDelete = async () => {
    if (!canDelete) return;

    setIsDeleting(true);
    setError(null);

    const result = await deleteProject({ projectId });
    if (result.ok) {
      close();
      router.push("/projects");
    } else {
      setError(result.error);
      setIsDeleting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="text-danger hover:bg-danger-soft w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition-all duration-200 hover:translate-x-1"
      >
        Delete Project
      </button>

      <dialog
        ref={dialogRef}
        className="bg-raised text-ink border-danger/30 open:animate-in open:fade-in-0 open:zoom-in-95 m-auto w-full max-w-lg rounded-xl border p-0 shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
      >
        <div className="flex flex-col gap-5 p-6">
          <div>
            <h2 className="text-danger mb-2 text-xl font-bold">Delete Project?</h2>
            <p className="text-ui text-muted leading-relaxed">
              This action is{" "}
              <strong className="text-ink">permanent and cannot be undone</strong>.
              Deleting this project will immediately destroy:
            </p>
            <ul className="text-ui text-muted mt-3 list-inside list-disc space-y-1">
              <li>All project data and metadata</li>
              <li>Every uploaded file and PDF</li>
              <li>All member access and roles</li>
              <li>All tasks, extractions, and history</li>
            </ul>
          </div>

          <div className="bg-danger-soft/50 border-danger/20 rounded-lg border p-4">
            <label
              htmlFor="confirm-delete"
              className="text-ui text-ink mb-2 block font-medium"
            >
              Please type{" "}
              <strong className="bg-surface rounded px-1 py-0.5 font-mono select-all">
                {expectedText}
              </strong>{" "}
              to confirm.
            </label>
            {/* The shared primitive. The hand-rolled version here carried
                `focus:border-danger focus:ring-danger` to make the confirmation
                field read as dangerous, and neither ever applied: the focus
                rule this app draws sat outside every cascade layer at the time
                and outranked both. What it actually produced was the standard
                indicator plus a red ring nobody ever saw. */}
            <Input
              id="confirm-delete"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={expectedText}
              autoComplete="off"
            />
          </div>

          {error && (
            <p className="text-danger bg-danger-soft rounded-lg px-3 py-2 text-sm">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={close} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!canDelete || isDeleting}
              onClick={handleDelete}
              busy={isDeleting}
              busyLabel="Deleting…"
            >
              Delete Project
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { deleteProject } from "@/app/projects/actions";
import { Button } from "@/components/ui";

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
        className="w-full text-left px-3 py-2 text-danger hover:bg-danger-soft hover:translate-x-1 rounded-lg text-sm font-semibold transition-all duration-200"
      >
        Delete Project
      </button>

      <dialog
        ref={dialogRef}
        className="m-auto backdrop:bg-black/50 backdrop:backdrop-blur-sm bg-raised text-ink border border-danger/30 rounded-xl shadow-2xl p-0 w-full max-w-lg open:animate-in open:fade-in-0 open:zoom-in-95"
      >
        <div className="p-6 flex flex-col gap-5">
          <div>
            <h2 className="text-xl font-bold text-danger mb-2">Delete Project?</h2>
            <p className="text-ui text-muted leading-relaxed">
              This action is <strong className="text-ink">permanent and cannot be undone</strong>. 
              Deleting this project will immediately destroy:
            </p>
            <ul className="list-disc list-inside mt-3 space-y-1 text-ui text-muted">
              <li>All project data and metadata</li>
              <li>Every uploaded file and PDF</li>
              <li>All member access and roles</li>
              <li>All tasks, extractions, and history</li>
            </ul>
          </div>
          
          <div className="bg-danger-soft/50 border border-danger/20 rounded-lg p-4">
            <label htmlFor="confirm-delete" className="block text-ui font-medium text-ink mb-2">
              Please type <strong className="font-mono bg-surface px-1 py-0.5 rounded select-all">{expectedText}</strong> to confirm.
            </label>
            <input
              id="confirm-delete"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-ink focus:border-danger focus:ring-1 focus:ring-danger focus:outline-none"
              placeholder={expectedText}
              autoComplete="off"
            />
          </div>

          {error && (
            <p className="text-danger text-sm bg-danger-soft px-3 py-2 rounded-lg">
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
            >
              {isDeleting ? "Deleting..." : "Delete Project"}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}

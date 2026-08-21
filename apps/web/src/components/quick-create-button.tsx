"use client";

import { useRef, useState } from "react";
import { createCollaborationFile } from "@/app/projects/[id]/docs/actions";
import { Button } from "@/components/ui";

export function QuickCreateButton({
  type,
  projectId,
  label,
}: {
  type: "doc" | "sheet" | "slide";
  projectId: string;
  label: string;
}) {
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  return (
    <>
      <button
        disabled={pending}
        aria-busy={pending || undefined}
        onClick={async () => {
          setPending(true);
          const res = await createCollaborationFile({
            projectId,
            title: "New Document",
            type,
          });
          if (res.ok) {
            if (res.data?.url) {
              if (res.data.isFallback) {
                setFallbackUrl(res.data.url);
                dialogRef.current?.showModal();
              } else {
                window.open(res.data.url, "_blank");
              }
            } else {
              alert("Failed to create file. URL not returned.");
            }
          } else {
            alert(
              res.error ||
                "Failed to create file. You might need to connect your Google account in the Docs tab.",
            );
          }
          setPending(false);
        }}
        className="text-ui text-muted hover:text-ink hover:bg-surface/50 flex h-8 items-center rounded-lg px-3 text-left transition-all duration-200 hover:translate-x-1 active:scale-95 disabled:opacity-50 disabled:hover:translate-x-0 disabled:active:scale-100"
      >
        <span className="text-muted/50 mr-3" aria-hidden="true">
          {pending ? "…" : "+"}
        </span>{" "}
        {pending ? "Creating…" : label}
      </button>

      <dialog
        ref={dialogRef}
        className="bg-canvas border-rule text-ink m-auto w-[90vw] max-w-md rounded-[--radius-card] border p-6 shadow-xl backdrop:bg-black/50 backdrop:backdrop-blur-sm"
        onCancel={() => {
          dialogRef.current?.close();
          setFallbackUrl(null);
        }}
      >
        <div className="flex flex-col gap-5">
          <div>
            <h3 className="text-warning mb-2 text-lg font-semibold tracking-tight">Created in Personal Drive</h3>
            <p className="text-muted text-sm leading-relaxed">
              Google Drive blocked creating this file in the shared project folder because of a permission limitation. 
            </p>
            <p className="text-muted mt-2 text-sm leading-relaxed">
              As a fallback, the file has been successfully created in your personal Google Drive in a folder named <span className="font-semibold text-ink">Porcupine: Project Name (Personal)</span>. It is still linked to this project and visible to you here.
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <Button 
              variant="primary" 
              onClick={() => {
                dialogRef.current?.close();
                if (fallbackUrl) {
                  window.open(fallbackUrl, "_blank");
                }
                setFallbackUrl(null);
              }}
            >
              Open Document
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}

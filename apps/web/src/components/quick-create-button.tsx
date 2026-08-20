"use client";

import { useState } from "react";
import { createCollaborationFile } from "@/app/projects/[id]/docs/actions";

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

  return (
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
            window.open(res.data.url, "_blank");
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
      {/* The label carries it, not only the glyph: "+ Create Doc" going quiet
          for two seconds looks like a press that missed. */}
      <span className="text-muted/50 mr-3" aria-hidden="true">
        {pending ? "…" : "+"}
      </span>{" "}
      {pending ? "Creating…" : label}
    </button>
  );
}

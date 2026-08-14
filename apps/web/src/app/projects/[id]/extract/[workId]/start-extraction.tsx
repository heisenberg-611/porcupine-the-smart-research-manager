"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui";

import { startExtraction } from "./actions";

/**
 * Starting is explicit rather than implicit.
 *
 * Creating the row on page load would mean every glance at a paper produced a
 * DRAFT extraction, and a project would fill with empty ones that the evidence
 * table then reports as rows with no answers.
 */
export function StartExtraction({
  projectId,
  projectWorkId,
  protocolId,
  protocolName,
  fieldCount,
}: {
  projectId: string;
  projectWorkId: string;
  protocolId: string;
  protocolName: string;
  fieldCount: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="border-rule flex flex-col items-start gap-4 rounded-[--radius-card] border border-dashed px-6 py-10">
      <h2 className="text-ink text-heading">Extract from this paper</h2>
      <p className="text-muted measure text-ui text-pretty">
        {protocolName} asks {fieldCount} {fieldCount === 1 ? "question" : "questions"}.
        Your answers are a draft until you submit them, and yours alone until then.
      </p>

      <Button
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const response = await startExtraction({
              projectId,
              projectWorkId,
              protocolId,
            });
            if (!response.ok) setError(response.error);
          });
        }}
      >
        {pending ? "Starting…" : "Start extracting"}
      </Button>

      {error && (
        <p role="alert" className="text-danger text-ui">
          {error}
        </p>
      )}
    </div>
  );
}

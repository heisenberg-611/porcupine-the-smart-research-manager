"use client";

import { useState } from "react";

import { Button } from "@/components/ui";

/**
 * The PRISMA counts, as text, on the clipboard.
 *
 * Until this existed the only way to get these figures into a manuscript was a
 * screenshot or retyping them, and a retyped count is how a methods section
 * ends up disagreeing with the data it claims to describe. The whole argument
 * for deriving the diagram from recorded decisions is that the numbers cannot
 * drift; making people copy them by eye put the drift back at the last step.
 */
export function CopyNumbers({ lines }: { lines: string[] }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      // Long enough to be read, short enough that the button does not stay
      // lying about its state if the user copies something else meanwhile.
      setTimeout(() => setCopied(false), 4000);
    } catch {
      // Clipboard access is refused outright in some contexts, and a silent
      // no-op would look like a copy that worked.
      setFailed(true);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <Button variant="ghost" className="border-border border" onClick={copy}>
        {copied ? "Copied" : "Copy the numbers"}
      </Button>
      <span aria-live="polite" className="text-muted text-fine">
        {copied && "Counts copied as text."}
        {failed && "This browser refused clipboard access — select the table instead."}
      </span>
    </span>
  );
}

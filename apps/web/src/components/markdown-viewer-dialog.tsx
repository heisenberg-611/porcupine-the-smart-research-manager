"use client";

import { useEffect, useRef, useState } from "react";
import { Button, FormattedText, Skeleton } from "@/components/ui";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export interface MarkdownViewerDialogProps {
  /** If markdown text is already in memory, pass it here. */
  content?: string;
  /** If markdown should be fetched dynamically when opened, pass fetchUrl. */
  fetchUrl?: string;
  /** Dialog title */
  title?: string;
  /** Filename for download */
  filename?: string;
  /** Trigger element or custom button text */
  triggerLabel?: string;
  triggerVariant?: "ghost" | "primary" | "danger";
  triggerClassName?: string;
}

/**
 * A rich Markdown viewer dialog with interactive Rendered Preview and Raw Markdown tabs,
 * instant copy to clipboard, and one-click file download.
 */
export function MarkdownViewerDialog({
  content,
  fetchUrl,
  title = "Evidence Markdown Viewer",
  filename = "evidence.md",
  triggerLabel = "Preview Markdown",
  triggerVariant = "ghost",
  triggerClassName,
}: MarkdownViewerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [activeTab, setActiveTab] = useState<"preview" | "raw">("preview");
  const [markdown, setMarkdown] = useState<string>(content ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const open = async () => {
    dialogRef.current?.showModal();

    if (fetchUrl && !content) {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(fetchUrl);
        if (!response.ok) {
          throw new Error(`Failed to load markdown (HTTP ${response.status})`);
        }
        const text = await response.text();
        setMarkdown(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load document");
      } finally {
        setLoading(false);
      }
    } else if (content) {
      setMarkdown(content);
    }
  };

  const close = () => {
    dialogRef.current?.close();
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleBackdropClick = (e: MouseEvent) => {
      if (e.target === dialog) {
        close();
      }
    };
    dialog.addEventListener("click", handleBackdropClick);
    return () => dialog.removeEventListener("click", handleBackdropClick);
  }, []);

  const onCopy = async () => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const onDownload = () => {
    if (!markdown) return;
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".md") ? filename : `${filename}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const lineCount = markdown ? markdown.split("\n").length : 0;
  const wordCount = markdown
    ? markdown
        .trim()
        .split(/\s+/)
        .filter(Boolean).length
    : 0;

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        onClick={open}
        className={triggerClassName}
        aria-label={triggerLabel}
      >
        <MarkdownIcon className="size-4 text-accent" />
        <span>{triggerLabel}</span>
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby="md-viewer-title"
        className="bg-raised text-ink border-border/70 open:animate-in open:fade-in-0 open:zoom-in-95 m-auto flex h-[88vh] w-[92vw] max-w-5xl flex-col overflow-hidden rounded-2xl border p-0 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        {/* Header */}
        <div className="border-border/70 bg-surface/90 flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="bg-accent/10 text-accent ring-accent/20 flex size-9 items-center justify-center rounded-xl ring-1">
              <MarkdownIcon className="size-5" />
            </div>
            <div>
              <h2
                id="md-viewer-title"
                className="text-ink text-base font-bold sm:text-lg"
              >
                {title}
              </h2>
              <p className="text-muted text-fine mt-0.5">
                {loading
                  ? "Generating document..."
                  : `${lineCount} lines · ${wordCount.toLocaleString()} words · Ready for review & AI`}
              </p>
            </div>
          </div>

          {/* Mode Switcher + Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="bg-raised border-border/70 inline-flex rounded-lg border p-0.5 shadow-2xs">
              <button
                type="button"
                onClick={() => setActiveTab("preview")}
                className={cx(
                  "focus-visible:ring-accent inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all focus-visible:ring-2 focus-visible:outline-none",
                  activeTab === "preview"
                    ? "bg-accent text-accent-ink shadow-xs"
                    : "text-muted hover:text-ink",
                )}
              >
                <EyeIcon className="size-3.5" />
                Rendered Preview
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("raw")}
                className={cx(
                  "focus-visible:ring-accent inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all focus-visible:ring-2 focus-visible:outline-none",
                  activeTab === "raw"
                    ? "bg-accent text-accent-ink shadow-xs"
                    : "text-muted hover:text-ink",
                )}
              >
                <CodeIcon className="size-3.5" />
                Raw Markdown
              </button>
            </div>

            <Button
              type="button"
              variant="ghost"
              onClick={onCopy}
              disabled={loading || !markdown}
              className="text-xs font-medium"
              aria-label="Copy markdown to clipboard"
            >
              {copied ? (
                <CheckIcon className="size-4 text-accent" />
              ) : (
                <CopyIcon className="size-4" />
              )}
              <span>{copied ? "Copied!" : "Copy"}</span>
            </Button>

            <Button
              type="button"
              onClick={onDownload}
              disabled={loading || !markdown}
              className="text-xs font-semibold"
              aria-label="Download markdown file"
            >
              <DownloadIcon className="size-4" />
              <span>Download .md</span>
            </Button>

            <button
              type="button"
              onClick={close}
              aria-label="Close viewer"
              className="text-muted hover:bg-surface hover:text-ink focus-visible:ring-accent inline-flex size-8 items-center justify-center rounded-lg text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body Viewport */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-8">
          {loading && (
            <div className="space-y-4 py-8">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <div className="space-y-2 pt-4">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            </div>
          )}

          {error && (
            <div className="border-danger/30 bg-danger-soft/50 text-danger rounded-2xl border p-6 text-center">
              <p className="text-ui font-semibold">Failed to load Markdown</p>
              <p className="text-fine mt-1">{error}</p>
            </div>
          )}

          {!loading && !error && activeTab === "preview" && (
            <div className="prose-porcupine text-ink max-w-none">
              <FormattedText text={markdown} />
            </div>
          )}

          {!loading && !error && activeTab === "raw" && (
            <div className="border-border/70 bg-surface/80 relative rounded-xl border p-4 shadow-xs">
              <pre className="text-ink font-mono text-xs leading-relaxed whitespace-pre-wrap select-all">
                <code>{markdown}</code>
              </pre>
            </div>
          )}
        </div>

        {/* Footer info bar */}
        <div className="border-border/60 bg-surface/50 text-muted text-fine flex items-center justify-between border-t px-6 py-3">
          <span>Format: GitHub Flavored Markdown (GFM) with UTF-8 encoding</span>
          <span>Ready for LLM fine-tuning & prompt ingestion</span>
        </div>
      </dialog>
    </>
  );
}

function MarkdownIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M14.5 2H1.5A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2zM2 11.5V4.5h2l2 2.5 2-2.5h2v7H8.5V7.5L6.5 10 4.5 7.5v4H2zm10.5-2V7H14v2.5h1.5l-2.25 3-2.25-3H12.5z" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path
        fillRule="evenodd"
        d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CodeIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M6.28 5.22a.75.75 0 0 1 0 1.06L2.56 10l3.72 3.72a.75.75 0 0 1-1.06 1.06L.97 10.53a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Zm7.44 0a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L17.44 10l-3.72-3.72a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12a1.5 1.5 0 0 1 .439 1.061V14.5A1.5 1.5 0 0 1 15.5 16h-7A1.5 1.5 0 0 1 7 14.5v-11Z" />
      <path d="M5 6a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 18h7a1.5 1.5 0 0 0 1.5-1.5v-.5H7A2.5 2.5 0 0 1 4.5 13.5V6H5Z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M4.5 2A1.5 1.5 0 0 0 3 3.5v13A1.5 1.5 0 0 0 4.5 18h11a1.5 1.5 0 0 0 1.5-1.5V7.621a1.5 1.5 0 0 0-.44-1.06l-4.12-4.122A1.5 1.5 0 0 0 11.378 2H4.5Zm4.75 6.75a.75.75 0 0 1 1.5 0v3.94l1.22-1.22a.75.75 0 1 1 1.06 1.06l-2.5 2.5a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 1 1 1.06-1.06l1.22 1.22V8.75Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

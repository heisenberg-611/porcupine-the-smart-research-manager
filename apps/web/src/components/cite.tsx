"use client";

import { useState } from "react";

import { Button } from "@/components/ui";

/**
 * A citation for one paper, on the clipboard, in the format the reader wants.
 *
 * Students copy citations constantly and the alternative is retyping an author
 * list from a PDF, which is where wrong years and missing initials come from.
 * The record already holds everything a reference needs.
 *
 * BibTeX first because it is what a thesis written in LaTeX consumes and what
 * Zotero, Mendeley and JabRef all import. RIS is the other half of the world.
 * APA is the one people paste straight into a document.
 *
 * Not a citation ENGINE. There are thousands of styles and getting one subtly
 * wrong is worse than not offering it, so this offers three exact formats and
 * points at Zotero for the rest.
 */

export interface CitableWork {
  title: string;
  authors: { name: string }[];
  venue?: string | null | undefined;
  publishedYear?: number | null | undefined;
  doi?: string | null | undefined;
  arxivId?: string | null | undefined;
}

type Format = "bibtex" | "ris" | "apa";

const FORMATS: ReadonlyArray<{ id: Format; label: string }> = [
  { id: "bibtex", label: "BibTeX" },
  { id: "ris", label: "RIS" },
  { id: "apa", label: "APA" },
];

export function Cite({
  work,
  className = "",
}: {
  work: CitableWork;
  className?: string;
}) {
  const [copied, setCopied] = useState<Format | null>(null);
  const [failed, setFailed] = useState(false);

  async function copy(format: Format) {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(render(work, format));
      setCopied(format);
      setTimeout(() => setCopied(null), 4000);
    } catch {
      // Clipboard access is refused outright in some contexts, and a silent
      // no-op would look like a copy that worked.
      setFailed(true);
    }
  }

  return (
    <details className={`text-fine ${className}`}>
      <summary className="text-muted hover:text-ink focus-visible:ring-accent cursor-pointer rounded underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none">
        Cite
      </summary>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {FORMATS.map((format) => (
          <Button
            key={format.id}
            variant="ghost"
            className="border-border border"
            onClick={() => void copy(format.id)}
            aria-label={`Copy ${format.label} citation for ${work.title}`}
          >
            {copied === format.id ? "Copied" : format.label}
          </Button>
        ))}
      </div>

      <p aria-live="polite" className="text-muted mt-1">
        {copied && `${copied.toUpperCase()} citation copied.`}
        {failed && "This browser refused clipboard access."}
      </p>
    </details>
  );
}

/** Exported for the unit tests: formatting is the part worth pinning down. */
export function render(work: CitableWork, format: Format): string {
  const year = work.publishedYear ?? "n.d.";
  const names = work.authors.map((a) => a.name);

  if (format === "bibtex") {
    // A key a human can recognise in a .bib file: first author's surname, the
    // year, the first meaningful word of the title.
    const surname = (names[0] ?? "unknown").split(/\s+/).pop() ?? "unknown";
    const word = work.title.split(/\s+/).find((w) => w.length > 3) ?? "untitled";
    const key = `${surname}${year}${word}`.replace(/[^A-Za-z0-9]/g, "").toLowerCase();

    const lines = [
      `@article{${key},`,
      `  title = {{${work.title}}},`,
      names.length > 0 ? `  author = {${names.join(" and ")}},` : null,
      work.venue ? `  journal = {${work.venue}},` : null,
      work.publishedYear ? `  year = {${work.publishedYear}},` : null,
      work.doi ? `  doi = {${work.doi}},` : null,
      work.arxivId ? `  eprint = {${work.arxivId}},` : null,
      "}",
    ];
    return lines.filter(Boolean).join("\n");
  }

  if (format === "ris") {
    const lines = [
      "TY  - JOUR",
      ...names.map((n) => `AU  - ${n}`),
      `TI  - ${work.title}`,
      work.venue ? `JO  - ${work.venue}` : null,
      work.publishedYear ? `PY  - ${work.publishedYear}` : null,
      work.doi ? `DO  - ${work.doi}` : null,
      "ER  - ",
    ];
    return lines.filter(Boolean).join("\n");
  }

  // APA 7: up to 20 authors, ampersand before the last. Beyond that the rule
  // is an ellipsis, which is more style engine than belongs here — so it
  // truncates honestly rather than inventing a format.
  const authors =
    names.length === 0
      ? ""
      : names.length === 1
        ? names[0]!
        : `${names.slice(0, -1).join(", ")}, & ${names.at(-1)}`;

  return [
    authors && `${authors} `,
    `(${year}). `,
    `${work.title}. `,
    work.venue ? `${work.venue}. ` : "",
    work.doi ? `https://doi.org/${work.doi}` : "",
  ]
    .join("")
    .trim();
}

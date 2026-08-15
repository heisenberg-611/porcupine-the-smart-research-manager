import { normalizeArxivId, normalizeDoi } from "../normalize";
import { parseWorkInput, type WorkInput } from "../types";

import type { ParseResult } from "./bibtex";

/**
 * RIS — the format EndNote, Scopus, and Web of Science export.
 *
 * Much simpler than BibTeX: `TAG  - value`, two spaces before the hyphen,
 * one record per `TY`/`ER` pair. The complications are real but few:
 *
 *   - values wrap onto continuation lines with no tag
 *   - repeated tags (AU, KW) accumulate rather than overwrite
 *   - dates appear as `PY` (year), `DA` (full date), or `Y1`, inconsistently
 *   - some exporters use a single space before the hyphen
 *
 * Same posture as the BibTeX reader: a malformed record is skipped and
 * reported, never fatal.
 */

export interface RisRecord {
  /** Repeated tags keep every value; single tags keep the first. */
  fields: Record<string, string[]>;
}

const TAG_LINE = /^([A-Z][A-Z0-9])\s{1,2}-\s?(.*)$/;

export function parseRis(source: string): ParseResult<RisRecord> {
  const records: RisRecord[] = [];
  const problems: string[] = [];

  let current: Record<string, string[]> | null = null;
  let lastTag: string | null = null;
  let lineNumber = 0;

  for (const rawLine of source.split(/\r?\n/)) {
    lineNumber++;
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    const match = TAG_LINE.exec(line);

    if (!match) {
      // A continuation of the previous value — abstracts wrap constantly.
      if (current && lastTag) {
        const values = current[lastTag];
        if (values && values.length > 0) {
          values[values.length - 1] =
            `${values[values.length - 1]} ${line.trim()}`.trim();
        }
      }
      continue;
    }

    const [, tag, value] = match as unknown as [string, string, string];

    if (tag === "TY") {
      if (current) {
        // A new record began without the previous one ending. Keep what we
        // have — a missing ER is a common exporter bug, and discarding a
        // complete-looking record over it helps nobody.
        records.push({ fields: current });
        problems.push(`Record before line ${lineNumber} had no ER tag; kept anyway.`);
      }
      current = { TY: [value.trim()] };
      lastTag = "TY";
      continue;
    }

    if (tag === "ER") {
      if (current) records.push({ fields: current });
      current = null;
      lastTag = null;
      continue;
    }

    if (!current) continue; // Stray tag before any TY.

    (current[tag] ??= []).push(value.trim());
    lastTag = tag;
  }

  if (current) {
    records.push({ fields: current });
    problems.push("The last record had no ER tag; kept anyway.");
  }

  return { entries: records, problems };
}

const TYPE_MAP: Record<string, string> = {
  JOUR: "article",
  CPAPER: "article",
  CONF: "article",
  BOOK: "book",
  CHAP: "book",
  THES: "thesis",
  RPRT: "report",
  UNPB: "preprint",
  ELEC: "misc",
  GEN: "misc",
};

function first(fields: Record<string, string[]>, ...tags: string[]): string | null {
  for (const tag of tags) {
    const value = fields[tag]?.[0];
    if (value) return value;
  }
  return null;
}

export function risToWorkInput(record: RisRecord): WorkInput | null {
  const { fields } = record;

  // T1 is the primary title; TI is used by some exporters; BT is the book
  // title, which for a chapter is the container rather than the work.
  const title = first(fields, "T1", "TI", "BT");
  if (!title) return null;

  const yearRaw = first(fields, "PY", "Y1", "DA") ?? "";
  const year = Number(/\d{4}/.exec(yearRaw)?.[0]);

  const doiRaw = first(fields, "DO", "DOI");
  const urlRaw = first(fields, "UR", "L2");

  // arXiv links arrive in UR far more often than in any dedicated tag.
  const arxivFromUrl =
    urlRaw && /arxiv\.org/i.test(urlRaw) ? normalizeArxivId(urlRaw) : null;

  return {
    doi: doiRaw ? normalizeDoi(doiRaw) : null,
    arxivId: arxivFromUrl,
    pmid:
      first(fields, "AN") && /^\d+$/.test(first(fields, "AN") ?? "")
        ? first(fields, "AN")
        : null,
    title,
    abstract: first(fields, "AB", "N2"),
    authors: (fields.AU ?? fields.A1 ?? []).map((name, position) => ({
      name,
      orcid: null,
      affiliation: null,
      position,
    })),
    venue: first(fields, "JO", "JF", "T2", "PB"),
    publishedYear: Number.isFinite(year) ? year : null,
    type: TYPE_MAP[first(fields, "TY") ?? ""] ?? "misc",
    language: first(fields, "LA"),
    citedByCount: 0,
    referencedWorks: [],
    // A URL in an exported record is not evidence of open access (R-04).
    oaPdfUrl: null,
    raw: { ris: fields },
  };
}

export function importRis(source: string): ParseResult<WorkInput> {
  const { entries, problems } = parseRis(source);
  const works: WorkInput[] = [];

  for (const record of entries) {
    const kind = first(record.fields, "TY") ?? "record";
    const work = risToWorkInput(record);
    if (!work) {
      problems.push(`A ${kind} entry has no title; skipped.`);
      continue;
    }

    // See the same guard in bibtex.ts: the type is a compile-time claim, and
    // this is the only thing that checks it against reality.
    const checked = parseWorkInput(work);
    if (checked) works.push(checked);
    else problems.push(`A ${kind} entry could not be read; skipped.`);
  }

  return { entries: works, problems };
}

import { normalizeArxivId, normalizeDoi } from "../normalize";
import type { WorkInput } from "../types";

import { importBibtex, type ParseResult } from "./bibtex";
import { importRis } from "./ris";

export * from "./bibtex";
export * from "./ris";
export * from "./resolve";

export type ImportFormat = "bibtex" | "ris" | "identifiers";

/**
 * Guess the format of pasted text.
 *
 * Users paste into one box; asking them to pick the format first is a
 * question they often cannot answer — plenty of people have a `.txt` from
 * their supervisor and no idea what produced it. Detection is by structural
 * signature rather than by file extension, which is frequently wrong.
 */
export function detectFormat(source: string): ImportFormat {
  const text = source.trim();

  // `TY  - ` is unambiguous; nothing else uses it.
  if (/^TY\s{1,2}-\s/m.test(text)) return "ris";

  // An @-type followed by a brace. Checked after RIS because a RIS abstract
  // can contain an email address, and `@article{` cannot appear in one.
  if (/@\w+\s*\{/.test(text)) return "bibtex";

  return "identifiers";
}

/**
 * Pull DOIs and arXiv ids out of arbitrary text.
 *
 * The realistic input is a list pasted from a document — one per line, or
 * comma-separated, or a numbered list, or full URLs mixed with bare ids.
 * Scanning for the identifiers rather than parsing a structure means all of
 * those work without asking the user to tidy anything up.
 */
export function extractIdentifiers(source: string): {
  dois: string[];
  arxivIds: string[];
  unrecognized: string[];
} {
  const dois = new Set<string>();
  const arxivIds = new Set<string>();
  const unrecognized: string[] = [];

  // Split on anything that separates list items, but NOT on characters that
  // occur inside a DOI suffix, which may contain almost anything.
  const candidates = source
    .split(/[\s,;]+/)
    .map((token) => token.trim().replace(/^[\d]+[.)]$/, ""))
    .filter(Boolean);

  for (const candidate of candidates) {
    // Trailing punctuation from prose: "…10.1/abc." or "(10.1/abc)".
    const cleaned = candidate.replace(/^[([<]+/, "").replace(/[.,;)\]>]+$/, "");
    if (!cleaned) continue;

    const doi = normalizeDoi(cleaned);
    if (doi) {
      dois.add(doi);
      continue;
    }

    const arxiv = normalizeArxivId(cleaned);
    if (arxiv) {
      arxivIds.add(arxiv);
      continue;
    }

    // Only report things that look like they were meant to be identifiers.
    // Reporting every stray word would bury the real problems.
    if (/\d/.test(cleaned) && cleaned.length > 4) unrecognized.push(cleaned);
  }

  return { dois: [...dois], arxivIds: [...arxivIds], unrecognized };
}

export interface ParsedImport extends ParseResult<WorkInput> {
  format: ImportFormat;
  /** Identifiers that need a provider lookup before they become works. */
  lookups: { dois: string[]; arxivIds: string[] };
}

/**
 * Parse pasted text into works, plus identifiers that still need fetching.
 *
 * BibTeX and RIS carry their own metadata, so they become works immediately.
 * A bare DOI carries nothing but the identifier, so it becomes a lookup —
 * resolved through the providers, which is both more accurate than anything
 * the user could paste and how the record acquires an abstract and citation
 * counts.
 */
export function parseImport(source: string): ParsedImport {
  const format = detectFormat(source);

  if (format === "bibtex") {
    const result = importBibtex(source);
    return { ...result, format, lookups: { dois: [], arxivIds: [] } };
  }

  if (format === "ris") {
    const result = importRis(source);
    return { ...result, format, lookups: { dois: [], arxivIds: [] } };
  }

  const { dois, arxivIds, unrecognized } = extractIdentifiers(source);
  return {
    entries: [],
    problems: unrecognized.map((token) => `Not a DOI or arXiv id: ${token}`),
    format,
    lookups: { dois, arxivIds },
  };
}

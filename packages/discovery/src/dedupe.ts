import { normalizeTitle } from "./normalize.js";
import type { WorkInput } from "./types.js";

/**
 * Collapse the same paper returned by several providers into one record.
 *
 * Matching is by identifier in descending order of confidence — DOI, arXiv,
 * OpenAlex, PMID — falling back to (normalized title, year).
 *
 * Fuzzy title matching is NOT used to merge automatically. A wrong automatic
 * merge destroys one of two genuinely different papers and gives the user no
 * way to notice: the losing paper simply never appears, and nothing looks
 * broken. Near-matches are surfaced as candidates for a human instead
 * (`findNearDuplicates`), which is a smaller, visible, reversible mistake.
 */

/** Identity keys for a record, most confident first. */
function keysFor(work: WorkInput): string[] {
  const keys: string[] = [];
  if (work.doi) keys.push(`doi:${work.doi}`);
  if (work.arxivId) keys.push(`arxiv:${work.arxivId}`);
  if (work.openalexId) keys.push(`openalex:${work.openalexId}`);
  if (work.pmid) keys.push(`pmid:${work.pmid}`);
  keys.push(`title:${normalizeTitle(work.title)}|${work.publishedYear ?? ""}`);
  return keys;
}

/**
 * Field-level merge preferring whichever record actually has the field.
 *
 * The order matters for two fields specifically:
 *   - citedByCount takes the MAXIMUM. Providers update on different
 *     schedules, and the higher number is the more recent crawl.
 *   - oaPdfUrl takes the first non-null from a provider that verified open
 *     access. R-04: a paywalled file must never reach shared storage, so
 *     "some provider had a URL" is not sufficient — the provider must have
 *     said it is open, which each adapter enforces before setting the field.
 */
function merge(a: WorkInput, b: WorkInput): WorkInput {
  const preferLonger = (x: string | null | undefined, y: string | null | undefined) => {
    if (!x) return y ?? null;
    if (!y) return x;
    // Abstracts get truncated by some providers; the longer one is fuller.
    return y.length > x.length ? y : x;
  };

  return {
    doi: a.doi ?? b.doi ?? null,
    arxivId: a.arxivId ?? b.arxivId ?? null,
    openalexId: a.openalexId ?? b.openalexId ?? null,
    pmid: a.pmid ?? b.pmid ?? null,
    title: a.title.length >= b.title.length ? a.title : b.title,
    abstract: preferLonger(a.abstract, b.abstract),
    authors: a.authors.length >= b.authors.length ? a.authors : b.authors,
    venue: a.venue ?? b.venue ?? null,
    publishedYear: a.publishedYear ?? b.publishedYear ?? null,
    publishedOn: a.publishedOn ?? b.publishedOn ?? null,
    type: a.type ?? b.type ?? null,
    language: a.language ?? b.language ?? null,
    oaStatus: a.oaStatus ?? b.oaStatus ?? null,
    oaPdfUrl: a.oaPdfUrl ?? b.oaPdfUrl ?? null,
    citedByCount: Math.max(a.citedByCount, b.citedByCount),
    referencedWorks:
      a.referencedWorks.length >= b.referencedWorks.length
        ? a.referencedWorks
        : b.referencedWorks,
    concepts: a.concepts ?? b.concepts ?? null,
    raw: a.raw ?? b.raw ?? null,
  };
}

/**
 * Merge a list of records from any number of providers.
 *
 * Union-find over the identity keys, so a chain resolves transitively: if
 * OpenAlex knows the DOI and arXiv id, and Semantic Scholar knows only the
 * arXiv id, all three collapse into one record even though S2 and Crossref
 * share no key directly.
 */
export function dedupe(works: WorkInput[]): WorkInput[] {
  const byKey = new Map<string, number>();
  const parent: number[] = [];

  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    // Path compression.
    let node = i;
    while (parent[node] !== root) {
      const next = parent[node]!;
      parent[node] = root;
      node = next;
    }
    return root;
  };

  const union = (i: number, j: number) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };

  works.forEach((work, index) => {
    parent[index] = index;
    for (const key of keysFor(work)) {
      const seen = byKey.get(key);
      if (seen === undefined) byKey.set(key, index);
      else union(seen, index);
    }
  });

  const groups = new Map<number, WorkInput>();
  works.forEach((work, index) => {
    const root = find(index);
    const existing = groups.get(root);
    groups.set(root, existing ? merge(existing, work) : work);
  });

  return [...groups.values()];
}

/**
 * Near-duplicate candidates for human review — never merged automatically.
 *
 * Uses trigram similarity over normalized titles, the same measure the
 * `works_title_trgm_idx` GIN index backs, so what a user sees here matches
 * what a database-side search would find.
 */
export function findNearDuplicates(
  works: WorkInput[],
  threshold = 0.85,
): Array<{ a: number; b: number; similarity: number }> {
  const normalized = works.map((w) => normalizeTitle(w.title));
  const pairs: Array<{ a: number; b: number; similarity: number }> = [];

  for (let i = 0; i < works.length; i++) {
    for (let j = i + 1; j < works.length; j++) {
      // Already the same record by identifier — not a candidate, a fact.
      const shareKey = keysFor(works[i]!).some((k) => keysFor(works[j]!).includes(k));
      if (shareKey) continue;

      const similarity = trigramSimilarity(normalized[i]!, normalized[j]!);
      if (similarity >= threshold) pairs.push({ a: i, b: j, similarity });
    }
  }

  return pairs.sort((x, y) => y.similarity - x.similarity);
}

function trigrams(text: string): Set<string> {
  const padded = `  ${text} `;
  const result = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) result.add(padded.slice(i, i + 3));
  return result;
}

/** Jaccard similarity over trigram sets, matching pg_trgm's definition. */
export function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;

  const setA = trigrams(a);
  const setB = trigrams(b);

  let shared = 0;
  for (const gram of setA) if (setB.has(gram)) shared++;

  const union = setA.size + setB.size - shared;
  return union === 0 ? 0 : shared / union;
}

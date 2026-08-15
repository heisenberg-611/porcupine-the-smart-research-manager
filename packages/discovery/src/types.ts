import { z } from "zod";

/**
 * The shape every provider normalizes into — the argument to `upsert_work()`.
 *
 * Deliberately close to the `works` table rather than to any provider's
 * payload. Five providers describe the same paper five different ways; the
 * translation happens once, at the edge, so nothing downstream has to know
 * which API a work came from.
 */
export const workInputSchema = z.object({
  doi: z.string().nullish(),
  arxivId: z.string().nullish(),
  openalexId: z.string().nullish(),
  pmid: z.string().nullish(),

  title: z.string().min(1),
  abstract: z.string().nullish(),
  authors: z.array(
    z.object({
      name: z.string(),
      orcid: z.string().nullish(),
      affiliation: z.string().nullish(),
      position: z.number().int().nullish(),
    }),
  ),

  venue: z.string().nullish(),
  publishedYear: z.number().int().min(1400).max(2200).nullish(),
  publishedOn: z.string().nullish(),
  /** article | preprint | thesis | book | … */
  type: z.string().nullish(),
  /** ISO-639-1 where the provider reports one. Drives the FTS config (R-14). */
  language: z.string().nullish(),

  oaStatus: z.string().nullish(),
  /** Set ONLY when the file is verified redistributable. */
  oaPdfUrl: z.string().nullish(),
  citedByCount: z.number().int().min(0).default(0),
  referencedWorks: z.array(z.string()).default([]),
  concepts: z.unknown().nullish(),

  raw: z.unknown().nullish(),
});

export type WorkInput = z.infer<typeof workInputSchema>;

/**
 * Check a work at the boundary, rather than trusting the type.
 *
 * `workInputSchema` existed for a long time and validated nothing: its only
 * job was to be the source of the `WorkInput` type via `z.infer`. That reads
 * as a control and is not one — `WorkInput` is erased at compile time, so five
 * external APIs and any pasted BibTeX reached `upsert_work()` with nothing
 * between them and the database except a cast.
 *
 * NOT a security boundary, and it should not be mistaken for one.
 * `upsert_work()` takes jsonb through a bound parameter, so injection was
 * never the risk. What this prevents is a provider changing its payload — or
 * answering 200 with an error document — and silently writing rows with no
 * title, a publication year of 20024, or an author field that is a string
 * where an array belongs. Those survive as permanent corpus entries and are
 * found much later, by a person.
 *
 * Returns null rather than throwing, because every caller already has a way to
 * report one bad record without failing the batch: `problems` on an import,
 * `failures` on a search. One malformed record should cost that record.
 */
export function parseWorkInput(value: unknown): WorkInput | null {
  const result = workInputSchema.safeParse(value);
  return result.success ? result.data : null;
}

export const PROVIDER_IDS = [
  "openalex",
  "crossref",
  "arxiv",
  "europepmc",
  "semanticscholar",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface SearchQuery {
  terms: string;
  /** Inclusive. */
  fromYear?: number;
  toYear?: number;
  limit?: number;
}

export interface RateLimit {
  /** Burst size. */
  capacity: number;
  refillPerSecond: number;
}

export interface Provider {
  readonly id: ProviderId;
  readonly label: string;
  /**
   * Published limits, or a conservative guess where none is published.
   * Deliberately below the documented ceiling: being throttled costs a
   * retry, being blocked costs the feature.
   */
  readonly rateLimit: RateLimit;
  search(query: SearchQuery): Promise<WorkInput[]>;
  /** Not every provider supports lookup by DOI. */
  byDoi?(doi: string): Promise<WorkInput | null>;
}

/** Waits `seconds` before a request is permitted. Returns 0 when permitted. */
export interface RateLimiter {
  take(key: string, limit: RateLimit): Promise<number>;
}

export interface ProviderFailure {
  provider: ProviderId;
  message: string;
}

export interface FederatedResult {
  works: WorkInput[];
  counts: { provider: string; count: number }[];
  /**
   * Providers that failed. Non-empty is a DEGRADED result, not an error:
   * five providers means five chances to be down, and four sets of results
   * beat an error page.
   */
  failures: ProviderFailure[];
}

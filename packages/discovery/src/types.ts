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
  /**
   * Providers that failed. Non-empty is a DEGRADED result, not an error:
   * five providers means five chances to be down, and four sets of results
   * beat an error page.
   */
  failures: ProviderFailure[];
}

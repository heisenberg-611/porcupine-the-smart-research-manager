import { arxiv, arxivByIds } from "../providers/arxiv";
import { crossref } from "../providers/crossref";
import { openalex } from "../providers/openalex";
import type { RateLimiter, WorkInput } from "../types";

/**
 * Turn bare identifiers into full records.
 *
 * A pasted DOI carries nothing but the identifier. Resolving it through the
 * providers is both more accurate than anything a user could paste and how
 * the record acquires an abstract, a venue, and a citation count — which is
 * what makes the library useful rather than a list of strings.
 *
 * Failures are per-identifier and reported, never fatal: a list of fifty DOIs
 * with three dead ones should import forty-seven papers and name the three.
 */

export interface ResolveResult {
  works: WorkInput[];
  problems: string[];
}

/** How many DOI lookups to have in flight at once. */
const DOI_CONCURRENCY = 4;

export async function resolveIdentifiers(
  identifiers: { dois: string[]; arxivIds: string[] },
  limiter: RateLimiter,
): Promise<ResolveResult> {
  const works: WorkInput[] = [];
  const problems: string[] = [];

  // ── arXiv: one batched request ────────────────────────────────────────────
  // id_list takes up to 100, so a 50-item paste is one request rather than
  // fifty. At arXiv's 1-per-3-seconds that is the difference between three
  // seconds and two and a half minutes.
  if (identifiers.arxivIds.length > 0) {
    try {
      const wait = await limiter.take("provider:arxiv", arxiv.rateLimit);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait * 1000));

      const resolved = await arxivByIds(identifiers.arxivIds);
      works.push(...resolved);

      const found = new Set(resolved.map((w) => w.arxivId));
      for (const id of identifiers.arxivIds) {
        if (!found.has(id)) problems.push(`arXiv:${id} — not found.`);
      }
    } catch (error) {
      problems.push(
        `arXiv lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ── DOIs: OpenAlex first, Crossref as fallback ────────────────────────────
  // OpenAlex carries open-access status and the citation graph; Crossref is
  // authoritative for anything OpenAlex has not indexed yet, which is mostly
  // very recent papers.
  const queue = [...identifiers.dois];

  async function worker() {
    for (;;) {
      const doi = queue.shift();
      if (!doi) return;

      try {
        const wait = await limiter.take("provider:openalex", openalex.rateLimit);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait * 1000));

        const found = await openalex.byDoi?.(doi);
        if (found) {
          works.push(found);
          continue;
        }

        const crossrefWait = await limiter.take("provider:crossref", crossref.rateLimit);
        if (crossrefWait > 0) {
          await new Promise((resolve) => setTimeout(resolve, crossrefWait * 1000));
        }

        const fallback = await crossref.byDoi?.(doi);
        if (fallback) works.push(fallback);
        else problems.push(`${doi} — not found in OpenAlex or Crossref.`);
      } catch (error) {
        problems.push(
          `${doi} — ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(DOI_CONCURRENCY, queue.length) }, () => worker()),
  );

  return { works, problems };
}

import { normalizeArxivId, normalizeDoi } from "../normalize";
import { safeFetch } from "../ssrf";
import type { Provider, SearchQuery, WorkInput } from "../types";

/**
 * Semantic Scholar — computer science and the wider long tail.
 *
 * Kept in the set because it indexes conference proceedings that OpenAlex and
 * Crossref both miss, and CS research lives in proceedings rather than
 * journals. Without it, a machine-learning thesis would have visible holes.
 *
 * Unauthenticated access is heavily throttled (roughly 1 request/second,
 * shared across everyone without a key), so it is rate-limited hardest and is
 * the provider most likely to appear in `failures` rather than results. That
 * is acceptable precisely because the federated search degrades instead of
 * failing.
 */

interface S2Author {
  name?: string;
  externalIds?: { ORCID?: string };
}

interface S2Paper {
  paperId?: string;
  externalIds?: { DOI?: string; ArXiv?: string; PubMed?: string };
  title?: string;
  abstract?: string;
  year?: number;
  publicationDate?: string;
  publicationTypes?: string[];
  venue?: string;
  citationCount?: number;
  authors?: S2Author[];
  isOpenAccess?: boolean;
  openAccessPdf?: { url?: string };
  references?: Array<{ paperId?: string }>;
}

const FIELDS = [
  "paperId",
  "externalIds",
  "title",
  "abstract",
  "year",
  "publicationDate",
  "publicationTypes",
  "venue",
  "citationCount",
  "authors.name",
  "authors.externalIds",
  "isOpenAccess",
  "openAccessPdf",
].join(",");

function toWorkInput(paper: S2Paper): WorkInput | null {
  if (!paper.title) return null;

  const arxivRaw = paper.externalIds?.ArXiv;

  return {
    doi: paper.externalIds?.DOI ? normalizeDoi(paper.externalIds.DOI) : null,
    arxivId: arxivRaw ? normalizeArxivId(arxivRaw) : null,
    pmid: paper.externalIds?.PubMed ?? null,
    title: paper.title,
    abstract: paper.abstract ?? null,
    authors: (paper.authors ?? []).map((author, index) => ({
      name: author.name ?? "Unknown",
      orcid: author.externalIds?.ORCID ?? null,
      affiliation: null,
      position: index,
    })),
    venue: paper.venue || null,
    publishedYear: paper.year ?? null,
    publishedOn: paper.publicationDate ?? null,
    type: paper.publicationTypes?.[0] ?? null,
    language: null,
    oaStatus: paper.isOpenAccess ? "green" : null,
    oaPdfUrl: paper.isOpenAccess ? (paper.openAccessPdf?.url ?? null) : null,
    citedByCount: paper.citationCount ?? 0,
    referencedWorks: [],
    raw: paper,
  };
}

export const semanticscholar: Provider = {
  id: "semanticscholar",
  label: "Semantic Scholar",
  // Unauthenticated S2 is ~1 rps shared globally. Set well under it: being
  // throttled costs a retry, being blocked costs the provider.
  rateLimit: { capacity: 1, refillPerSecond: 0.5 },

  async search(query: SearchQuery): Promise<WorkInput[]> {
    const url = new URL("https://api.semanticscholar.org/graph/v1/paper/search");
    url.searchParams.set("query", query.terms);
    url.searchParams.set("fields", FIELDS);
    url.searchParams.set("limit", String(Math.min(query.limit ?? 25, 100)));
    if (query.fromYear || query.toYear) {
      url.searchParams.set("year", `${query.fromYear ?? ""}-${query.toYear ?? ""}`);
    }

    const response = await safeFetch(url.href);
    if (!response.ok) throw new Error(`Semantic Scholar returned ${response.status}`);

    const body = (await response.json()) as { data?: S2Paper[] };
    return (body.data ?? []).map(toWorkInput).filter((w): w is WorkInput => w !== null);
  },
};

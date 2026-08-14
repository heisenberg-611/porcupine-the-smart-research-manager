import { normalizeArxivId, normalizeDoi, normalizeOpenAlexId } from "../normalize";
import { safeFetch, userAgent } from "../ssrf";
import type { Provider, SearchQuery, WorkInput } from "../types";

/**
 * OpenAlex — the primary source.
 *
 * Chosen as primary because it is the only free provider that carries all
 * three of: the citation graph (`referenced_works`, which powers snowballing),
 * open-access status, and R-15's preprint↔published relationship as explicit
 * data rather than something we would have to infer.
 *
 * 100k requests/day, 10/second. The polite pool wants a mailto.
 */

interface OpenAlexAuthorship {
  author?: { display_name?: string; orcid?: string };
  institutions?: Array<{ display_name?: string }>;
}

interface OpenAlexWork {
  id?: string;
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  publication_date?: string;
  type?: string;
  language?: string;
  cited_by_count?: number;
  referenced_works?: string[];
  concepts?: unknown;
  authorships?: OpenAlexAuthorship[];
  abstract_inverted_index?: Record<string, number[]>;
  primary_location?: {
    source?: { display_name?: string };
    landing_page_url?: string;
    pdf_url?: string;
  };
  open_access?: { oa_status?: string; oa_url?: string; is_oa?: boolean };
  ids?: { pmid?: string; openalex?: string };
  locations?: Array<{ source?: { display_name?: string }; pdf_url?: string }>;
}

/**
 * OpenAlex ships abstracts as an inverted index — {word: [positions]} — to
 * sidestep publisher restrictions on redistributing abstract text. Rebuilding
 * it is legitimate and expected; the format is a licensing artefact, not an
 * access control.
 */
export function rebuildAbstract(
  index: Record<string, number[]> | undefined,
): string | null {
  if (!index) return null;

  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words[position] = word;
  }

  // Gaps are possible if the index is malformed; drop them rather than
  // emitting "undefined" into an abstract.
  const text = words
    .filter((w) => w !== undefined)
    .join(" ")
    .trim();
  return text.length > 0 ? text : null;
}

function toWorkInput(raw: OpenAlexWork): WorkInput | null {
  const title = raw.title ?? raw.display_name;
  if (!title) return null;

  const authors = (raw.authorships ?? []).map((authorship, index) => ({
    name: authorship.author?.display_name ?? "Unknown",
    orcid: authorship.author?.orcid ?? null,
    affiliation: authorship.institutions?.[0]?.display_name ?? null,
    position: index,
  }));

  // arXiv ids are not a first-class field; they appear as a location.
  const arxivLocation = (raw.locations ?? []).find((l) =>
    /arxiv/i.test(l.source?.display_name ?? ""),
  );
  const arxivFromPdf = arxivLocation?.pdf_url
    ? normalizeArxivId(arxivLocation.pdf_url.replace(/^.*arxiv\.org\/pdf\//i, ""))
    : null;

  const oa = raw.open_access;

  return {
    doi: raw.doi ? normalizeDoi(raw.doi) : null,
    arxivId: arxivFromPdf,
    openalexId: raw.id ? normalizeOpenAlexId(raw.id) : null,
    pmid: raw.ids?.pmid?.replace(/^.*pubmed\//i, "") ?? null,
    title,
    abstract: rebuildAbstract(raw.abstract_inverted_index),
    authors,
    venue: raw.primary_location?.source?.display_name ?? null,
    publishedYear: raw.publication_year ?? null,
    publishedOn: raw.publication_date ?? null,
    type: raw.type ?? null,
    language: raw.language ?? null,
    oaStatus: oa?.oa_status ?? null,
    // Only when OpenAlex says it is genuinely open. R-04: a paywalled file
    // must never reach R2, and this field is what the fetcher trusts.
    oaPdfUrl: oa?.is_oa ? (oa.oa_url ?? null) : null,
    citedByCount: raw.cited_by_count ?? 0,
    referencedWorks: raw.referenced_works ?? [],
    concepts: raw.concepts ?? null,
    raw,
  };
}

export const openalex: Provider = {
  id: "openalex",
  label: "OpenAlex",
  rateLimit: { capacity: 10, refillPerSecond: 8 },

  async search(query: SearchQuery): Promise<WorkInput[]> {
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("search", query.terms);
    url.searchParams.set("per-page", String(Math.min(query.limit ?? 25, 200)));

    const filters: string[] = [];
    if (query.fromYear) filters.push(`from_publication_date:${query.fromYear}-01-01`);
    if (query.toYear) filters.push(`to_publication_date:${query.toYear}-12-31`);
    if (filters.length) url.searchParams.set("filter", filters.join(","));

    const email = process.env.POLITE_POOL_EMAIL;
    if (email) url.searchParams.set("mailto", email);

    const response = await safeFetch(url.href, {
      headers: { "user-agent": userAgent() },
    });
    if (!response.ok) throw new Error(`OpenAlex returned ${response.status}`);

    const body = (await response.json()) as { results?: OpenAlexWork[] };
    return (body.results ?? [])
      .map(toWorkInput)
      .filter((w): w is WorkInput => w !== null);
  },

  async byDoi(doi: string): Promise<WorkInput | null> {
    const normalized = normalizeDoi(doi);
    if (!normalized) return null;

    const response = await safeFetch(
      `https://api.openalex.org/works/doi:${encodeURIComponent(normalized)}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`OpenAlex returned ${response.status}`);

    return toWorkInput((await response.json()) as OpenAlexWork);
  },
};

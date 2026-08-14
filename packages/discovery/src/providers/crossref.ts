import { normalizeDoi } from "../normalize";
import { safeFetch } from "../ssrf";
import type { Provider, SearchQuery, WorkInput } from "../types";

/**
 * Crossref — the DOI registry itself.
 *
 * Authoritative for anything with a DOI: it is where the DOI was minted, so
 * its metadata is the publisher's own rather than a third party's reading of
 * it. Weaker than OpenAlex on citation graph and open access, which is why
 * both run rather than either alone.
 *
 * 50/second on the polite pool, which a mailto opts into.
 */

interface CrossrefAuthor {
  given?: string;
  family?: string;
  name?: string;
  ORCID?: string;
  affiliation?: Array<{ name?: string }>;
}

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  abstract?: string;
  author?: CrossrefAuthor[];
  "container-title"?: string[];
  issued?: { "date-parts"?: number[][] };
  type?: string;
  language?: string;
  "is-referenced-by-count"?: number;
  link?: Array<{ URL?: string; "content-type"?: string }>;
}

/**
 * Crossref abstracts are JATS XML fragments. Strip the tags rather than
 * rendering them: the abstract feeds full-text search and a plain-text
 * preview, and neither wants `<jats:p>` in it.
 */
export function stripJats(abstract: string | undefined): string | null {
  if (!abstract) return null;

  const text = abstract
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

  return text.length > 0 ? text : null;
}

function authorName(author: CrossrefAuthor): string {
  if (author.name) return author.name;
  const parts = [author.given, author.family].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "Unknown";
}

function toWorkInput(item: CrossrefItem): WorkInput | null {
  const title = item.title?.[0];
  if (!title) return null;

  const year = item.issued?.["date-parts"]?.[0]?.[0] ?? null;

  return {
    doi: item.DOI ? normalizeDoi(item.DOI) : null,
    title,
    abstract: stripJats(item.abstract),
    authors: (item.author ?? []).map((author, index) => ({
      name: authorName(author),
      orcid: author.ORCID ?? null,
      affiliation: author.affiliation?.[0]?.name ?? null,
      position: index,
    })),
    venue: item["container-title"]?.[0] ?? null,
    publishedYear: year,
    type: item.type ?? null,
    language: item.language ?? null,
    citedByCount: item["is-referenced-by-count"] ?? 0,
    referencedWorks: [],
    // Crossref's `link` entries are publisher URLs, not open-access proof.
    // Leaving oaPdfUrl null is deliberate: R-04 only lets a file into shared
    // storage once Unpaywall has verified it is redistributable, and a
    // publisher link is exactly the thing that must not be trusted here.
    oaPdfUrl: null,
    raw: item,
  };
}

export const crossref: Provider = {
  id: "crossref",
  label: "Crossref",
  rateLimit: { capacity: 20, refillPerSecond: 10 },

  async search(query: SearchQuery): Promise<WorkInput[]> {
    const url = new URL("https://api.crossref.org/works");
    url.searchParams.set("query.bibliographic", query.terms);
    url.searchParams.set("rows", String(Math.min(query.limit ?? 25, 100)));

    const filters: string[] = [];
    if (query.fromYear) filters.push(`from-pub-date:${query.fromYear}-01-01`);
    if (query.toYear) filters.push(`until-pub-date:${query.toYear}-12-31`);
    if (filters.length) url.searchParams.set("filter", filters.join(","));

    const email = process.env.POLITE_POOL_EMAIL;
    if (email) url.searchParams.set("mailto", email);

    const response = await safeFetch(url.href);
    if (!response.ok) throw new Error(`Crossref returned ${response.status}`);

    const body = (await response.json()) as { message?: { items?: CrossrefItem[] } };
    return (body.message?.items ?? [])
      .map(toWorkInput)
      .filter((w): w is WorkInput => w !== null);
  },

  async byDoi(doi: string): Promise<WorkInput | null> {
    const normalized = normalizeDoi(doi);
    if (!normalized) return null;

    const response = await safeFetch(
      `https://api.crossref.org/works/${encodeURIComponent(normalized)}`,
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Crossref returned ${response.status}`);

    const body = (await response.json()) as { message?: CrossrefItem };
    return body.message ? toWorkInput(body.message) : null;
  },
};

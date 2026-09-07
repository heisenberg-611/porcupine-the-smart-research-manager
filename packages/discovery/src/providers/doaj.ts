import { normalizeDoi } from "../normalize";
import { safeFetch } from "../ssrf";
import type { Provider, SearchQuery, WorkInput } from "../types";

/**
 * DOAJ — Directory of Open Access Journals.
 *
 * The premier global index for peer-reviewed open access journals, with extensive
 * coverage of psychology, social sciences, behavioral sciences, education, and humanities.
 */

interface DoajIdentifier {
  id?: string;
  type?: string;
}

interface DoajAuthor {
  name?: string;
  affiliation?: string;
  orcid?: string;
}

interface DoajLink {
  type?: string;
  url?: string;
  content_type?: string;
}

interface DoajBibJson {
  title?: string;
  abstract?: string;
  year?: string;
  month?: string;
  journal?: { title?: string; publisher?: string; language?: string[] };
  identifier?: DoajIdentifier[];
  author?: DoajAuthor[];
  link?: DoajLink[];
  keywords?: string[];
}

interface DoajArticle {
  id?: string;
  created_date?: string;
  bibjson?: DoajBibJson;
}

export function toWorkInput(article: DoajArticle): WorkInput | null {
  const bib = article.bibjson;
  if (!bib || !bib.title) return null;

  const doiObj = bib.identifier?.find((i) => i.type?.toLowerCase() === "doi");
  const doi = doiObj?.id ? normalizeDoi(doiObj.id) : null;

  const yearNum = bib.year ? Number(bib.year) : null;
  const publishedYear = Number.isFinite(yearNum) ? yearNum : null;

  const authors = (bib.author ?? []).map((author, index) => ({
    name: author.name ?? "Unknown",
    orcid: author.orcid ?? null,
    affiliation: author.affiliation ?? null,
    position: index,
  }));

  const fullTextLink = bib.link?.find(
    (l) => l.type === "fulltext" || /pdf/i.test(l.content_type ?? ""),
  );

  return {
    doi,
    title: bib.title,
    abstract: bib.abstract ?? null,
    authors,
    venue: bib.journal?.title ?? null,
    publishedYear,
    publishedOn: bib.year ? `${bib.year}-${(bib.month ?? "01").padStart(2, "0")}-01` : null,
    type: "article",
    language: bib.journal?.language?.[0]?.toLowerCase() ?? null,
    oaStatus: "gold",
    oaPdfUrl: fullTextLink?.url ?? null,
    citedByCount: 0,
    referencedWorks: [],
    raw: article,
  };
}

export const doaj: Provider = {
  id: "doaj",
  label: "DOAJ",
  rateLimit: { capacity: 15, refillPerSecond: 10 },

  async search(query: SearchQuery): Promise<WorkInput[]> {
    const encoded = encodeURIComponent(query.terms);
    const url = new URL(`https://doaj.org/api/v2/search/articles/${encoded}`);
    url.searchParams.set("pageSize", String(Math.min(query.limit ?? 25, 100)));

    const response = await safeFetch(url.href);
    if (!response.ok) throw new Error(`DOAJ returned ${response.status}`);

    const body = (await response.json()) as { results?: DoajArticle[] };
    return (body.results ?? [])
      .map(toWorkInput)
      .filter((w): w is WorkInput => w !== null)
      .filter((w) => {
        if (!query.fromYear && !query.toYear) return true;
        if (w.publishedYear === null || w.publishedYear === undefined) return false;
        if (query.fromYear && w.publishedYear < query.fromYear) return false;
        if (query.toYear && w.publishedYear > query.toYear) return false;
        return true;
      });
  },
};

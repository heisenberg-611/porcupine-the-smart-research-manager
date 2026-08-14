import { normalizeDoi } from "../normalize.js";
import { safeFetch } from "../ssrf.js";
import type { Provider, SearchQuery, WorkInput } from "../types.js";

/**
 * Europe PMC — biomedical literature, and the only provider carrying PMIDs.
 *
 * Matters for systematic reviews specifically: Cochrane-style protocols are
 * written against PubMed, and a review whose corpus cannot be cross-referenced
 * by PMID is a review its authors cannot defend to a journal.
 */

interface EuropePmcResult {
  id?: string;
  pmid?: string;
  doi?: string;
  title?: string;
  abstractText?: string;
  authorString?: string;
  journalTitle?: string;
  pubYear?: string;
  firstPublicationDate?: string;
  pubType?: string;
  citedByCount?: number;
  isOpenAccess?: string;
  fullTextUrlList?: {
    fullTextUrl?: Array<{ url?: string; documentStyle?: string; availability?: string }>;
  };
}

/**
 * Europe PMC gives authors as one string: "Smith J, Jones AB, Lee C."
 * Splitting on commas is right here — unlike BibTeX, the format never uses a
 * comma to separate surname from given name.
 */
export function splitAuthorString(authorString: string | undefined) {
  if (!authorString) return [];

  return authorString
    .replace(/\.$/, "")
    .split(",")
    .map((name, index) => ({
      name: name.trim(),
      orcid: null,
      affiliation: null,
      position: index,
    }))
    .filter((a) => a.name.length > 0);
}

function toWorkInput(result: EuropePmcResult): WorkInput | null {
  if (!result.title) return null;

  const year = result.pubYear ? Number(result.pubYear) : null;

  // Only a PDF that Europe PMC marks openly available. `availability` is the
  // field that distinguishes free-to-read from redistributable.
  const openPdf = result.fullTextUrlList?.fullTextUrl?.find(
    (entry) =>
      entry.documentStyle === "pdf" && /open access|free/i.test(entry.availability ?? ""),
  );

  return {
    doi: result.doi ? normalizeDoi(result.doi) : null,
    pmid: result.pmid ?? null,
    title: result.title,
    abstract: result.abstractText ?? null,
    authors: splitAuthorString(result.authorString),
    venue: result.journalTitle ?? null,
    publishedYear: Number.isFinite(year) ? year : null,
    publishedOn: result.firstPublicationDate ?? null,
    type: result.pubType ?? null,
    language: null,
    oaStatus: result.isOpenAccess === "Y" ? "green" : null,
    oaPdfUrl: openPdf?.url ?? null,
    citedByCount: result.citedByCount ?? 0,
    referencedWorks: [],
    raw: result,
  };
}

export const europepmc: Provider = {
  id: "europepmc",
  label: "Europe PMC",
  rateLimit: { capacity: 10, refillPerSecond: 5 },

  async search(query: SearchQuery): Promise<WorkInput[]> {
    const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");

    let terms = query.terms;
    if (query.fromYear || query.toYear) {
      const from = query.fromYear ?? 1400;
      const to = query.toYear ?? 2200;
      terms += ` AND (FIRST_PDATE:[${from}-01-01 TO ${to}-12-31])`;
    }

    url.searchParams.set("query", terms);
    url.searchParams.set("format", "json");
    url.searchParams.set("resultType", "core");
    url.searchParams.set("pageSize", String(Math.min(query.limit ?? 25, 100)));

    const response = await safeFetch(url.href);
    if (!response.ok) throw new Error(`Europe PMC returned ${response.status}`);

    const body = (await response.json()) as {
      resultList?: { result?: EuropePmcResult[] };
    };
    return (body.resultList?.result ?? [])
      .map(toWorkInput)
      .filter((w): w is WorkInput => w !== null);
  },
};

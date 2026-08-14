import { normalizeArxivId, normalizeDoi } from "../normalize.js";
import { safeFetch } from "../ssrf.js";
import type { Provider, SearchQuery, WorkInput } from "../types.js";

/**
 * arXiv — preprints, and the reason the token bucket exists.
 *
 * arXiv asks for one request every three seconds and means it. That limit is
 * the concrete driver behind R-22: on Lambda there is no shared memory
 * between invocations, so a per-process counter would let ten concurrent
 * functions issue ten times the agreed rate. The bucket lives in Postgres
 * because Postgres is the only thing they all share.
 *
 * The API returns Atom XML, not JSON, and it is the only provider that does.
 */

/**
 * A deliberately small XML reader for arXiv's Atom feed.
 *
 * A full XML parser is a dependency, an attack surface, and more capability
 * than one fixed well-formed feed needs. This handles exactly the subset arXiv
 * emits. If arXiv ever returns something this cannot read, the entry is
 * skipped and the provider degrades — it does not throw and take the whole
 * federated search down with it.
 */
function extractTag(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  return match?.[1] ? decodeEntities(match[1].trim()) : null;
}

function extractAll(xml: string, tag: string): string[] {
  const matches = xml.matchAll(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi"),
  );
  return [...matches].map((m) => (m[1] ?? "").trim());
}

function decodeEntities(text: string): string {
  return (
    text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
      // &amp; last, or "&amp;lt;" decodes to "<" instead of "&lt;".
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function entryToWorkInput(entry: string): WorkInput | null {
  const title = extractTag(entry, "title");
  if (!title) return null;

  const idUrl = extractTag(entry, "id");
  const arxivId = idUrl ? normalizeArxivId(idUrl) : null;

  const published = extractTag(entry, "published");
  const year = published ? Number(published.slice(0, 4)) : null;

  const authors = extractAll(entry, "author")
    .map((block, index) => {
      const name = extractTag(block, "name");
      return name ? { name, orcid: null, affiliation: null, position: index } : null;
    })
    .filter((a): a is NonNullable<typeof a> => a !== null);

  const doiRaw = extractTag(entry, "arxiv:doi");

  return {
    arxivId,
    doi: doiRaw ? normalizeDoi(doiRaw) : null,
    title,
    abstract: extractTag(entry, "summary"),
    authors,
    venue: "arXiv",
    publishedYear: Number.isFinite(year) ? year : null,
    publishedOn: published ?? null,
    type: "preprint",
    // arXiv is overwhelmingly English but does not report a language, and
    // guessing is exactly what R-14 forbids. Null means `simple`, which is
    // the safe default.
    language: null,
    oaStatus: "green",
    // arXiv PDFs are genuinely open, so this one URL is safe to trust
    // without an Unpaywall round-trip.
    oaPdfUrl: arxivId ? `https://arxiv.org/pdf/${arxivId}` : null,
    citedByCount: 0,
    referencedWorks: [],
    raw: { atom: entry },
  };
}

export const arxiv: Provider = {
  id: "arxiv",
  label: "arXiv",
  // 1 request / 3 seconds, and no burst: arXiv is explicit about this and is
  // the provider most likely to block us for getting it wrong.
  rateLimit: { capacity: 1, refillPerSecond: 1 / 3 },

  async search(query: SearchQuery): Promise<WorkInput[]> {
    const url = new URL("https://export.arxiv.org/api/query");
    url.searchParams.set("search_query", `all:${query.terms}`);
    url.searchParams.set("max_results", String(Math.min(query.limit ?? 25, 100)));
    url.searchParams.set("sortBy", "relevance");

    const response = await safeFetch(url.href, {
      headers: { accept: "application/atom+xml" },
    });
    if (!response.ok) throw new Error(`arXiv returned ${response.status}`);

    const xml = await response.text();
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map(
      (m) => m[1] ?? "",
    );

    const works = entries
      .map(entryToWorkInput)
      .filter((w): w is WorkInput => w !== null)
      .filter((w) => {
        if (!query.fromYear && !query.toYear) return true;
        // Undefined and null both mean "arXiv did not give us a year", and a
        // year filter cannot include a record with no year.
        if (w.publishedYear === null || w.publishedYear === undefined) return false;
        if (query.fromYear && w.publishedYear < query.fromYear) return false;
        if (query.toYear && w.publishedYear > query.toYear) return false;
        return true;
      });

    return works;
  },
};

export const __testing = { entryToWorkInput, decodeEntities, extractTag };

/**
 * Identifier and title normalization.
 *
 * These functions decide whether two records are the same paper, so they are
 * the difference between a clean corpus and a library with four copies of
 * everything. They live here rather than in each provider adapter because
 * five adapters normalizing "the same way" is five chances to diverge.
 *
 * On the relationship with SQL: `upsert_work()` computes `title_norm` itself
 * and is the AUTHORITY. `normalizeTitle` here is a pre-pass, used to collapse
 * the five providers' results in memory before any of them reach the
 * database. The two are written to agree, and 05_normalize_parity.sql checks
 * that they do — but if they ever drift, the consequence is bounded: two
 * upsert calls that resolve to the same row, because the SQL dedupes again.
 * Bounded, not free, which is why the canary exists.
 */

/**
 * Lowercase, strip everything that is not a letter, digit or space, collapse
 * whitespace. Matches `upsert_work()`'s regexp_replace chain exactly.
 */
export function normalizeTitle(title: string): string {
  return (
    title
      .toLowerCase()
      // Whitespace FIRST. Stripping punctuation before this deletes newlines
      // and tabs outright, so "Deep\n  Learning" becomes "deeplearning"
      // rather than "deep learning" — and arXiv's Atom feed wraps titles
      // across lines, so it is precisely the papers that appear in both arXiv
      // and OpenAlex that would fail to dedupe.
      .replace(/\s+/g, " ")
      .replace(/[^a-z0-9 ]/g, "")
      // Again: removing punctuation can leave doubled spaces behind.
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Strip the many prefixes a DOI arrives with and lowercase it.
 *
 * DOIs are case-insensitive by specification but case-preserving in practice,
 * so `10.1/ABC` and `10.1/abc` are the same paper. Storing them
 * inconsistently means the unique index does not dedupe, which is the entire
 * reason the index exists.
 */
export function normalizeDoi(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const stripped = trimmed
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim();

  // A DOI is "10." + registrant + "/" + suffix. Anything else is not one.
  if (!/^10\.\d{4,9}\/\S+$/.test(stripped)) return null;
  return stripped.toLowerCase();
}

/**
 * Normalize an arXiv id to its bare form, dropping the version suffix.
 *
 * `2401.01234v3` and `2401.01234v1` are the same paper at different versions.
 * Keeping the version would make every revision a separate library entry,
 * which is exactly the duplicate-hell users complain about elsewhere.
 */
export function normalizeArxivId(input: string): string | null {
  const trimmed = input
    .trim()
    .replace(/^https?:\/\/arxiv\.org\/abs\//i, "")
    .replace(/^arxiv:/i, "")
    .trim();
  if (!trimmed) return null;

  // Modern: 2401.01234. Legacy: math.GT/0309136.
  const modern = /^(\d{4}\.\d{4,5})(v\d+)?$/i.exec(trimmed);
  if (modern?.[1]) return modern[1];

  const legacy = /^([a-z-]+(\.[A-Z]{2})?\/\d{7})(v\d+)?$/i.exec(trimmed);
  if (legacy?.[1]) return legacy[1].toLowerCase();

  return null;
}

/** OpenAlex ids arrive as full URLs about half the time. */
export function normalizeOpenAlexId(input: string): string | null {
  const trimmed = input.trim().replace(/^https?:\/\/openalex\.org\//i, "");
  return /^W\d+$/i.test(trimmed) ? trimmed.toUpperCase() : null;
}

/**
 * Build the `\cite{}` key: surname_year_firstsignificantword.
 *
 * MUST be stable forever — `01-data-model.md` §5 makes it globally unique and
 * immutable because it is embedded in every LaTeX document that cites the
 * work. Changing one silently breaks somebody's manuscript, which is why
 * `upsert_work()` never updates it on the enrichment path.
 */
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "on",
  "in",
  "of",
  "for",
  "and",
  "or",
  "to",
  "with",
  "from",
  "by",
  "at",
  "as",
  "is",
  "are",
  "using",
  "via",
  "towards",
  "toward",
]);

export function citationKey(
  firstAuthorName: string | undefined,
  year: number | null | undefined,
  title: string,
): string {
  const surname = extractSurname(firstAuthorName) || "anon";

  const word =
    normalizeTitle(title)
      .split(" ")
      .find((w) => w.length > 2 && !STOPWORDS.has(w)) ?? "untitled";

  return `${surname}_${year ?? "nd"}_${word}`;
}

/**
 * Pull a surname from a name string.
 *
 * Providers are inconsistent: OpenAlex gives "Jane Q. Smith", Crossref gives
 * family/given separately, BibTeX gives "Smith, Jane". Both orders appear, so
 * the comma is the only reliable signal of which half is the surname.
 */
export function extractSurname(name: string | undefined): string {
  if (!name) return "";

  const cleaned = name.trim();
  if (!cleaned) return "";

  // "Smith, Jane" — everything before the comma.
  const comma = cleaned.indexOf(",");
  const surname =
    comma > 0 ? cleaned.slice(0, comma) : (cleaned.split(/\s+/).at(-1) ?? "");

  return (
    surname
      .toLowerCase()
      .normalize("NFD")
      // Strip diacritics: "Müller" and "Muller" must produce the same key, or
      // the same author yields two.
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z]/g, "")
  );
}

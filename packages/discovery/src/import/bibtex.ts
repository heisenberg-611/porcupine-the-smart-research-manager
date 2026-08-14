import { normalizeArxivId, normalizeDoi } from "../normalize";
import type { WorkInput } from "../types";

/**
 * A BibTeX reader.
 *
 * BibTeX is not a format so much as an accretion of whatever LaTeX accepted,
 * and the exports people actually paste in come from Zotero, Mendeley, Google
 * Scholar and journal websites that each disagree about the details. So this
 * is written to be forgiving: a malformed entry is SKIPPED, never fatal.
 * Someone pasting 200 references does not want one stray brace to reject the
 * other 199, and telling them which entry failed is far more useful than
 * refusing the file.
 *
 * Handled, because real files contain all of it:
 *   - nested braces, `{The {DNA} Structure}`, which naive regexes truncate
 *   - quoted values, `"..."`, and bare numeric values
 *   - `@string` macros and `#` concatenation
 *   - LaTeX accents and escapes: `{\"o}`, `\'{e}`, `\&`, `--`
 *   - `and`-separated author lists in either name order
 *
 * Deliberately NOT handled: `@preamble`, crossref inheritance, and BibLaTeX's
 * date ranges. They appear in generated bibliographies, essentially never in
 * exports, and guessing at them is worse than ignoring them.
 */

export interface BibtexEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
}

export interface ParseResult<T> {
  entries: T[];
  /** One line per entry that could not be read. Shown to the user verbatim. */
  problems: string[];
}

// ── Tokenizing ───────────────────────────────────────────────────────────────

/**
 * Read a brace-balanced value starting at `start` (which must be the `{`).
 * Returns the inner text and the index just past the closing brace.
 *
 * Depth counting is the whole point: `{The {DNA} Structure}` must come back
 * complete. A regex stopping at the first `}` yields "The {DNA", which is how
 * half the BibTeX parsers on npm mangle chemistry and genetics titles.
 */
function readBraced(
  source: string,
  start: number,
): { value: string; next: number } | null {
  if (source[start] !== "{") return null;

  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i++; // Skip the escaped character, so `\{` does not change depth.
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) return { value: source.slice(start + 1, i), next: i + 1 };
    }
  }
  return null; // Unbalanced.
}

function readQuoted(
  source: string,
  start: number,
): { value: string; next: number } | null {
  if (source[start] !== '"') return null;

  let depth = 0;
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i++;
      continue;
    }
    if (char === "{") depth++;
    else if (char === "}") depth--;
    // A quote inside braces is literal — `"{a "b" c}"` is one value.
    else if (char === '"' && depth === 0) {
      return { value: source.slice(start + 1, i), next: i + 1 };
    }
  }
  return null;
}

// ── LaTeX de-escaping ────────────────────────────────────────────────────────

const ACCENTS: Record<string, Record<string, string>> = {
  '"': { a: "ä", e: "ë", i: "ï", o: "ö", u: "ü", y: "ÿ", A: "Ä", O: "Ö", U: "Ü" },
  "'": {
    a: "á",
    e: "é",
    i: "í",
    o: "ó",
    u: "ú",
    y: "ý",
    c: "ć",
    n: "ń",
    s: "ś",
    A: "Á",
    E: "É",
  },
  "`": { a: "à", e: "è", i: "ì", o: "ò", u: "ù", A: "À", E: "È" },
  "^": { a: "â", e: "ê", i: "î", o: "ô", u: "û", A: "Â", O: "Ô" },
  "~": { a: "ã", n: "ñ", o: "õ", A: "Ã", N: "Ñ" },
  c: { c: "ç", s: "ş", C: "Ç" },
  v: { s: "š", c: "č", z: "ž", r: "ř", S: "Š", C: "Č", Z: "Ž" },
  H: { o: "ő", u: "ű" },
  ".": { z: "ż", e: "ė" },
  u: { a: "ă", g: "ğ" },
  "=": { o: "ō", a: "ā", e: "ē", u: "ū" },
};

const SYMBOLS: Record<string, string> = {
  "\\&": "&",
  "\\%": "%",
  "\\$": "$",
  "\\#": "#",
  "\\_": "_",
  "\\{": "{",
  "\\}": "}",
  "\\ss": "ß",
  "\\aa": "å",
  "\\AA": "Å",
  "\\o": "ø",
  "\\O": "Ø",
  "\\ae": "æ",
  "\\AE": "Æ",
  "\\l": "ł",
  "\\L": "Ł",
  "\\textendash": "–",
  "\\textemdash": "—",
};

/**
 * Turn LaTeX markup into the text a human meant.
 *
 * Titles arrive as `Sch{\"o}nberg's {DNA} analysis --- revisited`. Storing
 * that verbatim means the title never matches its Unicode twin from another
 * provider, so dedupe fails on exactly the papers imported two ways.
 */
export function deLatex(input: string): string {
  let text = input;

  // Accents in both spellings: {\"o} and \"{o}, plus the braceless \'e.
  text = text.replace(/\{\\(.)\{?(\w)\}?\}/g, (match, accent: string, letter: string) => {
    return ACCENTS[accent]?.[letter] ?? match;
  });
  text = text.replace(
    /\\(["'`^~=.]|[cvHu])\{(\w)\}/g,
    (match, accent: string, letter: string) => {
      return ACCENTS[accent]?.[letter] ?? match;
    },
  );
  text = text.replace(/\\(["'`^~=.])(\w)/g, (match, accent: string, letter: string) => {
    return ACCENTS[accent]?.[letter] ?? match;
  });

  for (const [from, to] of Object.entries(SYMBOLS)) {
    text = text.split(from).join(to);
  }

  // Dashes before brace-stripping, so `--` inside a title survives.
  text = text.replace(/---/g, "—").replace(/--/g, "–");

  // Formatting commands surrender their ARGUMENT before braces are stripped.
  // Doing it the other way round turns `\emph{important}` into
  // `\emphimportant`, which the orphan-command rule below then deletes
  // whole — silently losing a word out of the middle of a title.
  // Innermost-first, so `\textbf{\emph{x}}` unwraps completely.
  for (let pass = 0; pass < 4; pass++) {
    const unwrapped = text.replace(/\\[a-zA-Z]+\s*\{([^{}]*)\}/g, "$1");
    if (unwrapped === text) break;
    text = unwrapped;
  }

  // Any command left has no argument to give up.
  text = text.replace(/\\[a-zA-Z]+\s*/g, "");

  // Remaining braces exist to protect capitalization, and carry no meaning
  // once the value is plain text.
  text = text.replace(/[{}]/g, "");

  return text.replace(/\s+/g, " ").trim();
}

// ── Entry parsing ────────────────────────────────────────────────────────────

export function parseBibtex(source: string): ParseResult<BibtexEntry> {
  const entries: BibtexEntry[] = [];
  const problems: string[] = [];
  const macros: Record<string, string> = {};

  let index = 0;
  while (index < source.length) {
    const at = source.indexOf("@", index);
    if (at === -1) break;

    const braceStart = source.indexOf("{", at);
    if (braceStart === -1) break;

    const type = source
      .slice(at + 1, braceStart)
      .trim()
      .toLowerCase();
    const body = readBraced(source, braceStart);

    if (!body) {
      problems.push(`Unbalanced braces in an @${type} entry; skipped.`);
      break; // Everything after an unbalanced brace is unreliable.
    }

    index = body.next;

    if (type === "comment" || type === "preamble") continue;

    if (type === "string") {
      const eq = body.value.indexOf("=");
      if (eq > 0) {
        const name = body.value.slice(0, eq).trim();
        const value = parseValue(body.value.slice(eq + 1).trim(), macros);
        macros[name] = value;
      }
      continue;
    }

    const parsed = parseEntryBody(type, body.value, macros);
    if (parsed.entry) entries.push(parsed.entry);
    if (parsed.problem) problems.push(parsed.problem);
  }

  return { entries, problems };
}

function parseEntryBody(
  type: string,
  body: string,
  macros: Record<string, string>,
): { entry?: BibtexEntry; problem?: string } {
  const firstComma = body.indexOf(",");
  const key = (firstComma === -1 ? body : body.slice(0, firstComma)).trim();

  if (!key) return { problem: `An @${type} entry has no citation key; skipped.` };
  if (firstComma === -1) return { entry: { type, key, fields: {} } };

  const fields: Record<string, string> = {};
  let i = firstComma + 1;

  while (i < body.length) {
    const eq = body.indexOf("=", i);
    if (eq === -1) break;

    const name = body.slice(i, eq).trim().toLowerCase().replace(/^,+/, "").trim();
    let cursor = eq + 1;
    while (cursor < body.length && /\s/.test(body[cursor] ?? "")) cursor++;

    const { value, next } = readFieldValue(body, cursor, macros);
    if (name) fields[name] = value;

    // Advance past the separating comma.
    const comma = body.indexOf(",", next);
    if (comma === -1) break;
    i = comma + 1;
  }

  return { entry: { type, key, fields } };
}

/** Read one field value, following `#` concatenation to its end. */
function readFieldValue(
  body: string,
  start: number,
  macros: Record<string, string>,
): { value: string; next: number } {
  let cursor = start;
  const parts: string[] = [];

  for (;;) {
    while (cursor < body.length && /\s/.test(body[cursor] ?? "")) cursor++;

    const char = body[cursor];
    if (char === "{") {
      const braced = readBraced(body, cursor);
      if (!braced) break;
      parts.push(braced.value);
      cursor = braced.next;
    } else if (char === '"') {
      const quoted = readQuoted(body, cursor);
      if (!quoted) break;
      parts.push(quoted.value);
      cursor = quoted.next;
    } else {
      // Bare word: a number, or a macro name.
      let end = cursor;
      while (end < body.length && !/[,#\s]/.test(body[end] ?? "")) end++;
      const bare = body.slice(cursor, end).trim();
      parts.push(macros[bare] ?? bare);
      cursor = end;
    }

    while (cursor < body.length && /\s/.test(body[cursor] ?? "")) cursor++;
    if (body[cursor] === "#") {
      cursor++;
      continue;
    }
    break;
  }

  return { value: deLatex(parts.join("")), next: cursor };
}

function parseValue(raw: string, macros: Record<string, string>): string {
  return readFieldValue(raw, 0, macros).value;
}

// ── Mapping to WorkInput ─────────────────────────────────────────────────────

/**
 * Split a BibTeX author field.
 *
 * Names are separated by a literal ` and `, which is why "Smith and Sons
 * Publishing" as a single author is unrepresentable in BibTeX — a known
 * limitation of the format, not of this parser.
 */
export function splitBibtexAuthors(field: string): string[] {
  return field
    .split(/\s+and\s+/i)
    .map((name) => name.trim())
    .filter(Boolean);
}

const TYPE_MAP: Record<string, string> = {
  article: "article",
  inproceedings: "article",
  conference: "article",
  incollection: "article",
  book: "book",
  inbook: "book",
  phdthesis: "thesis",
  mastersthesis: "thesis",
  techreport: "report",
  misc: "misc",
  unpublished: "preprint",
};

export function bibtexToWorkInput(entry: BibtexEntry): WorkInput | null {
  const title = entry.fields.title;
  if (!title) return null;

  const year = Number(/\d{4}/.exec(entry.fields.year ?? entry.fields.date ?? "")?.[0]);

  // arXiv ids hide in several fields depending on who generated the file.
  const arxivRaw =
    entry.fields.eprint ??
    entry.fields.archiveprefix ??
    /(?:arxiv[:\s]+)([\w./-]+)/i.exec(entry.fields.note ?? "")?.[1] ??
    undefined;

  return {
    doi: entry.fields.doi ? normalizeDoi(entry.fields.doi) : null,
    arxivId: arxivRaw ? normalizeArxivId(arxivRaw) : null,
    title,
    abstract: entry.fields.abstract ?? null,
    authors: splitBibtexAuthors(entry.fields.author ?? "").map((name, position) => ({
      name,
      orcid: null,
      affiliation: null,
      position,
    })),
    venue:
      entry.fields.journal ?? entry.fields.booktitle ?? entry.fields.publisher ?? null,
    publishedYear: Number.isFinite(year) ? year : null,
    type: TYPE_MAP[entry.type] ?? entry.type,
    language: entry.fields.language ?? null,
    citedByCount: 0,
    referencedWorks: [],
    // The imported file is not proof of open access, so this stays null.
    oaPdfUrl: null,
    raw: { bibtex: entry },
  };
}

export function importBibtex(source: string): ParseResult<WorkInput> {
  const { entries, problems } = parseBibtex(source);
  const works: WorkInput[] = [];

  for (const entry of entries) {
    const work = bibtexToWorkInput(entry);
    if (work) works.push(work);
    else problems.push(`@${entry.type}{${entry.key}} has no title; skipped.`);
  }

  return { entries: works, problems };
}

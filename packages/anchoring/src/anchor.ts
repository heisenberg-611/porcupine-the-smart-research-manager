/**
 * The anchoring engine.
 *
 * Every highlight, margin note, and — from Phase 2 — every extracted value
 * resolves through this. It is the highest-consequence code in Phase 1,
 * because its failure mode is silent: a quote that resolves to the WRONG
 * passage still renders, still looks like a citation, and nobody notices
 * until a reviewer checks the source.
 *
 * So the design principle is: **drift loudly**. Three outcomes, never two.
 *
 *   OK       the passage was found where we are confident it belongs
 *   DRIFTED  something similar was found, but not identical — show it, and
 *            say so, so a human can confirm or re-anchor
 *   BROKEN   nothing plausible was found; say that rather than guessing
 *
 * A two-state design (found / not found) forces every uncertain match into
 * one bucket or the other, and both choices are wrong: silently accepting a
 * fuzzy match fabricates citations, and rejecting one throws away a
 * recoverable anchor because a PDF re-extraction changed a ligature.
 *
 * The selector model follows the W3C Web Annotation Data Model: a
 * TextQuoteSelector (quote + prefix + suffix) that survives reflow, plus a
 * TextPositionSelector (offsets) that is fast when nothing has changed.
 * Neither alone is sufficient — offsets break on re-extraction, and quotes
 * are ambiguous when a phrase repeats.
 */

export interface AnchorSelector {
  /** The selected text. The only required part. */
  quote: string;
  /** Up to ~32 characters immediately before the quote. Disambiguates. */
  prefix?: string | undefined;
  /** Up to ~32 characters immediately after. */
  suffix?: string | undefined;
  /** Character offset of the quote's start in the page text, when known. */
  startOff?: number | undefined;
  endOff?: number | undefined;
  /** 1-based page number, for a paginated document. */
  page?: number | undefined;
}

export type AnchorStatus = "OK" | "DRIFTED" | "BROKEN";

export type Resolution =
  | { status: "OK"; start: number; end: number; text: string }
  | {
      status: "DRIFTED";
      start: number;
      end: number;
      text: string;
      /** 0..1. How close the found text is to the recorded quote. */
      similarity: number;
      reason: string;
    }
  | { status: "BROKEN"; reason: string };

/** How much context to capture either side of a selection. */
export const CONTEXT_LENGTH = 32;

/**
 * Below this similarity we refuse to guess.
 *
 * 0.75 is deliberately permissive, because DRIFTED is not an acceptance — it
 * is a flag asking a human to look. The cost of showing a weak match marked
 * "verify this" is far lower than the cost of losing a real annotation
 * because a PDF re-extraction changed the hyphenation.
 */
export const DRIFT_THRESHOLD = 0.75;

// ── Building a selector ──────────────────────────────────────────────────────

/**
 * Capture a selector from a known position in the text.
 *
 * Both the quote AND its surroundings are recorded at capture time, because
 * after the document changes there is no way to recover the context that
 * would have disambiguated it.
 */
export function createSelector(
  text: string,
  start: number,
  end: number,
  page?: number,
): AnchorSelector {
  if (start < 0 || end > text.length || start >= end) {
    throw new RangeError(
      `invalid selection [${start}, ${end}) in text of ${text.length}`,
    );
  }

  return {
    quote: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT_LENGTH), start),
    suffix: text.slice(end, Math.min(text.length, end + CONTEXT_LENGTH)),
    startOff: start,
    endOff: end,
    ...(page !== undefined ? { page } : {}),
  };
}

// ── Normalization ────────────────────────────────────────────────────────────

/**
 * Collapse the differences that a PDF re-extraction introduces but a reader
 * would never notice.
 *
 * This is where most real-world "drift" comes from: the same PDF extracted by
 * a different pdf.js version yields different whitespace, different quote
 * characters, and different ligature handling. Treating those as content
 * changes would mark half a library DRIFTED after a dependency bump.
 */
/**
 * Per-character folding table.
 *
 * One table drives BOTH `normalize` and `normalizeWithMap`. They were briefly
 * separate implementations, which is a bug waiting to happen: a character
 * folded by one and not the other means the quote and the document normalize
 * differently, and the match silently fails.
 *
 * An empty string means "drop this character entirely".
 */
const FOLD: Record<string, string> = {
  // Ligatures. pdf.js emits ﬁ as one codepoint sometimes and two others.
  "\uFB00": "ff",
  "\uFB01": "fi",
  "\uFB02": "fl",
  "\uFB03": "ffi",
  "\uFB04": "ffl",
  // Typographic quotes.
  "\u2018": "'",
  "\u2019": "'",
  "\u201A": "'",
  "\u201B": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u201E": '"',
  "\u201F": '"',
  // Dashes.
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2013": "-",
  "\u2014": "-",
  "\u2015": "-",
  // Dropped: soft hyphen, zero-width space/non-joiner/joiner, BOM.
  "\u00AD": "",
  "\u200B": "",
  "\u200C": "",
  "\u200D": "",
  "\uFEFF": "",
  // Exotic spaces, folded to a plain one.
  "\u00A0": " ",
  "\u2000": " ",
  "\u2001": " ",
  "\u2002": " ",
  "\u2003": " ",
  "\u2004": " ",
  "\u2005": " ",
  "\u2006": " ",
  "\u2007": " ",
  "\u2008": " ",
  "\u2009": " ",
  "\u200A": " ",
  "\u202F": " ",
  "\u205F": " ",
  "\u3000": " ",
};

/**
 * Collapse the differences a PDF re-extraction introduces but a reader would
 * never notice.
 *
 * This is where most real-world "drift" comes from: the same PDF extracted by
 * a different pdf.js version yields different whitespace, quote characters,
 * and ligature handling. Treating those as content changes would mark half a
 * library DRIFTED after a dependency bump.
 */
export function normalize(text: string): string {
  return normalizeWithMap(text).normalized;
}

// ── Similarity ───────────────────────────────────────────────────────────────

/**
 * Levenshtein distance, capped.
 *
 * The cap matters: this runs over candidate windows in a page of text, and an
 * uncapped O(n·m) over a long quote is the difference between a reader that
 * opens instantly and one that hangs. Once the distance exceeds `max` the
 * exact value is irrelevant — the candidate is already rejected.
 */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);

  for (let j = 0; j <= b.length; j++) previous[j] = j;

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = current[0]!;

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j]! + 1, // deletion
        current[j - 1]! + 1, // insertion
        previous[j - 1]! + cost, // substitution
      );
      if (current[j]! < rowMin) rowMin = current[j]!;
    }

    // Every future row is >= this row's minimum, so we can stop early.
    if (rowMin > max) return max + 1;

    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length]!;
}

/** 1 for identical, 0 for entirely different. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const longest = Math.max(a.length, b.length);
  const max = Math.ceil(longest * (1 - DRIFT_THRESHOLD)) + 1;
  const distance = boundedLevenshtein(a, b, max);

  if (distance > max) return 0;
  return 1 - distance / longest;
}

// ── Resolution ───────────────────────────────────────────────────────────────

function findAll(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const positions: number[] = [];
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return positions;
    positions.push(at);
    from = at + 1; // Overlapping occurrences count.
  }
}

/**
 * Score a candidate by how well its surroundings match the recorded context.
 *
 * This is what makes a repeated phrase resolvable. "the results were
 * significant" may appear six times in a paper; the sentence before it is
 * what identifies which one was highlighted.
 */
function contextScore(
  text: string,
  start: number,
  end: number,
  selector: AnchorSelector,
): number {
  let score = 0;
  let considered = 0;

  if (selector.prefix) {
    const actual = text.slice(Math.max(0, start - selector.prefix.length), start);
    score += similarity(normalize(actual), normalize(selector.prefix));
    considered++;
  }

  if (selector.suffix) {
    const actual = text.slice(end, end + selector.suffix.length);
    score += similarity(normalize(actual), normalize(selector.suffix));
    considered++;
  }

  return considered === 0 ? 0 : score / considered;
}

/**
 * Locate a selector in a document.
 *
 * Order is by descending confidence, and the first confident answer wins:
 *
 *   1. the recorded offsets still hold the recorded quote — nothing changed
 *   2. the exact quote appears once — offsets are stale, text is not
 *   3. the exact quote appears several times — context decides which
 *   4. normalized match — whitespace or ligatures changed, meaning did not
 *   5. fuzzy match near where it used to be — DRIFTED, for a human to confirm
 *   6. nothing plausible — BROKEN
 */
export function resolveAnchor(selector: AnchorSelector, text: string): Resolution {
  if (!selector.quote) return { status: "BROKEN", reason: "the anchor has no quote" };
  if (!text) return { status: "BROKEN", reason: "the document is empty" };

  const { quote, startOff, endOff } = selector;

  // 1. Fast path.
  if (
    startOff !== undefined &&
    endOff !== undefined &&
    endOff <= text.length &&
    text.slice(startOff, endOff) === quote
  ) {
    return { status: "OK", start: startOff, end: endOff, text: quote };
  }

  // 2 & 3. Exact occurrences.
  const exact = findAll(text, quote);
  if (exact.length === 1) {
    const start = exact[0]!;
    return { status: "OK", start, end: start + quote.length, text: quote };
  }

  if (exact.length > 1) {
    const best = exact
      .map((start) => ({
        start,
        end: start + quote.length,
        context: contextScore(text, start, start + quote.length, selector),
        // Distance from the old position breaks a context tie.
        distance: startOff === undefined ? 0 : Math.abs(start - startOff),
      }))
      .sort((a, b) => b.context - a.context || a.distance - b.distance)[0]!;

    return { status: "OK", start: best.start, end: best.end, text: quote };
  }

  // 4. Normalized match: the text is the same, its encoding is not.
  const normalizedQuote = normalize(quote);
  const normalizedResult = findNormalized(text, normalizedQuote, selector);
  if (normalizedResult) return normalizedResult;

  // 5. Fuzzy.
  return findFuzzy(text, selector);
}

/**
 * Normalize while remembering where every character came from.
 *
 * The naive approach — normalize the quote, then search the RAW text for it —
 * cannot work: the whole point of normalization is that the raw text spells
 * things differently. A curly quote or an ﬁ ligature means `indexOf` finds
 * nothing, and the anchor is declared BROKEN over a typographic difference.
 *
 * So the document is normalized once and an index map is kept alongside it,
 * letting a match found in normalized space be reported in raw offsets. The
 * map is the reason this works at all.
 */
export function normalizeWithMap(text: string): { normalized: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let lastWasSpace = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const folded = FOLD[char];

    // Dropped entirely: soft hyphens, zero-width joiners, BOM.
    if (folded === "") continue;

    const replacement = folded ?? char;

    if (/\s/.test(replacement)) {
      // Collapse runs, and drop leading whitespace.
      if (lastWasSpace || out.length === 0) continue;
      out.push(" ");
      map.push(i);
      lastWasSpace = true;
      continue;
    }

    lastWasSpace = false;
    // A ligature expands to several characters, all pointing at one raw index.
    for (const c of replacement.toLowerCase()) {
      out.push(c);
      map.push(i);
    }
  }

  while (out.length > 0 && out[out.length - 1] === " ") {
    out.pop();
    map.pop();
  }

  return { normalized: out.join(""), map };
}

/** Raw [start, end) for a match at `index` of `length` in normalized space. */
function toRawRange(
  map: number[],
  index: number,
  length: number,
): { start: number; end: number } {
  const start = map[index] ?? 0;
  const lastRaw = map[index + length - 1] ?? start;
  return { start, end: lastRaw + 1 };
}

/**
 * Match after normalization: the text says the same thing, spelled differently.
 */
function findNormalized(
  text: string,
  normalizedQuote: string,
  selector: AnchorSelector,
): Resolution | null {
  if (!normalizedQuote) return null;

  const { normalized, map } = normalizeWithMap(text);
  const hits = findAll(normalized, normalizedQuote);
  if (hits.length === 0) return null;

  let chosen = hits[0]!;
  if (hits.length > 1) {
    chosen = hits
      .map((index) => {
        const range = toRawRange(map, index, normalizedQuote.length);
        return {
          index,
          context: contextScore(text, range.start, range.end, selector),
          distance:
            selector.startOff === undefined
              ? 0
              : Math.abs(range.start - selector.startOff),
        };
      })
      .sort((a, b) => b.context - a.context || a.distance - b.distance)[0]!.index;
  }

  const { start, end } = toRawRange(map, chosen, normalizedQuote.length);
  return { status: "OK", start, end, text: text.slice(start, end) };
}

/**
 * Last resort: find the most similar passage and report it as DRIFTED.
 *
 * Never returns OK. Anything reaching here failed every exact test above, so
 * it is by definition uncertain — and saying so is the point of DRIFTED.
 */
function findFuzzy(text: string, selector: AnchorSelector): Resolution {
  const normalizedQuote = normalize(selector.quote);

  if (normalizedQuote.length < 8) {
    // A short quote fuzzy-matches almost anything; pointing at a coincidence
    // is worse than admitting the anchor cannot be recovered.
    return { status: "BROKEN", reason: "the quote is too short to relocate reliably" };
  }

  const { normalized, map } = normalizeWithMap(text);
  const words = normalizedQuote.split(" ").filter((w) => w.length > 3);
  if (words.length === 0) {
    return { status: "BROKEN", reason: "no distinctive words in the quote" };
  }

  // Anchor on the rarest surviving word: scanning every offset of a 50,000
  // character page is far too slow, and the rarest word is the strongest
  // positional hint available. Words the edit removed simply do not appear,
  // which is why the search cannot depend on any single one.
  const present = words
    .map((word) => ({ word, hits: findAll(normalized, word) }))
    .filter((w) => w.hits.length > 0)
    .sort((a, b) => a.hits.length - b.hits.length);

  if (present.length === 0) {
    return {
      status: "BROKEN",
      reason: "none of the quote's words appear in the document",
    };
  }

  const quoteLength = normalizedQuote.length;
  const step = Math.max(1, Math.floor(quoteLength / 8));
  let best: { start: number; end: number; score: number } | null = null;

  // Try the two rarest words, not just one: if the rarest happens to sit at
  // the end of the quote, anchoring only on it biases every window left.
  for (const { hits } of present.slice(0, 2)) {
    for (const hit of hits.slice(0, 60)) {
      for (let back = 0; back <= quoteLength; back += step) {
        const start = Math.max(0, hit - back);

        // Several window lengths, because an edit changes the length: a fixed
        // quote-length window truncates "settings" to "sett" and drops the
        // score below the threshold for a passage a human would call a match.
        for (const factor of [0.85, 1, 1.15, 1.3]) {
          const end = Math.min(
            normalized.length,
            start + Math.round(quoteLength * factor),
          );
          if (end - start < quoteLength * 0.5) continue;

          const score = similarity(normalized.slice(start, end), normalizedQuote);
          if (!best || score > best.score) best = { start, end, score };
        }
      }
    }
  }

  if (!best || best.score < DRIFT_THRESHOLD) {
    return {
      status: "BROKEN",
      reason: best
        ? `the closest passage matched only ${(best.score * 100).toFixed(0)}%`
        : "no similar passage found",
    };
  }

  const range = toRawRange(map, best.start, best.end - best.start);
  return {
    status: "DRIFTED",
    start: range.start,
    end: range.end,
    text: text.slice(range.start, range.end),
    similarity: best.score,
    reason:
      "the document changed since this was highlighted — check that the passage " +
      "is still the one you meant",
  };
}

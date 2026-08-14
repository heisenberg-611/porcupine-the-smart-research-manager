/**
 * Phase 2b — agreement between two independent extractions.
 *
 * Dual extraction is the thing that makes a systematic review a systematic
 * review rather than one person's reading: two people extract the same paper
 * without seeing each other's answers, disagreements are surfaced, and a third
 * person resolves them. Cohen's κ is how the field reports whether the two
 * agreed more than chance would predict.
 *
 * Pure and dependency-free, so it runs under vitest in milliseconds and could
 * run on the relay's workerd runtime if it ever needed to.
 */

import type { FieldType } from "./protocol";

/**
 * The field types κ is DEFINED for.
 *
 * κ is a statistic about categorical agreement. Running it over free text
 * produces a number that looks authoritative and means nothing: two extractors
 * writing "randomised controlled trial" and "RCT" have agreed completely and
 * scored zero, and any κ computed across a column where almost every value is
 * unique is dominated by that artefact rather than by rater behaviour.
 *
 * So κ is reported for ENUM and BOOLEAN only. Everything else gets raw
 * agreement, clearly labelled as raw agreement — which is honest and still
 * useful for spotting a field where the two extractors are systematically
 * reading the question differently.
 *
 * MULTI_ENUM is excluded deliberately even though it is categorical: it is
 * set-valued, and Cohen's κ is not defined for multi-label data. Treating each
 * distinct SET as a category is a real technique but a different statistic
 * with different properties, and quietly substituting it would be worse than
 * declining.
 */
export const KAPPA_ELIGIBLE_TYPES: readonly FieldType[] = ["ENUM", "BOOLEAN"];

export function supportsKappa(type: FieldType): boolean {
  return KAPPA_ELIGIBLE_TYPES.includes(type);
}

/**
 * Do two extracted values agree?
 *
 * Type-aware on purpose. A NUMBER stored as 12 and 12.0 is the same answer;
 * compared as strings it is a disagreement, which would send a verifier to
 * adjudicate a difference that does not exist.
 */
export function valuesAgree(type: FieldType, a: unknown, b: unknown): boolean {
  // Two holes are not an agreement. Neither extractor answered, so there is
  // nothing to agree about, and counting it as agreement would inflate every
  // score on a half-finished review.
  if (a === null || a === undefined || b === null || b === undefined) return false;

  switch (type) {
    case "NUMBER": {
      const na = toNumber(a);
      const nb = toNumber(b);
      if (na === null || nb === null) return normalise(a) === normalise(b);
      return na === nb;
    }

    case "BOOLEAN":
      return toBoolean(a) === toBoolean(b);

    case "MULTI_ENUM": {
      // Set equality: order is a UI artefact, not an answer.
      const sa = toStringSet(a);
      const sb = toStringSet(b);
      if (sa === null || sb === null) return normalise(a) === normalise(b);
      if (sa.size !== sb.size) return false;
      for (const v of sa) if (!sb.has(v)) return false;
      return true;
    }

    default:
      // ENUM, TEXT, LONG_TEXT, DATE, QUOTE, CITATION, URL.
      //
      // Case and surrounding whitespace are not disagreements — "RCT" and
      // "rct " came from the same reading of the paper, and making a verifier
      // adjudicate that is how a reconciliation queue becomes something people
      // stop using.
      return normalise(a) === normalise(b);
  }
}

function normalise(value: unknown): string {
  if (typeof value === "string") return value.trim().toLowerCase();
  return JSON.stringify(value ?? null);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBoolean(value: unknown): boolean | string {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "yes") return true;
    if (v === "false" || v === "no") return false;
    return v;
  }
  return normalise(value);
}

function toStringSet(value: unknown): Set<string> | null {
  if (!Array.isArray(value)) return null;
  return new Set(value.map((v) => normalise(v)));
}

export interface KappaResult {
  /**
   * null when κ is UNDEFINED rather than zero. The caller must render the
   * difference; see the note on the degenerate case below.
   */
  kappa: number | null;
  /** Observed agreement. Always meaningful, even when κ is not. */
  observedAgreement: number;
  /** Agreement expected by chance, from the two raters' marginals. */
  expectedAgreement: number;
  /** Papers both people extracted this field for. */
  n: number;
  /** Present when kappa is null: why it could not be computed. */
  undefinedReason?: string;
}

export interface RatingPair {
  a: string;
  b: string;
}

/**
 * Cohen's κ for two raters over one categorical field.
 *
 *     κ = (po − pe) / (1 − pe)
 *
 * THE DEGENERATE CASE, which is the whole reason this returns `number | null`.
 *
 * When both extractors used exactly one category — every paper marked "RCT",
 * say — the expected agreement pe is 1, so the denominator is 0. κ is
 * undefined. The tempting implementation returns 1.0 ("they agreed on
 * everything!"), and that is precisely backwards: when a field has no
 * variance, agreeing on it demonstrates nothing about the raters at all.
 * Chance alone would have produced the same result.
 *
 * This is the κ paradox in its sharpest form, and reporting a confident 1.0
 * there would put a number in a published methods section that the data does
 * not support. So it returns null and says why, and the UI shows the observed
 * agreement instead — which IS meaningful and is what the reader wants.
 *
 * κ can also be NEGATIVE: agreement worse than chance. That is a real result
 * and is not clamped.
 */
export function cohensKappa(pairs: readonly RatingPair[]): KappaResult {
  const n = pairs.length;

  if (n === 0) {
    return {
      kappa: null,
      observedAgreement: 0,
      expectedAgreement: 0,
      n: 0,
      undefinedReason: "No paper has been extracted twice for this field yet.",
    };
  }

  let agreements = 0;
  const marginalsA = new Map<string, number>();
  const marginalsB = new Map<string, number>();

  for (const { a, b } of pairs) {
    if (a === b) agreements++;
    marginalsA.set(a, (marginalsA.get(a) ?? 0) + 1);
    marginalsB.set(b, (marginalsB.get(b) ?? 0) + 1);
  }

  const observedAgreement = agreements / n;

  // pe = Σ over categories of P(rater A picks c) × P(rater B picks c).
  // Iterating A's categories is sufficient: a category only A used contributes
  // p_a × 0, and one only B used contributes 0 × p_b.
  let expectedAgreement = 0;
  for (const [category, countA] of marginalsA) {
    const countB = marginalsB.get(category) ?? 0;
    expectedAgreement += (countA / n) * (countB / n);
  }

  const denominator = 1 - expectedAgreement;

  // Floating point: with one category, pe computes to 0.9999999999999998
  // rather than exactly 1, so an `=== 0` test would sail past the degenerate
  // case and return a κ of about -4000.
  if (Math.abs(denominator) < 1e-10) {
    return {
      kappa: null,
      observedAgreement,
      expectedAgreement,
      n,
      undefinedReason:
        "Both extractors used a single category throughout, so chance alone " +
        "predicts complete agreement. κ is undefined here; the observed " +
        "agreement is the meaningful figure.",
    };
  }

  return {
    kappa: (observedAgreement - expectedAgreement) / denominator,
    observedAgreement,
    expectedAgreement,
    n,
  };
}

/**
 * Landis & Koch (1977) bands.
 *
 * A CONVENTION, not a law, and widely criticised for exactly the reason above:
 * the bands ignore how many categories there are and how they are distributed.
 * Offered as a word next to the number because reviewers expect one, and
 * deliberately worded so it reads as a description rather than a verdict.
 */
export function kappaLabel(kappa: number): string {
  if (kappa < 0) return "worse than chance";
  if (kappa <= 0.2) return "slight";
  if (kappa <= 0.4) return "fair";
  if (kappa <= 0.6) return "moderate";
  if (kappa <= 0.8) return "substantial";
  return "almost perfect";
}

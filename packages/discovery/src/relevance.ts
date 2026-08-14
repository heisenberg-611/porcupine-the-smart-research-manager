import { normalizeTitle } from "./normalize";
import type { WorkInput } from "./types";

/**
 * Relevance scoring for search results.
 *
 * Ranking is the difference between "300 results" and "the twelve papers you
 * should read first", and it is the one place where a research tool can be
 * genuinely more useful than a database query. But it must stay EXPLAINABLE:
 * a researcher who cannot tell why a paper ranked highly cannot defend their
 * search strategy in a methods section, and a systematic review lives or dies
 * on that defence.
 *
 * So the score is a weighted sum of four legible signals, each returned
 * alongside the total, and there is no learned model anywhere near it
 * (ADR-003: no AI in v1 — but the reporting requirement would rule out an
 * opaque ranker even if there were).
 */

export interface RelevanceSignals {
  /** Project question keywords found in the title. */
  titleMatch: number;
  /** Keywords found in the abstract. */
  abstractMatch: number;
  /** Newer work scores higher, on a gentle curve. */
  recency: number;
  /** Citations, log-scaled — a 10,000-cite paper is not 100× a 100-cite one. */
  impact: number;
}

export interface ScoredWork {
  work: WorkInput;
  score: number;
  signals: RelevanceSignals;
  /** Which keywords actually matched, for the "why is this here?" affordance. */
  matched: string[];
}

/**
 * Weights.
 *
 * Title match dominates deliberately. An abstract mentioning a term in
 * passing is weak evidence; a title containing it is a statement about what
 * the paper is for. Impact is weighted lowest on purpose — ranking by
 * citations is how a literature review ends up reproducing the field's
 * existing blind spots, and recent work has not had time to accumulate them.
 */
const WEIGHTS = {
  titleMatch: 0.5,
  abstractMatch: 0.2,
  recency: 0.15,
  impact: 0.15,
} as const;

/** Tokens too short or too common to carry meaning. */
const MIN_KEYWORD_LENGTH = 3;

function tokenize(text: string): Set<string> {
  return new Set(normalizeTitle(text).split(" ").filter(Boolean));
}

/**
 * Fraction of keywords present, with a phrase bonus.
 *
 * Multi-word keywords ("machine learning") are checked as phrases first: a
 * paper containing both words separately is a weaker match than one using
 * the actual term, and treating them the same is how "learning machines to
 * cook" outranks a machine-learning paper.
 */
function keywordOverlap(
  text: string,
  keywords: string[],
): { score: number; matched: string[] } {
  if (keywords.length === 0 || !text) return { score: 0, matched: [] };

  const normalized = normalizeTitle(text);
  const tokens = tokenize(text);
  const matched: string[] = [];

  let hits = 0;
  for (const keyword of keywords) {
    const normalizedKeyword = normalizeTitle(keyword);
    if (!normalizedKeyword || normalizedKeyword.length < MIN_KEYWORD_LENGTH) continue;

    if (normalizedKeyword.includes(" ")) {
      if (normalized.includes(normalizedKeyword)) {
        hits += 1;
        matched.push(keyword);
      } else {
        // Partial credit when the words are all present but not adjacent.
        const parts = normalizedKeyword
          .split(" ")
          .filter((p) => p.length >= MIN_KEYWORD_LENGTH);
        if (parts.length > 0 && parts.every((part) => tokens.has(part))) {
          hits += 0.5;
          matched.push(keyword);
        }
      }
    } else if (tokens.has(normalizedKeyword)) {
      hits += 1;
      matched.push(keyword);
    }
  }

  const usable = keywords.filter(
    (k) => normalizeTitle(k).length >= MIN_KEYWORD_LENGTH,
  ).length;
  return { score: usable === 0 ? 0 : Math.min(1, hits / usable), matched };
}

/**
 * Recency on a 25-year ramp.
 *
 * Not a hard cutoff: a 1998 paper can be the foundational one, and a search
 * tool that buries it is worse than useless for a literature review. The
 * curve is gentle enough that a strong keyword match still beats a recent
 * weak one.
 */
function recencyScore(year: number | null | undefined, now: number): number {
  if (!year) return 0.3; // Unknown date: neither rewarded nor punished.
  const age = now - year;
  if (age <= 0) return 1;
  if (age >= 25) return 0;
  return 1 - age / 25;
}

/** log10 scaling: 0 cites → 0, 10 → 0.25, 100 → 0.5, 10,000 → 1. */
function impactScore(citedByCount: number): number {
  if (citedByCount <= 0) return 0;
  return Math.min(1, Math.log10(citedByCount + 1) / 4);
}

export function scoreWork(
  work: WorkInput,
  keywords: string[],
  now = new Date().getFullYear(),
): ScoredWork {
  const title = keywordOverlap(work.title, keywords);
  const abstract = keywordOverlap(work.abstract ?? "", keywords);

  const signals: RelevanceSignals = {
    titleMatch: title.score,
    abstractMatch: abstract.score,
    recency: recencyScore(work.publishedYear, now),
    impact: impactScore(work.citedByCount),
  };

  const score =
    signals.titleMatch * WEIGHTS.titleMatch +
    signals.abstractMatch * WEIGHTS.abstractMatch +
    signals.recency * WEIGHTS.recency +
    signals.impact * WEIGHTS.impact;

  return {
    work,
    score,
    signals,
    matched: [...new Set([...title.matched, ...abstract.matched])],
  };
}

/**
 * Rank a result set against the project's research questions.
 *
 * With no keywords the ordering falls back to recency and impact, which is
 * the honest behaviour: we have been told nothing about what the project is
 * for, so we cannot pretend to know what is relevant to it.
 */
export function rankWorks(
  works: WorkInput[],
  keywords: string[],
  now = new Date().getFullYear(),
): ScoredWork[] {
  return works
    .map((work) => scoreWork(work, keywords, now))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Stable tiebreak so the same search returns the same order twice —
      // a result list that reshuffles between renders is unusable for
      // screening, where people work through it position by position.
      return a.work.title.localeCompare(b.work.title);
    });
}

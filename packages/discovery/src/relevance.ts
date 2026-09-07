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
 * The score is a weighted sum of legible signals with relevance gating:
 *   1. Search Query Relevance (direct user query intent)
 *   2. Research Question Alignment (per-question max pooling)
 *   3. Recency & Citation Impact (boosting relevant papers, gated to ~0 for unrelated papers)
 */

export interface RelevanceSignals {
  /** Title keyword/query match score (0..1). */
  titleMatch: number;
  /** Abstract keyword/query match score (0..1). */
  abstractMatch: number;
  /** Newer work scores higher, on a gentle curve (0..1). */
  recency: number;
  /** Citations, log-scaled (0..1). */
  impact: number;
  /** Explicit query match in title if query was provided (0..1). */
  queryTitleMatch?: number;
  /** Explicit query match in abstract if query was provided (0..1). */
  queryAbstractMatch?: number;
}

export interface ScoredWork {
  work: WorkInput;
  score: number;
  signals: RelevanceSignals;
  /** Which keywords/query terms actually matched, for the "why is this here?" affordance. */
  matched: string[];
}

export interface ResearchQuestionInput {
  text?: string;
  keywords?: string[];
}

export interface RankOptions {
  /** Active user search query terms (e.g. "spaced repetition in medical education"). */
  query?: string;
  /** Flat list of keywords (backwards compatible). */
  keywords?: string[];
  /** Structured research questions with individual keyword lists (prevents multi-question dilution). */
  questions?: ResearchQuestionInput[];
  /** Current year for recency calculation. */
  now?: number;
}

/** Stopwords that do not carry topic meaning and should not trigger false positive matches. */
export const ACADEMIC_STOPWORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "almost",
  "also",
  "although",
  "am",
  "among",
  "an",
  "and",
  "another",
  "any",
  "are",
  "arent",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "cannot",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "done",
  "down",
  "during",
  "each",
  "either",
  "enough",
  "especially",
  "etc",
  "even",
  "every",
  "few",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "however",
  "i",
  "if",
  "in",
  "into",
  "is",
  "isnt",
  "it",
  "its",
  "itself",
  "just",
  "may",
  "me",
  "might",
  "more",
  "most",
  "mostly",
  "must",
  "my",
  "myself",
  "neither",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "one",
  "only",
  "or",
  "other",
  "ought",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "per",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "upon",
  "us",
  "use",
  "used",
  "using",
  "very",
  "was",
  "wasnt",
  "we",
  "were",
  "werent",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "will",
  "with",
  "within",
  "without",
  "would",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
  "study",
  "studies",
  "paper",
  "investigation",
  "approach",
  "analysis",
  "role",
  "effect",
  "effects",
  "impact",
  "review",
  "toward",
  "towards",
]);

/** Minimum token length to be considered a meaningful unigram keyword (unless specifically whitelisted). */
const MIN_KEYWORD_LENGTH = 3;
const SHORT_ACRONYMS = new Set(["ai", "ml", "dl", "nlp", "llm", "cv", "ecg", "eeg", "mri", "dna", "rna", "pcr"]);

function isMeaningfulToken(token: string): boolean {
  const norm = normalizeTitle(token);
  if (!norm) return false;
  if (SHORT_ACRONYMS.has(norm)) return true;
  if (norm.length < MIN_KEYWORD_LENGTH) return false;
  if (ACADEMIC_STOPWORDS.has(norm)) return false;
  return true;
}

export function tokenizeText(text: string): { tokens: Set<string>; normalized: string } {
  const normalized = normalizeTitle(text);
  const words = normalized.split(" ").filter(Boolean);
  const tokens = new Set<string>();
  for (const w of words) {
    if (w.length > 0) tokens.add(w);
  }
  return { tokens, normalized };
}

/**
 * Extract clean, non-stopword search tokens from a string.
 */
export function extractMeaningfulTokens(text: string): string[] {
  return normalizeTitle(text)
    .split(" ")
    .filter(isMeaningfulToken);
}

/**
 * Check keyword overlap against pre-normalized text & token sets.
 * Multi-word phrases receive full credit when matched contiguously,
 * with partial credit when all constituent words appear scattered.
 */
function checkOverlap(
  normalizedText: string,
  tokens: Set<string>,
  keywords: string[],
): { score: number; matched: string[] } {
  if (keywords.length === 0 || !normalizedText) return { score: 0, matched: [] };

  const matched: string[] = [];
  let hits = 0;
  let usable = 0;

  for (const keyword of keywords) {
    const norm = normalizeTitle(keyword);
    if (!norm) continue;

    const isPhrase = norm.includes(" ");
    if (!isPhrase && !isMeaningfulToken(norm)) continue;

    usable += 1;

    if (isPhrase) {
      if (normalizedText.includes(norm)) {
        hits += 1;
        matched.push(keyword);
      } else {
        const parts = norm.split(" ").filter(isMeaningfulToken);
        if (parts.length > 0 && parts.every((p) => tokens.has(p))) {
          hits += 0.5;
          matched.push(keyword);
        }
      }
    } else if (tokens.has(norm)) {
      hits += 1;
      matched.push(keyword);
    }
  }

  return {
    score: usable === 0 ? 0 : Math.min(1, hits / usable),
    matched,
  };
}

/**
 * Recency on a 25-year ramp.
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

/**
 * Score a single work against search query and research questions.
 */
export function scoreWork(
  work: WorkInput,
  optionsOrKeywords: string[] | RankOptions = [],
  nowLegacy = new Date().getFullYear(),
): ScoredWork {
  const options: RankOptions = Array.isArray(optionsOrKeywords)
    ? { keywords: optionsOrKeywords, now: nowLegacy }
    : optionsOrKeywords;

  const now = options.now ?? nowLegacy;
  const rawQuery = options.query?.trim() ?? "";
  const rawKeywords = options.keywords ?? [];
  const rawQuestions = options.questions ?? [];

  const titleData = tokenizeText(work.title);
  const abstractData = tokenizeText(work.abstract ?? "");

  const allMatched: string[] = [];

  // --- 1. Active Search Query Scoring ---
  let queryTitleMatch = 0;
  let queryAbstractMatch = 0;
  let queryScore = 0;
  const hasQuery = rawQuery.length > 0;

  if (hasQuery) {
    const normQuery = normalizeTitle(rawQuery);
    const queryTokens = extractMeaningfulTokens(rawQuery);

    if (queryTokens.length > 0 || normQuery.length > 0) {
      // Exact full query phrase match
      const titleExactPhrase = normQuery.length >= 3 && titleData.normalized.includes(normQuery);
      const abstractExactPhrase = normQuery.length >= 3 && abstractData.normalized.includes(normQuery);

      // Check multi-word bigram phrases within query
      const bigrams: string[] = [];
      for (let i = 0; i < queryTokens.length - 1; i++) {
        bigrams.push(`${queryTokens[i]} ${queryTokens[i + 1]}`);
      }
      let bigramTitleHits = 0;
      let bigramAbstractHits = 0;
      for (const bg of bigrams) {
        if (titleData.normalized.includes(bg)) {
          bigramTitleHits += 1;
          allMatched.push(bg);
        }
        if (abstractData.normalized.includes(bg)) {
          bigramAbstractHits += 1;
          allMatched.push(bg);
        }
      }

      // Token overlap
      const titleTokensMatched = queryTokens.filter((t) => titleData.tokens.has(t));
      const abstractTokensMatched = queryTokens.filter((t) => abstractData.tokens.has(t));

      const titleRatio = queryTokens.length > 0 ? titleTokensMatched.length / queryTokens.length : 0;
      const abstractRatio =
        queryTokens.length > 0 ? abstractTokensMatched.length / queryTokens.length : 0;

      const bigramBonusTitle = bigrams.length > 0 ? (bigramTitleHits / bigrams.length) * 0.2 : 0;
      const bigramBonusAbstract = bigrams.length > 0 ? (bigramAbstractHits / bigrams.length) * 0.2 : 0;

      queryTitleMatch = titleExactPhrase ? 1.0 : Math.min(1, titleRatio + bigramBonusTitle);
      queryAbstractMatch = abstractExactPhrase ? 1.0 : Math.min(1, abstractRatio + bigramBonusAbstract);

      // Query score puts heavy weight on title match (70%) and abstract (30%)
      queryScore = queryTitleMatch * 0.7 + queryAbstractMatch * 0.3;

      if (titleExactPhrase || abstractExactPhrase) {
        allMatched.push(rawQuery);
      }
      for (const t of titleTokensMatched) allMatched.push(t);
      for (const t of abstractTokensMatched) allMatched.push(t);
    }
  }

  // --- 2. Research Questions & Keywords Alignment ---
  let questionTitleMatch = 0;
  let questionAbstractMatch = 0;
  let questionScore = 0;
  const hasQuestions = rawQuestions.length > 0;
  const hasKeywords = rawKeywords.length > 0;

  if (hasQuestions) {
    // Per-question max pooling: a paper that answers Question 1 with high precision
    // gets full credit, rather than having its score diluted across all project questions.
    const normQueryTokens = new Set(
      hasQuery ? extractMeaningfulTokens(rawQuery) : [],
    );

    for (const q of rawQuestions) {
      const qKeywords = [
        ...(q.keywords ?? []),
        ...extractMeaningfulTokens(q.text ?? ""),
      ];
      if (qKeywords.length === 0) continue;

      const tOverlap = checkOverlap(titleData.normalized, titleData.tokens, qKeywords);
      const aOverlap = checkOverlap(abstractData.normalized, abstractData.tokens, qKeywords);
      let qCombined = tOverlap.score * 0.7 + aOverlap.score * 0.3;

      // If a search query is active, check if the paper matches context keywords
      // beyond just repeating the user's search query terms.
      if (hasQuery && normQueryTokens.size > 0) {
        const contextKeywords = qKeywords.filter((k) => {
          const normK = normalizeTitle(k);
          return !normQueryTokens.has(normK) && !normK.split(" ").every((part) => normQueryTokens.has(part));
        });

        if (contextKeywords.length > 0) {
          const tContext = checkOverlap(titleData.normalized, titleData.tokens, contextKeywords);
          const aContext = checkOverlap(abstractData.normalized, abstractData.tokens, contextKeywords);
          const contextOverlap = tContext.score * 0.7 + aContext.score * 0.3;

          // If the paper matched 0 context keywords, it only matched the query term itself
          // (a potential cross-domain homonym). Heavily discount the question score.
          if (contextOverlap === 0) {
            qCombined = 0;
          } else {
            qCombined = qCombined * 0.4 + contextOverlap * 0.6;
          }
        }
      }

      if (qCombined > questionScore) {
        questionScore = qCombined;
        questionTitleMatch = tOverlap.score;
        questionAbstractMatch = aOverlap.score;
      }
      for (const m of tOverlap.matched) allMatched.push(m);
      for (const m of aOverlap.matched) allMatched.push(m);
    }
  } else if (hasKeywords) {
    // Flat keywords array fallback (legacy compatibility)
    const tOverlap = checkOverlap(titleData.normalized, titleData.tokens, rawKeywords);
    const aOverlap = checkOverlap(abstractData.normalized, abstractData.tokens, rawKeywords);
    questionTitleMatch = tOverlap.score;
    questionAbstractMatch = aOverlap.score;
    questionScore = questionTitleMatch * 0.7 + questionAbstractMatch * 0.3;

    for (const m of tOverlap.matched) allMatched.push(m);
    for (const m of aOverlap.matched) allMatched.push(m);
  }

  // Combine title and abstract signals for display
  const titleMatch = hasQuery && (hasQuestions || hasKeywords)
    ? queryTitleMatch * 0.6 + questionTitleMatch * 0.4
    : hasQuery
      ? queryTitleMatch
      : questionTitleMatch;

  const abstractMatch = hasQuery && (hasQuestions || hasKeywords)
    ? queryAbstractMatch * 0.6 + questionAbstractMatch * 0.4
    : hasQuery
      ? queryAbstractMatch
      : questionAbstractMatch;

  // --- 3. Recency & Impact Signals ---
  const recency = recencyScore(work.publishedYear, now);
  const impact = impactScore(work.citedByCount);

  // --- 4. Total Relevance & Gating ---
  const hasCriteria = hasQuery || hasQuestions || hasKeywords;
  let totalRelevance = 0;

  if (hasQuery && (hasQuestions || hasKeywords)) {
    if (questionScore > 0) {
      // Paper matches active query and has domain overlap with research questions.
      // Non-linear concordance: high domain overlap (answering the question) is strongly rewarded,
      // while superficial single-keyword overlaps (cross-domain homonyms) are scaled down.
      const domainConcordance = Math.pow(questionScore, 1.2);
      totalRelevance =
        queryScore * 0.35 +
        domainConcordance * 0.5 +
        Math.min(0.2, queryScore * domainConcordance * 0.3);
    } else {
      // Paper matches search terms, but matches 0% of the project's research domain.
      // E.g., searching "external validation" in a project about "human seeking validation"
      // matches ML statistical validation papers. Down-weight cross-domain homonyms.
      totalRelevance = queryScore * 0.15;
    }
  } else if (hasQuery) {
    totalRelevance = queryScore;
  } else if (hasQuestions || hasKeywords) {
    totalRelevance = questionScore;
  }

  let finalScore = 0;

  if (hasCriteria) {
    if (totalRelevance > 0) {
      // Relevance drives the primary score (70%). Recency & Impact provide an intelligent boost (30%)
      // scaled by relevance so high citations boost relevant papers without letting irrelevant ones dominate.
      const relevanceBoost = Math.sqrt(totalRelevance);
      finalScore =
        totalRelevance * 0.7 +
        recency * 0.15 * relevanceBoost +
        impact * 0.15 * relevanceBoost;
    } else {
      // RELEVANCE GATING: Zero match to query & questions drops score to near zero (< 0.01).
      // This solves the core issue where high-citation unrelated papers outranked relevant ones.
      finalScore = 0.01 * (recency * 0.5 + impact * 0.5);
    }
  } else {
    // Blank exploratory search with no criteria: fall back to recency and impact
    finalScore = recency * 0.5 + impact * 0.5;
  }

  // Deduplicate matched keywords
  const matchedSet = new Set(allMatched.filter(Boolean));

  const signals: RelevanceSignals = {
    titleMatch,
    abstractMatch,
    recency,
    impact,
    ...(hasQuery ? { queryTitleMatch, queryAbstractMatch } : {}),
  };

  return {
    work,
    score: Math.min(1, Math.max(0, finalScore)),
    signals,
    matched: [...matchedSet],
  };
}

/**
 * Rank a result set against active search query and project research questions.
 */
export function rankWorks(
  works: WorkInput[],
  optionsOrKeywords: string[] | RankOptions = [],
  nowLegacy = new Date().getFullYear(),
): ScoredWork[] {
  return works
    .map((work) => scoreWork(work, optionsOrKeywords, nowLegacy))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Stable tiebreak so the same search returns the same order twice
      return a.work.title.localeCompare(b.work.title);
    });
}

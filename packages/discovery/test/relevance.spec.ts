import { describe, expect, it } from "vitest";

import { rankWorks, scoreWork } from "../src/relevance";
import type { WorkInput } from "../src/types";

function work(overrides: Partial<WorkInput> & { title: string }): WorkInput {
  return {
    doi: null,
    arxivId: null,
    openalexId: null,
    pmid: null,
    abstract: null,
    authors: [],
    venue: null,
    publishedYear: null,
    publishedOn: null,
    type: null,
    language: null,
    oaStatus: null,
    oaPdfUrl: null,
    citedByCount: 0,
    referencedWorks: [],
    concepts: null,
    raw: null,
    ...overrides,
  };
}

const NOW = 2026;

describe("scoreWork", () => {
  it("ranks a title match above an abstract match", () => {
    const inTitle = scoreWork(
      work({ title: "Machine Learning in Genomics" }),
      ["genomics"],
      NOW,
    );
    const inAbstract = scoreWork(
      work({ title: "A Study", abstract: "We consider genomics." }),
      ["genomics"],
      NOW,
    );

    expect(inTitle.score).toBeGreaterThan(inAbstract.score);
  });

  it("reports which keywords matched", () => {
    const scored = scoreWork(
      work({ title: "Deep Learning for Protein Folding" }),
      ["protein", "crystallography"],
      NOW,
    );

    expect(scored.matched).toEqual(["protein"]);
  });

  it("prefers an exact phrase over the same words scattered", () => {
    const phrase = scoreWork(
      work({ title: "Machine Learning Methods" }),
      ["machine learning"],
      NOW,
    );
    const scattered = scoreWork(
      work({ title: "Learning to Cook with a Machine" }),
      ["machine learning"],
      NOW,
    );

    expect(phrase.score).toBeGreaterThan(scattered.score);
    // Scattered still earns partial credit rather than zero — the words are
    // genuinely there.
    expect(scattered.signals.titleMatch).toBeGreaterThan(0);
  });

  it("scales impact logarithmically", () => {
    const hundred = scoreWork(work({ title: "A", citedByCount: 100 }), [], NOW);
    const tenThousand = scoreWork(work({ title: "A", citedByCount: 10_000 }), [], NOW);

    // 100× the citations must not be 100× the signal, or the ranking just
    // reproduces the field's existing blind spots.
    expect(tenThousand.signals.impact / hundred.signals.impact).toBeLessThan(2.5);
  });

  it("does not bury an older paper that matches strongly", () => {
    const oldButRelevant = scoreWork(
      work({ title: "Foundations of Genomic Prediction", publishedYear: 2001 }),
      ["genomic prediction"],
      NOW,
    );
    const newButIrrelevant = scoreWork(
      work({ title: "A Note on Cake", publishedYear: 2026, citedByCount: 5 }),
      ["genomic prediction"],
      NOW,
    );

    expect(oldButRelevant.score).toBeGreaterThan(newButIrrelevant.score);
  });

  it("treats an unknown year as neutral rather than as ancient", () => {
    const unknown = scoreWork(work({ title: "A" }), [], NOW);
    const ancient = scoreWork(work({ title: "A", publishedYear: 1960 }), [], NOW);

    expect(unknown.signals.recency).toBeGreaterThan(ancient.signals.recency);
  });

  it("ignores keywords too short to carry meaning", () => {
    const scored = scoreWork(work({ title: "On Cats" }), ["on"], NOW);
    expect(scored.signals.titleMatch).toBe(0);
  });

  it("keeps every signal within 0..1", () => {
    const scored = scoreWork(
      work({
        title: "Genomics Genomics Genomics",
        abstract: "genomics",
        citedByCount: 1_000_000,
        publishedYear: 2030,
      }),
      ["genomics"],
      NOW,
    );

    for (const value of Object.values(scored.signals)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(scored.score).toBeLessThanOrEqual(1);
  });

  it("scores active search query terms directly", () => {
    const scored = scoreWork(
      work({
        title: "Advances in Spaced Repetition for Medical Education",
        abstract: "We evaluate flashcard schedules in residency training.",
        publishedYear: 2024,
      }),
      { query: "spaced repetition medical education", now: NOW },
    );

    expect(scored.score).toBeGreaterThan(0.6);
    expect(scored.matched).toContain("spaced repetition");
    expect(scored.matched).toContain("medical");
    expect(scored.matched).toContain("education");
  });

  it("gates relevance so an unrelated paper with 100k citations never outranks a matching paper", () => {
    const relevantPaper = scoreWork(
      work({
        title: "ECG Classification using Convolutional Neural Networks",
        abstract: "A study on arrhythmia detection.",
        publishedYear: 2024,
        citedByCount: 2,
      }),
      { query: "ECG classification neural networks", now: NOW },
    );

    const unrelatedPaperWithHugeCitations = scoreWork(
      work({
        title: "Discovery of Penicillin and Early Antibiotics History",
        abstract: "A comprehensive historical review of infectious disease treatments.",
        publishedYear: 2023,
        citedByCount: 150_000,
      }),
      { query: "ECG classification neural networks", now: NOW },
    );

    expect(relevantPaper.score).toBeGreaterThan(0.6);
    expect(unrelatedPaperWithHugeCitations.score).toBeLessThan(0.02);
    expect(relevantPaper.score).toBeGreaterThan(unrelatedPaperWithHugeCitations.score);
  });

  it("avoids multi-question keyword dilution using per-question max pooling", () => {
    const questions = [
      { text: "How does spaced repetition impact medical retention?", keywords: ["spaced repetition", "retention"] },
      { text: "What are best surgical simulation practices?", keywords: ["surgical simulation", "virtual reality", "laparoscopy"] },
      { text: "How does burnout affect clinical empathy?", keywords: ["burnout", "empathy", "wellbeing", "stress"] },
      { text: "What is the role of ultrasound in emergency care?", keywords: ["ultrasound", "emergency", "point of care"] },
    ];

    const paper = work({
      title: "Spaced Repetition and Knowledge Retention in Medical Students",
      abstract: "Long term evaluation of memory retention.",
      publishedYear: 2024,
    });

    const scoredWithQuestions = scoreWork(paper, { questions, now: NOW });
    // In the old algorithm, 2 matching keywords out of 12 total project keywords gave 2/12 = 0.16.
    // In the new algorithm with per-question max pooling, Question 1 is matched at 100%, yielding a high score.
    expect(scoredWithQuestions.score).toBeGreaterThan(0.65);
  });

  it("filters conversational stopwords from triggering bogus hits", () => {
    const scored = scoreWork(
      work({
        title: "How Does One Study and Review Modern Chemistry?",
        abstract: "During this investigation we approach the effects.",
      }),
      ["how", "does", "during", "study", "approach"],
      NOW,
    );

    expect(scored.matched).toEqual([]);
    expect(scored.signals.titleMatch).toBe(0);
    expect(scored.signals.abstractMatch).toBe(0);
  });

  it("prioritizes research domain concordance over cross-domain homonyms (psychology vs ML model external validation)", () => {
    const questions = [
      {
        text: "Why do humans seek external validation and social approval?",
        keywords: ["human", "seeking", "external validation", "social approval", "self-esteem", "psychology"],
      },
    ];

    const psychologyPaper = work({
      title: "Seeking External Validation: Social Approval, Human Self-Esteem, and Psychological Need",
      abstract: "An empirical investigation into why humans constantly seek external validation from peers.",
      publishedYear: 2024,
      citedByCount: 15,
    });

    const mlModelPaper = work({
      title: "Development and External Validation of a Deep Learning Model for Sepsis Prediction",
      abstract: "We report the external validation of machine learning algorithms on 10,000 ICU patients.",
      publishedYear: 2024,
      citedByCount: 450,
    });

    const ranked = rankWorks([mlModelPaper, psychologyPaper], {
      query: "external validation",
      questions,
      now: NOW,
    });

    expect(ranked[0]?.work.title).toBe(
      "Seeking External Validation: Social Approval, Human Self-Esteem, and Psychological Need",
    );
    expect(ranked[0]?.score).toBeGreaterThan(0.65);
    expect(ranked[1]?.score).toBeLessThan(0.3);
  });
});

describe("rankWorks", () => {
  it("orders by score", () => {
    const ranked = rankWorks(
      [
        work({ title: "Unrelated Work" }),
        work({ title: "Genomics Explained", publishedYear: 2024 }),
      ],
      ["genomics"],
      NOW,
    );

    expect(ranked[0]?.work.title).toBe("Genomics Explained");
  });

  it("ranks by search query when project has no research questions", () => {
    const ranked = rankWorks(
      [
        work({
          title: "General Physics and Astrophysics Review",
          publishedYear: 2024,
          citedByCount: 10_000,
        }),
        work({
          title: "Deep Reinforcement Learning for Robot Manipulation",
          publishedYear: 2024,
          citedByCount: 5,
        }),
      ],
      { query: "robot manipulation reinforcement learning", now: NOW },
    );

    expect(ranked[0]?.work.title).toBe("Deep Reinforcement Learning for Robot Manipulation");
  });

  it("is stable, so screening position does not shift between renders", () => {
    const works = [
      work({ title: "Beta", publishedYear: 2020, citedByCount: 10 }),
      work({ title: "Alpha", publishedYear: 2020, citedByCount: 10 }),
    ];

    const first = rankWorks(works, [], NOW).map((r) => r.work.title);
    const second = rankWorks([...works].reverse(), [], NOW).map((r) => r.work.title);

    expect(first).toEqual(second);
    expect(first).toEqual(["Alpha", "Beta"]);
  });

  it("falls back to recency and impact when the project has no keywords", () => {
    const ranked = rankWorks(
      [
        work({ title: "Old", publishedYear: 2001 }),
        work({ title: "New", publishedYear: 2025, citedByCount: 50 }),
      ],
      [],
      NOW,
    );

    expect(ranked[0]?.work.title).toBe("New");
  });

  it("handles an empty result set", () => {
    expect(rankWorks([], ["x"], NOW)).toEqual([]);
  });
});

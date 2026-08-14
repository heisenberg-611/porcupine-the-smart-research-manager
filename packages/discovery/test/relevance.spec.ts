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

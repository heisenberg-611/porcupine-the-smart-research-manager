import { describe, expect, it } from "vitest";

import { dedupe, findNearDuplicates, trigramSimilarity } from "../src/dedupe.js";
import type { WorkInput } from "../src/types.js";

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

describe("dedupe", () => {
  it("merges records sharing a DOI", () => {
    const merged = dedupe([
      work({ title: "A Paper", doi: "10.1/a", citedByCount: 5 }),
      work({
        title: "A Paper",
        doi: "10.1/a",
        citedByCount: 9,
        abstract: "Longer text.",
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.citedByCount).toBe(9);
    expect(merged[0]?.abstract).toBe("Longer text.");
  });

  it("merges transitively through a shared arXiv id", () => {
    // OpenAlex knows DOI + arXiv. Crossref knows only the DOI. S2 knows only
    // the arXiv id. Nothing links Crossref and S2 directly, so a naive
    // pairwise pass would leave two records.
    const merged = dedupe([
      work({ title: "Transformers", doi: "10.1/t", arxivId: "2401.00001" }),
      work({ title: "Transformers", doi: "10.1/t", venue: "NeurIPS" }),
      work({ title: "Transformers", arxivId: "2401.00001", citedByCount: 300 }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.venue).toBe("NeurIPS");
    expect(merged[0]?.citedByCount).toBe(300);
  });

  it("merges on normalized title and year when no identifier is shared", () => {
    const merged = dedupe([
      work({ title: "The Immune Response", publishedYear: 2020 }),
      work({ title: "the immune response!", publishedYear: 2020 }),
    ]);

    expect(merged).toHaveLength(1);
  });

  it("keeps papers with the same title but different years apart", () => {
    // Annual reports and recurring workshop papers genuinely share titles.
    const merged = dedupe([
      work({ title: "Annual Review", publishedYear: 2020 }),
      work({ title: "Annual Review", publishedYear: 2021 }),
    ]);

    expect(merged).toHaveLength(2);
  });

  it("keeps genuinely different papers apart", () => {
    const merged = dedupe([
      work({ title: "Immune Response in Mice", doi: "10.1/a" }),
      work({ title: "Immune Response in Humans", doi: "10.1/b" }),
    ]);

    expect(merged).toHaveLength(2);
  });

  it("prefers an open-access URL over none", () => {
    const merged = dedupe([
      work({ title: "P", doi: "10.1/p" }),
      work({
        title: "P",
        doi: "10.1/p",
        oaPdfUrl: "https://example.org/p.pdf",
        oaStatus: "gold",
      }),
    ]);

    expect(merged[0]?.oaPdfUrl).toBe("https://example.org/p.pdf");
    expect(merged[0]?.oaStatus).toBe("gold");
  });

  it("returns an empty list unchanged", () => {
    expect(dedupe([])).toEqual([]);
  });
});

describe("findNearDuplicates", () => {
  it("proposes near-matches without merging them", () => {
    const works = [
      work({ title: "Deep Learning for Genomic Prediction" }),
      work({ title: "Deep Learning for Genomic Predictions" }),
    ];

    // dedupe leaves them alone — an automatic merge would silently destroy
    // one of two possibly-different papers.
    expect(dedupe(works)).toHaveLength(2);

    const candidates = findNearDuplicates(works);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.similarity).toBeGreaterThan(0.85);
  });

  it("does not propose pairs that are already the same record", () => {
    const works = [
      work({ title: "Same Paper", doi: "10.1/s" }),
      work({ title: "Same Paper", doi: "10.1/s" }),
    ];
    expect(findNearDuplicates(works)).toHaveLength(0);
  });

  it("ignores unrelated titles", () => {
    const works = [
      work({ title: "Immune Response in Mice" }),
      work({ title: "Quantum Error Correction" }),
    ];
    expect(findNearDuplicates(works)).toHaveLength(0);
  });
});

describe("trigramSimilarity", () => {
  it("is 1 for identical strings and 0 for empty ones", () => {
    expect(trigramSimilarity("abc", "abc")).toBe(1);
    expect(trigramSimilarity("", "abc")).toBe(0);
  });

  it("ranks a near-match above an unrelated one", () => {
    const near = trigramSimilarity("deep learning", "deep learnings");
    const far = trigramSimilarity("deep learning", "quantum computing");
    expect(near).toBeGreaterThan(far);
    expect(far).toBeLessThan(0.3);
  });
});

import type { ScoredWork } from "@Porcupine/discovery";
import { describe, expect, it } from "vitest";

import {
  formatSearchExportMarkdown,
  generateSearchExportFilename,
} from "./search-markdown";

describe("search-markdown export", () => {
  const fixedDate = new Date("2026-08-23T12:00:00.000Z");

  describe("generateSearchExportFilename", () => {
    it("creates a safe slug from plain terms", () => {
      const filename = generateSearchExportFilename("machine learning", fixedDate);
      expect(filename).toBe("papers-machine-learning-2026-08-23.md");
    });

    it("sanitizes symbols, punctuation, and extra spaces", () => {
      const filename = generateSearchExportFilename(
        "AI & Healthcare: [Systematic Review] / 2026?",
        fixedDate,
      );
      expect(filename).toBe("papers-ai-healthcare-systematic-review-2026-2026-08-23.md");
    });

    it("falls back gracefully for empty or special-only characters", () => {
      const filename = generateSearchExportFilename("???///", fixedDate);
      expect(filename).toBe("papers-search-results-2026-08-23.md");
    });
  });

  describe("formatSearchExportMarkdown", () => {
    it("handles empty search results with a clear message", () => {
      const md = formatSearchExportMarkdown({
        terms: "nonexistent query",
        ranked: [],
        generatedAt: fixedDate,
      });

      expect(md).toContain("# Literature Search Export: nonexistent query");
      expect(md).toContain("- **Total Results:** 0 deduplicated papers");
      expect(md).toContain("*No papers matched this search query.*");
    });

    it("formats full paper details with abstracts and AI instructions", () => {
      const mockPapers: ScoredWork[] = [
        {
          score: 0.85,
          matched: ["spaced repetition", "memory"],
          signals: {
            titleMatch: 0.9,
            abstractMatch: 0.8,
            recency: 0.95,
            impact: 0.7,
          },
          work: {
            title: "Optimizing Spaced Repetition in Higher Education",
            abstract:
              "This study explores interval scheduling algorithms for long-term retention in university students across three academic years.",
            publishedYear: 2024,
            venue: "Journal of Educational Psychology",
            type: "article",
            doi: "10.1000/182",
            arxivId: "2401.12345",
            pmid: "38123456",
            openalexId: "W123456789",
            oaPdfUrl: "https://example.com/paper.pdf",
            oaStatus: "gold",
            citedByCount: 142,
            referencedWorks: [],
            authors: [
              { name: "Dr. Alice Smith", affiliation: "Oxford University" },
              { name: "Bob Jones", affiliation: "MIT" },
            ],
          },
        },
        {
          score: 0.42,
          matched: ["repetition"],
          signals: {
            titleMatch: 0.4,
            abstractMatch: 0.3,
            recency: 0.6,
            impact: 0.5,
          },
          work: {
            title: "Short Note on Cognitive Retrieval",
            abstract: null,
            publishedYear: 2018,
            venue: null,
            type: null,
            doi: null,
            arxivId: null,
            pmid: null,
            openalexId: null,
            oaPdfUrl: null,
            oaStatus: null,
            citedByCount: 5,
            referencedWorks: [],
            authors: [],
          },
        },
      ];

      const md = formatSearchExportMarkdown({
        terms: "spaced repetition memory",
        fromYear: 2015,
        toYear: 2026,
        ranked: mockPapers,
        counts: [
          { provider: "openalex", count: 25 },
          { provider: "arxiv", count: 20 },
        ],
        failures: [{ provider: "europepmc", message: "Gateway Timeout (504)" }],
        generatedAt: fixedDate,
      });

      // Search Overview Header
      expect(md).toContain("# Literature Search Export: spaced repetition memory");
      expect(md).toContain("- **Query Terms:** spaced repetition memory");
      expect(md).toContain("- **Year Filter:** 2015 – 2026");
      expect(md).toContain("- **Total Results:** 2 deduplicated papers");
      expect(md).toContain("- **Database Sources:** openalex (25), arxiv (20)");
      expect(md).toContain(
        "- **Source Warnings:** Some databases did not respond: europepmc (Gateway Timeout (504))",
      );

      // AI Guidance section
      expect(md).toContain("## AI Prompt & Research Guidance");
      expect(md).toContain("Prompt Template for LLM / AI Analysis");
      expect(md).toContain("Screen for Relevance");
      expect(md).toContain("Top Shortlist");

      // Paper 1
      expect(md).toContain("### [Paper 1] Optimizing Spaced Repetition in Higher Education");
      expect(md).toContain(
        "- **Authors:** Dr. Alice Smith (Oxford University), Bob Jones (MIT)",
      );
      expect(md).toContain(
        "- **Publication:** 2024 · Venue: *Journal of Educational Psychology* · Type: article",
      );
      expect(md).toContain("[DOI: 10.1000/182](https://doi.org/10.1000/182)");
      expect(md).toContain("[arXiv: 2401.12345](https://arxiv.org/abs/2401.12345)");
      expect(md).toContain(
        "[PMID: 38123456](https://pubmed.ncbi.nlm.nih.gov/38123456)",
      );
      expect(md).toContain(
        "[OpenAlex: W123456789](https://openalex.org/W123456789)",
      );
      expect(md).toContain("[Open Access PDF](https://example.com/paper.pdf)");
      expect(md).toContain("- **Metrics & Access:** 142 citations · OA: gold");
      expect(md).toContain("- **Relevance:** Score 85.0% · Matched keywords: spaced repetition, memory");
      expect(md).toContain("Signals: Title match 90% · Abstract match 80%");
      expect(md).toContain(
        "This study explores interval scheduling algorithms for long-term retention",
      );

      // Paper 2 (Edge cases with missing fields)
      expect(md).toContain("### [Paper 2] Short Note on Cognitive Retrieval");
      expect(md).toContain("- **Authors:** Unknown authors");
      expect(md).toContain("- **Publication:** 2018 · Venue: *Not specified* · Type: article");
      expect(md).toContain("- **Links & Identifiers:** None reported");
      expect(md).toContain("*No abstract available for this record.*");
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  citationKey,
  extractSurname,
  normalizeArxivId,
  normalizeDoi,
  normalizeOpenAlexId,
  normalizeTitle,
} from "../src/normalize";

/**
 * The title pairs here are duplicated in packages/db/test/05_normalize_parity.sql,
 * which runs the same inputs through upsert_work()'s SQL. If the two ever
 * disagree, that file fails. Keep them in step.
 */
export const TITLE_PAIRS: Array<[string, string]> = [
  ["The Immune Response of Mice", "the immune response of mice"],
  ["  Leading   and trailing  ", "leading and trailing"],
  ["Hyphenated-Words and (Parentheses)", "hyphenatedwords and parentheses"],
  ["CRISPR/Cas9: A Review", "crisprcas9 a review"],
  ["Effects of β-carotene", "effects of carotene"],
  ["Multi\nline\ttitle", "multi line title"],
  ["100% Reproducible?", "100 reproducible"],
];

describe("normalizeTitle", () => {
  it.each(TITLE_PAIRS)("%s -> %s", (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });
});

describe("normalizeDoi", () => {
  const same = "10.1038/s41586-021-03819-2";

  it.each([
    "10.1038/s41586-021-03819-2",
    "https://doi.org/10.1038/s41586-021-03819-2",
    "http://dx.doi.org/10.1038/s41586-021-03819-2",
    "doi:10.1038/s41586-021-03819-2",
    "  10.1038/S41586-021-03819-2  ",
  ])("normalizes %s to the canonical form", (input) => {
    expect(normalizeDoi(input)).toBe(same);
  });

  it.each(["", "not-a-doi", "10.x/abc", "https://example.com/paper", "10.1038"])(
    "rejects %s",
    (input) => {
      expect(normalizeDoi(input)).toBeNull();
    },
  );
});

describe("normalizeArxivId", () => {
  it("drops the version so revisions are one paper, not many", () => {
    expect(normalizeArxivId("2401.01234v3")).toBe("2401.01234");
    expect(normalizeArxivId("2401.01234")).toBe("2401.01234");
    expect(normalizeArxivId("arXiv:2401.01234v1")).toBe("2401.01234");
    expect(normalizeArxivId("https://arxiv.org/abs/2401.01234v2")).toBe("2401.01234");
  });

  it("handles legacy identifiers", () => {
    expect(normalizeArxivId("math.GT/0309136")).toBe("math.gt/0309136");
    expect(normalizeArxivId("hep-th/9901001v2")).toBe("hep-th/9901001");
  });

  it("rejects nonsense", () => {
    expect(normalizeArxivId("")).toBeNull();
    expect(normalizeArxivId("12345")).toBeNull();
  });
});

describe("normalizeOpenAlexId", () => {
  it("accepts both bare and URL forms", () => {
    expect(normalizeOpenAlexId("https://openalex.org/W2741809807")).toBe("W2741809807");
    expect(normalizeOpenAlexId("W2741809807")).toBe("W2741809807");
  });

  it("rejects other identifier types", () => {
    expect(normalizeOpenAlexId("A2741809807")).toBeNull();
  });
});

describe("extractSurname", () => {
  it("takes the last word when there is no comma", () => {
    expect(extractSurname("Jane Q. Smith")).toBe("smith");
  });

  it("takes the first part when there is one", () => {
    // Both orders occur in the wild, and the comma is the only reliable
    // signal of which half is the surname.
    expect(extractSurname("Smith, Jane")).toBe("smith");
  });

  it("strips diacritics so one author does not become two", () => {
    expect(extractSurname("Müller")).toBe("muller");
    expect(extractSurname("Müller")).toBe(extractSurname("Muller"));
    expect(extractSurname("José Ángel Ibáñez")).toBe("ibanez");
  });

  it("survives an empty name", () => {
    expect(extractSurname(undefined)).toBe("");
    expect(extractSurname("  ")).toBe("");
  });
});

describe("citationKey", () => {
  it("builds surname_year_word", () => {
    expect(citationKey("Jane Smith", 2021, "The Immune Response of Mice")).toBe(
      "smith_2021_immune",
    );
  });

  it("skips stopwords when choosing the title word", () => {
    expect(citationKey("Lee", 2020, "On the Use of Transformers")).toBe("lee_2020_use");
  });

  it("degrades rather than throwing on missing data", () => {
    expect(citationKey(undefined, null, "Untitled")).toBe("anon_nd_untitled");
  });
});

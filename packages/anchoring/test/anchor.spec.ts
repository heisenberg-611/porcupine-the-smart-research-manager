import { describe, expect, it } from "vitest";

import {
  boundedLevenshtein,
  createSelector,
  DRIFT_THRESHOLD,
  normalize,
  resolveAnchor,
  similarity,
  type AnchorSelector,
} from "../src/anchor";

/**
 * The cases here are the ways documents actually change, not tidy synthetic
 * edits: a PDF re-extracted by a different pdf.js version, a preprint
 * updated to its published version, a phrase that occurs six times.
 *
 * Note what the negative tests assert. "It did not return OK" is not enough —
 * BROKEN and DRIFTED are different answers with different consequences, so
 * each test names which one it expects.
 */

const PAGE =
  "Introduction. Recent work has shown that transformer models scale " +
  "predictably with compute. The results were significant across all three " +
  "benchmarks. However, the effect was smaller in low-resource settings. " +
  "We therefore conclude that scaling alone is insufficient. The results " +
  "were significant only for the largest models.";

describe("createSelector", () => {
  it("captures the quote with surrounding context", () => {
    const start = PAGE.indexOf("transformer models");
    const selector = createSelector(PAGE, start, start + "transformer models".length, 1);

    expect(selector.quote).toBe("transformer models");
    expect(selector.prefix).toMatch(/shown that $/);
    expect(selector.suffix).toMatch(/^ scale/);
    expect(selector.page).toBe(1);
  });

  it("clamps context at the document edges", () => {
    const selector = createSelector(PAGE, 0, 12);
    expect(selector.prefix).toBe("");
    expect(selector.quote).toBe("Introduction");
  });

  it("refuses an inverted or out-of-range selection", () => {
    expect(() => createSelector(PAGE, 10, 5)).toThrow(RangeError);
    expect(() => createSelector(PAGE, 0, PAGE.length + 1)).toThrow(RangeError);
  });
});

describe("resolveAnchor — unchanged document", () => {
  it("uses the recorded offsets when they still hold", () => {
    const start = PAGE.indexOf("scale predictably");
    const selector = createSelector(PAGE, start, start + "scale predictably".length);

    const result = resolveAnchor(selector, PAGE);
    expect(result.status).toBe("OK");
    if (result.status === "OK") {
      expect(result.start).toBe(start);
      expect(result.text).toBe("scale predictably");
    }
  });
});

describe("resolveAnchor — offsets stale, text intact", () => {
  it("relocates a unique quote after text is inserted before it", () => {
    const start = PAGE.indexOf("low-resource settings");
    const selector = createSelector(PAGE, start, start + "low-resource settings".length);

    // A paragraph was added at the top, so every offset shifted.
    const edited = "An entirely new opening paragraph was added here. " + PAGE;

    const result = resolveAnchor(selector, edited);
    expect(result.status).toBe("OK");
    if (result.status === "OK") {
      expect(result.text).toBe("low-resource settings");
      expect(edited.slice(result.start, result.end)).toBe("low-resource settings");
    }
  });
});

describe("resolveAnchor — the repeated phrase", () => {
  // "The results were significant" appears twice in PAGE. This is the case
  // a quote-only selector cannot solve, and the reason prefix and suffix are
  // captured at selection time.
  const first = PAGE.indexOf("The results were significant");
  const second = PAGE.indexOf("The results were significant", first + 1);

  it("picks the occurrence whose context matches", () => {
    const selector = createSelector(
      PAGE,
      second,
      second + "The results were significant".length,
    );
    // Wipe the offsets: only context can decide now.
    const contextOnly: AnchorSelector = {
      ...selector,
      startOff: undefined,
      endOff: undefined,
    };

    const result = resolveAnchor(contextOnly, PAGE);
    expect(result.status).toBe("OK");
    if (result.status === "OK") expect(result.start).toBe(second);
  });

  it("picks the first occurrence when its context matches instead", () => {
    const selector = createSelector(
      PAGE,
      first,
      first + "The results were significant".length,
    );
    const contextOnly: AnchorSelector = {
      ...selector,
      startOff: undefined,
      endOff: undefined,
    };

    const result = resolveAnchor(contextOnly, PAGE);
    expect(result.status).toBe("OK");
    if (result.status === "OK") expect(result.start).toBe(first);
  });

  it("confirms the two occurrences are genuinely distinct positions", () => {
    // Guards the test above from passing vacuously if the phrase appeared once.
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
  });
});

describe("resolveAnchor — re-extraction noise", () => {
  it("matches through changed whitespace", () => {
    const start = PAGE.indexOf("scale predictably with compute");
    const selector = createSelector(
      PAGE,
      start,
      start + "scale predictably with compute".length,
    );

    // A different pdf.js version wraps lines differently.
    const reflowed = PAGE.replace(
      "scale predictably with compute",
      "scale  predictably\nwith   compute",
    );

    const result = resolveAnchor(selector, reflowed);
    expect(result.status).toBe("OK");
  });

  it("matches through ligatures and typographic quotes", () => {
    const source = 'The "efficient" classification of fine detail.';
    const start = source.indexOf('"efficient" classification of fine');
    const selector = createSelector(
      source,
      start,
      start + '"efficient" classification of fine'.length,
    );

    // Same page, extracted with ligatures and curly quotes.
    const reExtracted = "The “efficient” classiﬁcation of ﬁne detail.";

    const result = resolveAnchor(selector, reExtracted);
    // Not BROKEN: a reader would call these the same words.
    expect(result.status).not.toBe("BROKEN");
  });

  it("matches through a soft hyphen", () => {
    const source = "We measured the classification accuracy of the model.";
    const start = source.indexOf("classification accuracy");
    const selector = createSelector(
      source,
      start,
      start + "classification accuracy".length,
    );

    const hyphenated = source.replace("classification", "classi­fication");
    expect(resolveAnchor(selector, hyphenated).status).not.toBe("BROKEN");
  });
});

describe("resolveAnchor — real edits", () => {
  it("reports DRIFTED, not OK, when a word changed", () => {
    const start = PAGE.indexOf("the effect was smaller in low-resource settings");
    const quote = "the effect was smaller in low-resource settings";
    const selector = createSelector(PAGE, start, start + quote.length);

    // The published version revised the claim.
    const revised = PAGE.replace(
      quote,
      "the effect was negligible in low-resource settings",
    );

    const result = resolveAnchor(selector, revised);
    expect(result.status).toBe("DRIFTED");
    if (result.status === "DRIFTED") {
      expect(result.similarity).toBeGreaterThanOrEqual(DRIFT_THRESHOLD);
      expect(result.similarity).toBeLessThan(1);
      // The message has to be actionable, not "status: 1".
      expect(result.reason).toMatch(/changed/i);
    }
  });

  it("reports BROKEN when the passage was deleted", () => {
    const quote = "We therefore conclude that scaling alone is insufficient.";
    const start = PAGE.indexOf(quote);
    const selector = createSelector(PAGE, start, start + quote.length);

    const cut = PAGE.replace(quote, "");
    const result = resolveAnchor(selector, cut);
    expect(result.status).toBe("BROKEN");
  });

  it("reports BROKEN rather than pointing at a coincidence", () => {
    const selector: AnchorSelector = {
      quote: "a passage about mitochondrial DNA sequencing in beetles",
      prefix: "",
      suffix: "",
    };

    const result = resolveAnchor(selector, PAGE);
    expect(result.status).toBe("BROKEN");
  });

  it("refuses to relocate a very short quote", () => {
    // "the" would fuzzy-match dozens of places. Guessing is worse than
    // admitting the anchor cannot be recovered.
    const selector: AnchorSelector = { quote: "xyz", prefix: "", suffix: "" };
    const result = resolveAnchor(selector, PAGE);
    expect(result.status).toBe("BROKEN");
    if (result.status === "BROKEN")
      expect(result.reason).toMatch(/short|no similar|words/i);
  });
});

describe("resolveAnchor — degenerate input", () => {
  it("is BROKEN for an empty quote", () => {
    expect(resolveAnchor({ quote: "" }, PAGE).status).toBe("BROKEN");
  });

  it("is BROKEN for an empty document", () => {
    expect(resolveAnchor({ quote: "anything at all" }, "").status).toBe("BROKEN");
  });

  it("survives offsets that point past the end of the text", () => {
    const selector: AnchorSelector = {
      quote: "transformer models",
      startOff: 99_999,
      endOff: 100_017,
    };
    // Must fall through to a quote search rather than throwing.
    const result = resolveAnchor(selector, PAGE);
    expect(result.status).toBe("OK");
  });
});

describe("normalize", () => {
  it("folds ligatures, quotes, dashes and spaces", () => {
    expect(normalize("classiﬁcation")).toBe("classification");
    expect(normalize("“quoted”")).toBe('"quoted"');
    expect(normalize("a—b")).toBe("a-b");
    expect(normalize("a  b")).toBe("a b");
  });

  it("is idempotent", () => {
    const once = normalize("The  “Fiﬁ”  test—here");
    expect(normalize(once)).toBe(once);
  });
});

describe("boundedLevenshtein", () => {
  it("computes small distances exactly", () => {
    expect(boundedLevenshtein("kitten", "sitting", 10)).toBe(3);
    expect(boundedLevenshtein("same", "same", 5)).toBe(0);
  });

  it("gives up past the cap instead of doing the full computation", () => {
    // Correctness of the early exit: the answer is > max, and it says so.
    expect(boundedLevenshtein("abcdefghij", "zzzzzzzzzz", 3)).toBeGreaterThan(3);
  });

  it("returns quickly for wildly different lengths", () => {
    expect(boundedLevenshtein("a", "a".repeat(5000), 5)).toBeGreaterThan(5);
  });
});

describe("similarity", () => {
  it("is 1 for identical text and 0 for empty", () => {
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("", "abc")).toBe(0);
  });

  it("ranks a near match above an unrelated one", () => {
    const near = similarity(
      "the results were significant",
      "the results are significant",
    );
    const far = similarity(
      "the results were significant",
      "mitochondrial dna sequencing",
    );
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(DRIFT_THRESHOLD);
  });
});

describe("performance", () => {
  it("resolves against a long page without hanging", () => {
    // A 50,000-character page is an ordinary thesis chapter. An uncapped
    // Levenshtein over every offset would take minutes here.
    const filler = "Lorem ipsum dolor sit amet consectetur adipiscing elit. ".repeat(900);
    const needle = "the distinctive marker phrase appears exactly once";
    const long = `${filler}${needle}${filler}`;

    const start = long.indexOf(needle);
    const selector = createSelector(long, start, start + needle.length);

    const began = Date.now();
    const result = resolveAnchor(
      selector,
      long.replace(needle, needle.replace("once", "twice")),
    );
    const elapsed = Date.now() - began;

    expect(result.status).toBe("DRIFTED");
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("round-trip invariant", () => {
  /**
   * Hand-picked cases test what I thought of. This tests the property:
   * for ANY selection in an unchanged document, capturing a selector and
   * resolving it must return exactly that range.
   *
   * Deterministic seed, so a failure is reproducible rather than a rumour.
   */
  function seeded(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
  }

  it("recovers every selection exactly, over 500 random spans", () => {
    const doc =
      "Methods. Participants were recruited from three sites. The primary outcome " +
      "was measured at baseline and at twelve weeks. Secondary outcomes included " +
      "quality of life and adverse events. Analysis followed intention to treat. " +
      "The results were significant for the primary outcome but not for the " +
      "secondary ones. Limitations include the short follow-up and the single " +
      "geographic region. The results were significant in the subgroup analysis.";

    const random = seeded(42);
    let checked = 0;

    for (let i = 0; i < 500; i++) {
      const start = Math.floor(random() * (doc.length - 40));
      const length = 12 + Math.floor(random() * 60);
      const end = Math.min(doc.length, start + length);
      if (end - start < 8) continue;

      const selector = createSelector(doc, start, end);
      const result = resolveAnchor(selector, doc);

      expect(
        result.status,
        `span [${start}, ${end}) = ${JSON.stringify(doc.slice(start, end))}`,
      ).toBe("OK");
      if (result.status === "OK") {
        expect(doc.slice(result.start, result.end)).toBe(doc.slice(start, end));
      }
      checked++;
    }

    // Guard against the loop skipping everything and passing vacuously.
    expect(checked).toBeGreaterThan(400);
  });

  it("still recovers selections after the document is re-extracted", () => {
    const doc =
      "The classification accuracy improved substantially. We observed a clear " +
      "effect in the treatment group compared with controls over twelve weeks.";

    // Simulates a different pdf.js version: ligatures, curly quotes, reflow.
    const reExtracted = doc
      .replace(/fi/g, "ﬁ")
      .replace("substantially.", "substantially.\n  ")
      .replace("clear effect", "clear  effect");

    const random = seeded(7);
    let recovered = 0;
    let attempted = 0;

    for (let i = 0; i < 100; i++) {
      const start = Math.floor(random() * (doc.length - 40));
      const end = Math.min(doc.length, start + 20 + Math.floor(random() * 30));
      if (end - start < 12) continue;

      attempted++;
      const result = resolveAnchor(createSelector(doc, start, end), reExtracted);
      // Never silently wrong: OK or DRIFTED are both acceptable answers here,
      // BROKEN would mean a dependency bump lost the annotation.
      if (result.status !== "BROKEN") recovered++;
    }

    expect(attempted).toBeGreaterThan(50);
    // Re-extraction must not destroy annotations wholesale.
    expect(recovered / attempted).toBeGreaterThan(0.95);
  });
});

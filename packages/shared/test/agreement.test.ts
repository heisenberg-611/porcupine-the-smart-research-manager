import { describe, expect, it } from "vitest";

import { cohensKappa, kappaLabel, supportsKappa, valuesAgree } from "../src/agreement";

describe("valuesAgree", () => {
  it("compares numbers numerically, not as strings", () => {
    // The bug this prevents: sending a verifier to adjudicate 12 vs 12.0.
    expect(valuesAgree("NUMBER", 12, 12.0)).toBe(true);
    expect(valuesAgree("NUMBER", 12, "12")).toBe(true);
    expect(valuesAgree("NUMBER", "12.00", 12)).toBe(true);
    expect(valuesAgree("NUMBER", 12, 13)).toBe(false);
  });

  it("falls back to text when a NUMBER field holds prose", () => {
    // Real extractions contain 'not reported'. Two of them agree.
    expect(valuesAgree("NUMBER", "not reported", "Not Reported")).toBe(true);
    expect(valuesAgree("NUMBER", "not reported", "unclear")).toBe(false);
  });

  it("ignores case and surrounding space", () => {
    expect(valuesAgree("ENUM", "RCT", "rct ")).toBe(true);
    expect(valuesAgree("TEXT", " Mortality ", "mortality")).toBe(true);
  });

  it("treats MULTI_ENUM as a set, because order is a UI artefact", () => {
    expect(valuesAgree("MULTI_ENUM", ["a", "b"], ["b", "a"])).toBe(true);
    expect(valuesAgree("MULTI_ENUM", ["a", "b"], ["a"])).toBe(false);
    expect(valuesAgree("MULTI_ENUM", ["a"], ["a", "b"])).toBe(false);
  });

  it("understands the ways a boolean gets written down", () => {
    expect(valuesAgree("BOOLEAN", true, "true")).toBe(true);
    expect(valuesAgree("BOOLEAN", "yes", true)).toBe(true);
    expect(valuesAgree("BOOLEAN", "no", false)).toBe(true);
    expect(valuesAgree("BOOLEAN", true, false)).toBe(false);
  });

  it("does not count two holes as an agreement", () => {
    // Otherwise every score on a half-finished review is inflated by the
    // fields nobody has reached yet.
    expect(valuesAgree("TEXT", null, null)).toBe(false);
    expect(valuesAgree("TEXT", undefined, undefined)).toBe(false);
    expect(valuesAgree("TEXT", null, "something")).toBe(false);
  });
});

describe("supportsKappa", () => {
  it("covers the categorical types and nothing else", () => {
    expect(supportsKappa("ENUM")).toBe(true);
    expect(supportsKappa("BOOLEAN")).toBe(true);
    // Free text: κ over near-unique values measures the values, not the raters.
    expect(supportsKappa("TEXT")).toBe(false);
    expect(supportsKappa("NUMBER")).toBe(false);
    expect(supportsKappa("QUOTE")).toBe(false);
    // Categorical but set-valued; Cohen's κ is not defined for multi-label.
    expect(supportsKappa("MULTI_ENUM")).toBe(false);
  });
});

describe("cohensKappa", () => {
  it("is 1 for perfect agreement across more than one category", () => {
    const result = cohensKappa([
      { a: "yes", b: "yes" },
      { a: "no", b: "no" },
      { a: "yes", b: "yes" },
      { a: "no", b: "no" },
    ]);
    expect(result.kappa).toBeCloseTo(1, 10);
    expect(result.observedAgreement).toBe(1);
  });

  it("is UNDEFINED, not 1, when both raters used a single category", () => {
    /*
     * The trap this whole module is shaped around. Ten papers, both extractors
     * said "RCT" every time. Observed agreement is 100%. Chance agreement is
     * also 100%, because with one category chance cannot do anything else.
     *
     * Returning 1.0 here would put "κ = 1.00 (almost perfect)" in a methods
     * section on the strength of data that demonstrates nothing about the
     * raters at all.
     */
    const result = cohensKappa(
      Array.from({ length: 10 }, () => ({ a: "RCT", b: "RCT" })),
    );

    expect(result.kappa).toBeNull();
    expect(result.observedAgreement).toBe(1);
    expect(result.undefinedReason).toMatch(/single category/i);
  });

  it("survives the floating-point form of that case", () => {
    // pe computes to 0.9999999999999998 rather than exactly 1, so an
    // `=== 0` guard sails past and returns a κ of roughly -4000.
    const result = cohensKappa(
      Array.from({ length: 3 }, () => ({ a: "only", b: "only" })),
    );
    expect(result.kappa).toBeNull();
  });

  it("is 0 when agreement is exactly what chance predicts", () => {
    // Each rater splits 50/50 and they agree on half — pe = 0.5, po = 0.5.
    const result = cohensKappa([
      { a: "yes", b: "yes" },
      { a: "yes", b: "no" },
      { a: "no", b: "yes" },
      { a: "no", b: "no" },
    ]);
    expect(result.expectedAgreement).toBeCloseTo(0.5, 10);
    expect(result.observedAgreement).toBeCloseTo(0.5, 10);
    expect(result.kappa).toBeCloseTo(0, 10);
  });

  it("goes negative when agreement is worse than chance", () => {
    const result = cohensKappa([
      { a: "yes", b: "no" },
      { a: "no", b: "yes" },
      { a: "yes", b: "no" },
      { a: "no", b: "yes" },
    ]);
    expect(result.kappa).toBeLessThan(0);
  });

  it("shows the paradox: 90% agreement, unimpressive κ", () => {
    /*
     * Nineteen "include" and one disagreement. Observed agreement is 90%,
     * which sounds excellent, and κ is poor — because a rater who said
     * "include" every time without reading would have scored about the same.
     * This is exactly why the raw percentage is reported alongside κ rather
     * than instead of it.
     */
    const pairs = [
      ...Array.from({ length: 18 }, () => ({ a: "include", b: "include" })),
      { a: "include", b: "exclude" },
      { a: "exclude", b: "include" },
    ];
    const result = cohensKappa(pairs);

    expect(result.observedAgreement).toBeCloseTo(0.9, 10);
    expect(result.kappa).not.toBeNull();
    expect(result.kappa!).toBeLessThan(0.2);
  });

  it("is undefined with nothing to compare", () => {
    const result = cohensKappa([]);
    expect(result.kappa).toBeNull();
    expect(result.n).toBe(0);
    expect(result.undefinedReason).toMatch(/extracted twice/i);
  });

  it("handles a category only one rater ever used", () => {
    const result = cohensKappa([
      { a: "yes", b: "yes" },
      { a: "maybe", b: "no" },
      { a: "no", b: "no" },
    ]);
    expect(result.kappa).not.toBeNull();
    expect(Number.isFinite(result.kappa!)).toBe(true);
  });
});

describe("kappaLabel", () => {
  it("labels the bands, including below zero", () => {
    expect(kappaLabel(-0.2)).toBe("worse than chance");
    expect(kappaLabel(0.1)).toBe("slight");
    expect(kappaLabel(0.35)).toBe("fair");
    expect(kappaLabel(0.5)).toBe("moderate");
    expect(kappaLabel(0.75)).toBe("substantial");
    expect(kappaLabel(0.95)).toBe("almost perfect");
  });
});

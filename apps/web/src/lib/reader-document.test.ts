import { createSelector } from "@Porcupine/anchoring";
import { describe, expect, it } from "vitest";

import { resolveInSections, type ReaderSection } from "./reader-document";

const ABSTRACT =
  "Sleep restriction impaired vigilance in every cohort we examined, with effects visible by day three.";
const PAGE_ONE = `Introduction. ${ABSTRACT} We report the design below.`;
const PAGE_TWO =
  "Effect sizes were smaller in the older cohort but consistently negative.";

const pages: ReaderSection[] = [
  { page: 1, text: PAGE_ONE },
  { page: 2, text: PAGE_TWO },
];

describe("placing an anchor in a paginated document", () => {
  it("uses the page the anchor recorded", () => {
    const start = PAGE_TWO.indexOf("smaller");
    const selector = createSelector(PAGE_TWO, start, start + 7, 2);

    const placed = resolveInSections(selector, pages);
    expect(placed.sectionIndex).toBe(1);
    expect(placed.resolution.status).toBe("OK");
  });

  it("finds a passage whose recorded page is wrong", () => {
    // The offsets and page say page 2; the words are on page 1. A stored
    // anchor can be stale in either field, and the quote is the durable part.
    const start = PAGE_ONE.indexOf("vigilance");
    const selector = { ...createSelector(PAGE_ONE, start, start + 9, 1), page: 2 };

    const placed = resolveInSections(selector, pages);
    expect(placed.sectionIndex).toBe(0);
    expect(placed.resolution.status).toBe("OK");
  });

  /*
   * The migration case, and the reason pass 2 exists.
   *
   * Every annotation made before this stage was captured against the abstract
   * and carries no page. If attaching a PDF turned those into "lost in this
   * document", uploading a file would appear to destroy a colleague's reading
   * — so an anchor with no page has to be looked for everywhere.
   */
  it("places a pageless anchor from the abstract into the full text", () => {
    const start = ABSTRACT.indexOf("impaired vigilance");
    const selector = createSelector(ABSTRACT, start, start + 18);
    expect(selector.page).toBeUndefined();

    const placed = resolveInSections(selector, pages);
    expect(placed.sectionIndex).toBe(0);
    expect(placed.resolution.status).toBe("OK");
  });

  it("prefers an exact match anywhere over a drifted one earlier", () => {
    const withDecoy: ReaderSection[] = [
      { page: 1, text: "Sleep restriction impaired vigilence in some cohorts." },
      { page: 2, text: "Sleep restriction impaired vigilance in every cohort." },
    ];
    const selector = createSelector(withDecoy[1]!.text, 0, 41);

    const placed = resolveInSections(selector, withDecoy);
    // Page 1 is a near-miss ("vigilence"); page 2 is the real thing.
    expect(placed.sectionIndex).toBe(1);
    expect(placed.resolution.status).toBe("OK");
  });

  it("reports BROKEN rather than guessing when the passage is gone", () => {
    const selector = createSelector("a passage from another paper entirely", 2, 9);

    const placed = resolveInSections(selector, pages);
    expect(placed.sectionIndex).toBeNull();
    expect(placed.resolution.status).toBe("BROKEN");
  });

  it("survives a document with no sections at all", () => {
    const selector = createSelector(ABSTRACT, 0, 5);
    const placed = resolveInSections(selector, []);
    expect(placed.resolution.status).toBe("BROKEN");
  });
});

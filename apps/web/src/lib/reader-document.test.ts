import { createSelector } from "@Porcupine/anchoring";
import { describe, expect, it } from "vitest";

import {
  describeReading,
  resolveInSections,
  type ReaderSection,
} from "./reader-document";

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

describe("what the reader says about a paper", () => {
  const base = { hasFile: false, textStatus: null, pageCount: 0, hasAbstract: false };

  it("names the page count when the full text is available", () => {
    const notice = describeReading({
      ...base,
      hasFile: true,
      textStatus: "EXTRACTED",
      pageCount: 12,
    });
    expect(notice.body).toContain("12 pages");
    expect(notice.tone).toBe("info");
  });

  it("says 'page' rather than 'pages' for a one-page paper", () => {
    const notice = describeReading({
      ...base,
      hasFile: true,
      textStatus: "EXTRACTED",
      pageCount: 1,
    });
    expect(notice.body).toContain("1 page from");
  });

  /*
   * The contradiction this function exists to make unwriteable.
   *
   * Three independent messages used to fire here: one promising the abstract
   * was shown below, one claiming no PDF was attached, and no mention of the
   * PDF that plainly was. Every assertion below is about a sentence NOT being
   * said.
   */
  it("does not promise an abstract that does not exist", () => {
    const notice = describeReading({ ...base, hasFile: true, textStatus: "FAILED" });
    expect(notice.tone).toBe("danger");
    expect(notice.body).not.toMatch(/abstract below/);
    expect(notice.body).toContain("no abstract either");
  });

  it("does not claim a PDF is missing when one is attached", () => {
    for (const textStatus of ["FAILED", "PENDING", "NOT_APPLICABLE"]) {
      const notice = describeReading({ ...base, hasFile: true, textStatus });
      expect(notice.body, textStatus).not.toMatch(/no attached PDF|no PDF attached/);
    }
  });

  it("offers the abstract when there is one to offer", () => {
    const notice = describeReading({
      ...base,
      hasFile: true,
      textStatus: "FAILED",
      hasAbstract: true,
    });
    expect(notice.body).toContain("abstract below");
  });

  /*
   * The case that previously produced no message at all: the upload finished
   * and the extraction never ran. Nothing revisits it, so silence meant a
   * paper that would never be readable and never say why.
   */
  it("explains an upload whose text was never extracted, and how to fix it", () => {
    const notice = describeReading({ ...base, hasFile: true, textStatus: "PENDING" });
    expect(notice.headline).toMatch(/never extracted/i);
    expect(notice.body).toMatch(/attach it again/i);
  });

  it("falls back to the abstract when no file is attached", () => {
    const notice = describeReading({ ...base, hasAbstract: true });
    expect(notice.body).toMatch(/reading the abstract/i);
  });

  it("says plainly when there is nothing at all", () => {
    const notice = describeReading(base);
    expect(notice.headline).toMatch(/nothing to read/i);
    expect(notice.body).toMatch(/no abstract and no attached PDF/i);
  });
});

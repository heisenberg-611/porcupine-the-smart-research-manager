import { describe, expect, it } from "vitest";

import { joinPageText } from "./page-text";

/*
 * The DOM walkers in this module are deliberately NOT tested here.
 *
 * They exist because browsers treat `<br>` in a way that is easy to assume
 * wrongly, and a fake DOM would let me encode the same wrong assumption in the
 * test. They are tested in apps/web/e2e against a real text layer rendered
 * from a real PDF, which is the only place the claim can actually be checked.
 */
describe("the page text join rule", () => {
  it("keeps runs adjacent, because a run break is not a word break", () => {
    // pdf.js splits wherever the text matrix moves, which is mid-word as often
    // as not. Joining on " " is how "efficiency" becomes "ef ficiency".
    expect(joinPageText([{ str: "ef" }, { str: "ficiency" }])).toBe("efficiency");
  });

  it("ends a line where the PDF says the line ended", () => {
    expect(
      joinPageText([{ str: "first line", hasEOL: true }, { str: "second line" }]),
    ).toBe("first line\nsecond line");
  });

  it("treats a missing hasEOL as no break", () => {
    expect(joinPageText([{ str: "a" }, { str: "b", hasEOL: false }])).toBe("ab");
  });

  it("is empty for an empty page rather than undefined", () => {
    expect(joinPageText([])).toBe("");
  });

  /*
   * The property the viewer depends on: every character of every run appears
   * exactly once, so an offset into this string addresses a real glyph run.
   */
  it("contains each run's text exactly once, in order", () => {
    const runs = [
      { str: "Sleep restriction ", hasEOL: false },
      { str: "impaired vigilance", hasEOL: true },
      { str: "in every cohort", hasEOL: true },
    ];
    const text = joinPageText(runs);
    let cursor = 0;
    for (const run of runs) {
      const at = text.indexOf(run.str, cursor);
      expect(at, run.str).toBeGreaterThanOrEqual(cursor);
      cursor = at + run.str.length;
    }
    expect(text.replace(/\n/g, "").length).toBe(
      runs.reduce((n, r) => n + r.str.length, 0),
    );
  });
});

describe("structure markers, which carry no text", () => {
  /*
   * `getTextContent()` does not return only text. A TAGGED PDF — which most
   * publisher PDFs are — also yields beginMarkedContent/endMarkedContent
   * entries, and those have no `str` at all.
   *
   * `text += item.str` on one of those appends the literal string "undefined":
   * nine characters of garbage in the middle of the paper, shifting every
   * offset after it and landing inside any quote that spans it. It corrupts
   * only tagged documents, so a simple hand-built fixture never sees it.
   */
  it("skips a marked-content marker instead of stringifying it", () => {
    const text = joinPageText([
      { str: "Sleep restriction " },
      { type: "beginMarkedContent", id: "p0" } as never,
      { str: "impaired vigilance", hasEOL: true },
      { type: "endMarkedContent" } as never,
      { str: "in every cohort" },
    ]);

    expect(text).not.toContain("undefined");
    expect(text).toBe("Sleep restriction impaired vigilance\nin every cohort");
  });

  it("survives a page that is nothing but markers", () => {
    expect(joinPageText([{ type: "beginMarkedContent" } as never])).toBe("");
  });
});

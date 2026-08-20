import { describe, expect, it } from "vitest";

import { tidyRects, type FlatRect } from "./highlight-rects";

const rect = (left: number, top: number, right: number, bottom: number): FlatRect => ({
  left,
  top,
  right,
  bottom,
});

describe("rectangles a highlight is painted from", () => {
  it("keeps one rectangle per line", () => {
    const lines = [rect(10, 0, 200, 16), rect(10, 16, 140, 32)];
    expect(tidyRects(lines)).toHaveLength(2);
  });

  /*
   * The double tone. Two translucent layers over the same glyphs are visibly
   * darker than one, and this is where they come from: a run split across
   * text nodes yields a rectangle for each, plus one for the whole.
   */
  it("drops a rectangle already covered by another", () => {
    const whole = rect(10, 0, 200, 16);
    const half = rect(10, 0, 100, 16);
    expect(tidyRects([whole, half])).toEqual([whole]);
  });

  it("drops it whichever order it arrives in", () => {
    const whole = rect(10, 0, 200, 16);
    const half = rect(60, 0, 120, 16);
    expect(tidyRects([half, whole])).toEqual([whole]);
  });

  it("removes exact duplicates", () => {
    const line = rect(10, 0, 200, 16);
    expect(tidyRects([line, line, line])).toEqual([line]);
  });

  it("treats sub-pixel differences as the same rectangle", () => {
    // The seam between two line boxes, which is what makes the overlap
    // invisible in the DOM and visible on the page.
    expect(tidyRects([rect(10, 0, 200, 16), rect(10.2, 0.1, 199.8, 15.9)])).toHaveLength(
      1,
    );
  });

  it("discards slivers with no area", () => {
    expect(tidyRects([rect(10, 5, 10, 5), rect(10, 5, 200, 5)])).toEqual([]);
  });

  it("keeps genuinely separate rectangles that merely touch", () => {
    // Two lines sharing an edge are two lines, not one drawn twice.
    expect(tidyRects([rect(0, 0, 100, 16), rect(0, 16, 100, 32)])).toHaveLength(2);
  });

  it("survives an empty range", () => {
    expect(tidyRects([])).toEqual([]);
  });
});

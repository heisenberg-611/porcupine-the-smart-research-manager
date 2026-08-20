/**
 * Rectangles a highlight can be painted from without doubling its own colour.
 *
 * `Range.getClientRects()` promises to COVER a range, not to do it once.
 * Adjacent line boxes overlap by a fraction of a pixel; a run split across
 * several text nodes returns one rectangle per node for the same glyphs; and a
 * range crossing an element boundary can return a box for the parent as well
 * as for each child. Painted straight, each of those becomes its own
 * translucent layer and the overlaps come out darker than the rest of the
 * mark — the "double tone" a reader sees, worst on the multi-line passages
 * where there are most rectangles to collide.
 *
 * Lives here rather than in the viewer because it is arithmetic, and
 * arithmetic that is only reachable through a rendered PDF is arithmetic
 * nobody can test: with one text run per line the raw rectangles do not
 * overlap at all, so a browser test of this passes whether the function runs
 * or not. That was checked, not assumed — removing the call left the e2e
 * assertion green.
 */
export interface FlatRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function tidyRects(rects: readonly FlatRect[]): FlatRect[] {
  const rounded = rects
    .map((rect) => ({
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
    }))
    // Sub-pixel slivers are the seams between line boxes, not content.
    .filter((rect) => rect.right - rect.left > 0 && rect.bottom - rect.top > 0);

  const kept: FlatRect[] = [];

  for (const rect of rounded) {
    if (kept.some((other) => contains(other, rect))) continue;

    // Drop anything this one now swallows, so the input order does not decide
    // which of a nested pair survives.
    for (let i = kept.length - 1; i >= 0; i--) {
      if (contains(rect, kept[i]!)) kept.splice(i, 1);
    }
    kept.push(rect);
  }

  return kept;
}

function contains(outer: FlatRect, inner: FlatRect): boolean {
  return (
    inner.left >= outer.left &&
    inner.top >= outer.top &&
    inner.right <= outer.right &&
    inner.bottom <= outer.bottom
  );
}

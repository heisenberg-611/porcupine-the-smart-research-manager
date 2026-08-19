/**
 * One definition of how a PDF page's text runs become a string.
 *
 * There are two producers of that string and they must agree exactly:
 *
 *   1. the extractor, which writes `file_pages` at upload time, and whose
 *      output every stored anchor's offsets are measured against;
 *   2. the viewer, which converts a selection inside pdf.js's rendered text
 *      layer into an offset.
 *
 * If they disagree, nothing breaks loudly. `resolveAnchor` misses its fast
 * path, falls through to matching by quote, and usually still finds the
 * passage — so the symptom is not an error but a slow loss of precision, and
 * ambiguity wherever a page repeats a phrase.
 *
 * They would disagree today. pdf.js's `TextLayer` appends
 * `<br role="presentation">` for every line break, and a `<br>` contributes
 * NOTHING to the APIs a selection is measured with. Measured in Chromium:
 *
 *     <span>first line</span><br><span>second line</span>
 *
 *     textContent       → "first linesecond line"
 *     Range.toString()  → "first linesecond line"
 *     innerText         → "first line\nsecond line"
 *
 * while the extractor writes "\n" at each break. That is a one-character drift
 * per line, accumulating down the page.
 *
 * `innerText` is not the fix: it is layout-dependent, changes with CSS, and
 * forces a reflow to read. The fix is that the rule lives here and both sides
 * call it.
 */

/** The minimum of a pdf.js text item this module needs. Not imported from
 * pdfjs-dist, so nothing that only joins strings pulls in a megabyte. */
export interface TextRun {
  str: string;
  hasEOL?: boolean | undefined;
}

/**
 * The page string, as stored and as anchored against.
 *
 * A run contributes its text, and a run that ends a line contributes a
 * newline after it — which is what makes the stored text readable as a
 * fallback and what the walker below mirrors.
 */
export function joinPageText(items: readonly TextRun[]): string {
  let text = "";
  for (const item of items) {
    text += item.str;
    if (item.hasEOL) text += "\n";
  }
  return text;
}

/**
 * Where a point inside a rendered text layer falls in the page string.
 *
 * The mirror image of `joinPageText`, walking the DOM pdf.js produced: each
 * direct child of the layer is either a text run (contributing its text) or a
 * `<br>` (contributing the newline the run's `hasEOL` put in the string).
 *
 * Returns null when the node is not inside this layer, which the caller must
 * treat as "no selection here" rather than as offset zero — a selection that
 * began outside the page is not a selection on this page.
 */
export function offsetInPageText(
  layer: HTMLElement,
  node: Node,
  offset: number,
): number | null {
  let total = 0;

  for (const child of Array.from(layer.childNodes)) {
    if (isLineBreak(child)) {
      // A <br> cannot contain the selection point, so it is always passed
      // over — but it is worth one character, because the string has one.
      total += 1;
      continue;
    }

    if (child === node || child.contains(node)) {
      const before = layer.ownerDocument.createRange();
      before.selectNodeContents(child);
      before.setEnd(node, offset);
      // Safe to use Range.toString() here and nowhere else: within a single
      // text run there are no <br>s for it to skip.
      return total + before.toString().length;
    }

    total += child.textContent?.length ?? 0;
  }

  return null;
}

/**
 * The inverse: a DOM Range covering [start, end) of the page string.
 *
 * Needed to DRAW a stored highlight — the anchor is a character range and the
 * page is a canvas, so the only way to find the rectangles is to reconstruct
 * the selection and ask the browser where it is.
 *
 * Returns null when the range does not fit the layer, which happens whenever
 * the text on screen is not the text the anchor was measured against. Drawing
 * something plausible instead would be the exact failure the anchoring engine
 * exists to prevent.
 */
export function rangeForPageText(
  layer: HTMLElement,
  start: number,
  end: number,
): Range | null {
  if (start < 0 || end <= start) return null;

  const startPoint = pointAt(layer, start);
  const endPoint = pointAt(layer, end);
  if (!startPoint || !endPoint) return null;

  const range = layer.ownerDocument.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}

/** The text node and offset that a page-string position lands on. */
function pointAt(
  layer: HTMLElement,
  target: number,
): { node: Node; offset: number } | null {
  let total = 0;

  for (const child of Array.from(layer.childNodes)) {
    if (isLineBreak(child)) {
      // The newline itself is not addressable — there is no text node holding
      // it. A position landing exactly on it belongs at the end of the run
      // before it, which `total` already points at.
      total += 1;
      continue;
    }

    const length = child.textContent?.length ?? 0;

    if (target <= total + length) {
      const within = target - total;
      const node = firstTextNode(child);
      if (!node) return null;
      return descendTo(child, within) ?? { node, offset: Math.min(within, node.length) };
    }

    total += length;
  }

  return null;
}

/** Walk a run's text nodes to place an offset that spans several of them. */
function descendTo(root: Node, within: number): { node: Node; offset: number } | null {
  let remaining = within;
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  let node = walker.nextNode() as Text | null;
  if (!node && root.nodeType === Node.TEXT_NODE) {
    return { node: root, offset: Math.min(within, (root as Text).length) };
  }

  while (node) {
    if (remaining <= node.length) return { node, offset: remaining };
    remaining -= node.length;
    node = walker.nextNode() as Text | null;
  }

  return null;
}

function firstTextNode(root: Node): Text | null {
  if (root.nodeType === Node.TEXT_NODE) return root as Text;
  return root
    .ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    .nextNode() as Text | null;
}

function isLineBreak(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "BR";
}

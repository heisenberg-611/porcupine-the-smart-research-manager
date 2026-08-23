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

/**
 * The minimum of a pdf.js text item this module needs. Not imported from
 * pdfjs-dist, so nothing that only joins strings pulls in a megabyte.
 *
 * `str` is optional because `getTextContent()` does NOT return only text.
 * A tagged PDF — which most publisher PDFs are — also yields
 * `beginMarkedContent` / `endMarkedContent` markers, and those have no `str`
 * at all.
 */
export interface TextRun {
  str?: string | undefined;
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
    /*
     * Skip the structure markers.
     *
     * `+= item.str` on a marked-content marker appends the LITERAL STRING
     * "undefined" — nine characters of garbage in the middle of the paper,
     * shifting every offset after it and putting nonsense inside any quote
     * that spans it. It corrupts only tagged PDFs, which is most real ones and
     * none of the simple fixtures, so it survives exactly the tests that would
     * be written for it.
     */
    if (typeof item.str !== "string") continue;
    // Strip null bytes (0x00) which are forbidden in PostgreSQL UTF-8 text
    text += item.str.replace(/\0/g, "");
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
  if (!layer.contains(node)) return null;

  /*
   * Measured over a CLONE of everything before the point, not by walking the
   * layer's direct children.
   *
   * pdf.js nests: a tagged PDF puts its runs inside
   * `<span class="markedContent">` wrappers and appends the line-break `<br>`
   * INSIDE that nesting. Counting only `layer.childNodes` therefore missed
   * every nested break — one character of drift per line on exactly the
   * documents people actually upload.
   *
   * Cloning also makes the container type irrelevant: a selection boundary can
   * land on an element with a child index rather than on a text node, and
   * `setEnd` handles both.
   */
  const range = layer.ownerDocument.createRange();
  range.selectNodeContents(layer);
  try {
    range.setEnd(node, offset);
  } catch {
    // A boundary the layer cannot express is not a position in this page.
    return null;
  }

  return measure(range.cloneContents());
}

/** Characters in a fragment, counting a `<br>` as the newline it stands for. */
function measure(fragment: DocumentFragment): number {
  let total = 0;
  const walker = fragment.ownerDocument.createTreeWalker(
    fragment,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );

  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (isLineBreak(node)) total += 1;
    } else {
      total += (node as Text).length;
    }
    node = walker.nextNode();
  }
  return total;
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

  const from = pointAt(layer, start);
  const to = pointAt(layer, end);
  if (!from || !to) return null;

  const range = layer.ownerDocument.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
}

/**
 * The text node and offset a page-string position lands on.
 *
 * Walks the whole subtree for the same reason `offsetInPageText` clones one:
 * the runs are nested on tagged PDFs, and a walk of direct children would
 * place a highlight by counting the wrong things.
 */
function pointAt(
  layer: HTMLElement,
  target: number,
): { node: Node; offset: number } | null {
  const walker = layer.ownerDocument.createTreeWalker(
    layer,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );

  let total = 0;
  let lastText: Text | null = null;
  let node = walker.nextNode();

  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (isLineBreak(node)) {
        // The newline has no text node of its own. A position landing exactly
        // on it belongs at the end of the run before it.
        if (target === total && lastText) {
          return { node: lastText, offset: lastText.length };
        }
        total += 1;
      }
    } else {
      const text = node as Text;
      if (target <= total + text.length) return { node: text, offset: target - total };
      total += text.length;
      lastText = text;
    }
    node = walker.nextNode();
  }

  // One past the end is a legitimate endpoint for a range that runs to the
  // final character.
  if (lastText && target === total) return { node: lastText, offset: lastText.length };
  return null;
}

function isLineBreak(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "BR";
}

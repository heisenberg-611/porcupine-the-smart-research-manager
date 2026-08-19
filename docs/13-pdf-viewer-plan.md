# Reading the actual PDF — Build Plan

Phase 4 (`docs/12-file-storage-build-plan.md`) put a paper's text on screen and
made a quote resolve to a page of it. Reading it is still wrong: the reader
shows extracted text in a `<div>`, so highlighting feels like annotating a
transcript rather than a paper. Columns, figures, tables and equations are
gone; a highlight lands on a line of reflowed prose that looks nothing like the
page it came from.

That is a presentation failure, and it is the whole complaint.

---

## 1. Extraction was not the wrong approach. It was half of the right one.

Worth stating plainly, because "stop extracting text and show the PDF" is the
obvious reading of the problem and it would throw away the part that works.

**Highlighting a real PDF is a text layer.** pdf.js renders a page to a
`<canvas>`, then overlays transparent, absolutely-positioned `<span>`s on top
of the glyphs — one per text run, at the right size and rotation. The user
selects those spans with an ordinary DOM selection. Highlights are drawn as
rectangles derived from that selection. This is how pdf.js's own viewer,
Hypothes.is, and every browser PDF annotator work.

The text inside those spans is `page.getTextContent()` — the same call
`src/lib/pdf-text.ts` already makes and whose output we already store.

So the substrate stays:

- **`file_pages`** remains the anchor substrate. It is what lets the SERVER
  resolve an anchor without a browser — which is what makes the evidence
  table's links, `resolveInSections`, and the extraction form work at all.
- **`AnchorSelector`** is unchanged. Quote, prefix, suffix, offsets, page.
- **The extraction form** keeps working against the same text.

What is missing is the canvas and the positioned layer. That is the work.

---

## 2. The one thing that will silently rot if we get it wrong

**The offsets must agree**, and today they would not.

`pdfjs.TextLayer` appends `<br role="presentation">` for every line break
(`pdf.mjs:15058`). Our extractor writes `item.str + (hasEOL ? "\n" : "")`. And
a `<br>` contributes nothing to the APIs a selection is measured with —
measured in Chromium, not assumed:

| API | Result for `<span>first line</span><br><span>second line</span>` |
| --- | --- |
| `textContent` | `"first linesecond line"` |
| `Range.toString()` | `"first linesecond line"` |
| `innerText` | `"first line\nsecond line"` |

So a selection offset taken from the layer drifts by **one character per line**
against the stored string, accumulating down the page. Near the bottom of a
40-line page an anchor would be ~40 characters out.

It would not fail loudly. `resolveAnchor` would miss its fast path, fall
through to quote matching, and usually still find the passage — so the symptom
is not an error but a slow loss of precision, and ambiguity wherever a page
repeats a phrase. That is the failure this project keeps designing against.

**The fix is one shared join rule.** A single function defines how text runs
become a page string, and both sides use it:

- the extractor, when it writes `file_pages`
- a DOM walker, when it converts a selection in the layer to an offset

`innerText` is not the answer on its own — it is expensive, layout-dependent,
and varies with CSS. An explicit walker that mirrors the join rule is testable
and cannot drift, because there is only one rule.

**This lands first, before any canvas**, and with tests that assert the two
agree on a real PDF.

---

## 3. Assets have to be vendored, and they are not small

Text extraction deliberately skipped `standardFontDataUrl` and `cMapUrl`
because glyph data is only needed to DRAW. Drawing is now the point.

`pdfjs-dist` ships `standard_fonts` (800 KB) and `cmaps` (1.6 MB). Without
them, PDFs using the 14 standard fonts render with substituted glyphs, and
CJK/CID documents render as blanks. They join the worker in
`scripts/vendor-pdfjs.mjs`, served from `public/pdfjs/` and cached
`immutable` — the same treatment `next.config.ts` already gives the TeX
distribution, for the same reason.

Nothing is added to the JavaScript bundle: these are fetched on demand by the
worker, only for documents that need them.

---

## 4. Stages

**Stage 1 — the join rule.** One shared function, used by the extractor and by
a selection-to-offset walker. Tests that render a real PDF's text layer and
assert an offset taken from the DOM matches the stored string. Nothing visible
changes; every later stage depends on this being right.

**Stage 2 — one page, rendered.** Canvas + `TextLayer` for a single page, at a
fixed width. Selection produces an anchor with the correct page and offsets.
The plain-text reader stays as the fallback for files with no text layer.

**Stage 3 — the document.** All pages, virtualized: render what is near the
viewport and drop canvases that are far from it. A 300-page thesis at full
resolution is hundreds of megabytes of bitmap, so this is not optional. Page
navigation, and `?anchor=` scrolling to the right page.

**Stage 4 — highlights on the page.** Stored anchors drawn as rectangles over
the canvas, from a `Range` reconstructed over the layer. This is where DRIFTED
has to stay visible: a highlight whose passage moved must look different from
one that did not, exactly as it does in the text reader today.

**Stage 5 — zoom and fit.** Re-render at device pixel ratio and user scale;
`TextLayer.update()` repositions the spans rather than rebuilding them.

---

## 5. What v1 will not do

- **No annotation editing layer.** pdf.js can render a PDF's own embedded
  annotations and even author them. Ours live in `annotations`, resolved
  through the anchoring engine, and mixing the two models would give a paper
  two kinds of highlight with different rules.
- **No text reflow or accessibility remediation.** The text layer is the
  accessible representation, which is why it stays selectable and in reading
  order.
- **No server-side rendering of pages to images.** It moves the cost to a
  serverless function with a duration limit, for a result the browser can
  produce from bytes it already has.

---

## 6. Acceptance

A member opens a paper with an attached PDF and sees the page as published —
columns, figures, equations. Selecting a sentence produces a highlight on that
sentence, on that page. An extraction quote opens at the passage, on the page,
with the highlight drawn over it. A quote captured before this phase still
resolves, because the join rule did not change under it. `pnpm verify --e2e`
green.

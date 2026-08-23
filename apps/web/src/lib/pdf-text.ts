"use client";

import { MAX_PAPER_PAGES } from "@Porcupine/shared";

import { joinPageText, type TextRun } from "./page-text";

/**
 * Read the text layer out of a PDF, in the browser.
 *
 * ─ Why the browser ────────────────────────────────────────────────────────
 *
 * The same reason the upload itself goes straight to storage: at the moment
 * this runs, the file is already in this tab's memory, and the alternative is
 * a serverless function downloading up to 50 MB to parse it inside a duration
 * limit. Extraction happens once, by whoever uploads, and every other member
 * of the project reads the stored result — so nobody pays this cost twice and
 * the server never pays it at all.
 *
 * ─ Why it is safe enough ──────────────────────────────────────────────────
 *
 * A PDF from a publisher, a preprint server, or a stranger's email is
 * untrusted input handed to a large parser. docs/02-security-and-e2ee.md §7
 * asks for `isEvalSupported: false`, scripting disabled, and a sandboxed
 * context. Two of those three are satisfied here; the first is satisfied
 * somewhere else, and it is worth saying exactly where.
 *
 *   • `isEvalSupported: false` NO LONGER EXISTS. pdf.js removed the option in
 *     v5 because it removed the thing it guarded: the built library at
 *     6.2.108 contains no `eval(` and no `new Function(` — checked, in both
 *     pdf.mjs and pdf.worker.mjs, and asserted by a test in this repo so an
 *     upgrade that reintroduces one cannot pass unnoticed. Passing the option
 *     today would be a comforting no-op.
 *   • pdf.js runs the parse in a Web Worker, which is the sandboxed context —
 *     a malformed file cannot lock the reader's main thread, and the worker
 *     has no DOM to reach.
 *   • No canvas, no fonts, no annotation layer. This reads `getTextContent()`
 *     and nothing else, so the whole rendering surface — the part of pdf.js
 *     with the interesting history — is never entered.
 *   • No WebAssembly either. v6 can use wasm for JPEG 2000 and JBIG2 image
 *     decoding, but only when given a `wasmUrl`, and the package ships no
 *     .wasm files. Unset, as here, that path is unreachable — so the
 *     `wasm-unsafe-eval` question §7 raises for the crypto worker and the TeX
 *     engine does not arise for this one.
 *
 * There is deliberately no PDF *viewer* here. The reader annotates text, the
 * anchoring engine resolves against text, and a page image would add a canvas,
 * a font loader and a CSP argument to buy something nothing in the product
 * needs yet.
 */

export interface ExtractedPage {
  /** 1-based, matching AnchorSelector.page. */
  pageNumber: number;
  text: string;
}

export type ExtractionResult =
  { ok: true; pages: ExtractedPage[] } | { ok: false; error: string };

/**
 * Loaded on demand.
 *
 * pdf.js is about a megabyte. Importing it at module scope would put it in the
 * bundle of every reader page, including the overwhelming majority that have
 * no PDF attached at all.
 */
async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  // Vendored by scripts/vendor-pdfjs.mjs, at the version this import resolves
  // to. A mismatch between the two makes pdf.js refuse to start.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
  return pdfjs;
}

export async function extractPdfText(file: Blob): Promise<ExtractionResult> {
  let pdfjs;
  try {
    pdfjs = await loadPdfjs();
  } catch {
    return { ok: false, error: "The PDF reader could not be loaded." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  /*
   * Standard fonts and CMaps are provided so ToUnicode CMap streams on pages with
   * embedded figures, diagrams, and math symbols decode reliably.
   * `wasmUrl` remains absent so no unverified WebAssembly decoding is performed.
   */
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    disableAutoFetch: true,
    disableStream: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
  });

  let doc;
  try {
    doc = await loadingTask.promise;
  } catch {
    return {
      ok: false,
      error: "That PDF could not be read. It may be corrupt or password-protected.",
    };
  }

  if (doc.numPages > MAX_PAPER_PAGES) {
    return {
      ok: false,
      error: `That PDF has ${doc.numPages} pages; the limit is ${MAX_PAPER_PAGES}.`,
    };
  }

  const pages: ExtractedPage[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      let text = "";
      try {
        const page = await doc.getPage(pageNumber);
        try {
          const content = await page.getTextContent({
            includeMarkedContent: false,
          });

          /*
           * Joined by the shared rule, not here.
           *
           * pdf.js emits one item per run of glyphs, and a run ends wherever the
           * text matrix moves — mid-word as often as between words, because that
           * is how kerning and ligatures are encoded.
           */
          text = joinPageText(content.items as TextRun[]);
        } catch {
          // If a page has an unparseable image/graphic stream operator, fallback to empty or partial text
          text = "";
        } finally {
          // Free the page as we go. A long document held entirely in memory is how
          // a tab dies on a phone.
          page.cleanup();
        }
      } catch {
        text = "";
      }

      pages.push({ pageNumber, text });
    }
  } catch {
    return { ok: false, error: "That PDF could not be read all the way through." };
  } finally {
    // On the loading task, not the document: `destroy()` tears down the worker
    // as well, and leaking one worker per PDF opened is how a long reading
    // session ends up with thirty of them.
    await loadingTask.destroy();
  }

  // Check if any meaningful text was extracted across the document.
  // If the total text length across all pages is 0, this is an image-only scan or completely unreadable.
  const totalChars = pages.reduce((sum, p) => sum + p.text.trim().length, 0);
  if (totalChars === 0) {
    return {
      ok: false,
      error: "This PDF has no extractable text (it appears to be a scanned image).",
    };
  }

  return { ok: true, pages };
}

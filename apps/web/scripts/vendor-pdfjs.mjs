#!/usr/bin/env node
/**
 * Copy the pdf.js worker into public/ so the browser can fetch it.
 *
 * pdf.js parses untrusted PDFs in a Web Worker — which is the "sandboxed
 * context" docs/02-security-and-e2ee.md §7 asks for, and the reason a
 * malformed file cannot lock the reader's main thread. The worker has to be
 * served as a real URL, and bundler-specific tricks for locating it inside
 * node_modules (`new URL(..., import.meta.url)`) are exactly the kind of thing
 * that works under Turbopack dev and breaks in a production build.
 *
 * Copied rather than committed: the worker and the library must be the SAME
 * VERSION or pdf.js refuses to start with a version-mismatch error, and a
 * checked-in copy silently rots the next time pdfjs-dist is upgraded. Copying
 * from node_modules makes the dependency the single source of the version.
 *
 * Run explicitly from `dev` and `build` rather than from a `prebuild` hook,
 * because pnpm does not run pre/post scripts by default and a build step that
 * silently does not happen is worse than no build step.
 */
import { cpSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "..");

const pkgPath = require.resolve("pdfjs-dist/package.json");
const version = JSON.parse(readFileSync(pkgPath, "utf8")).version;
const source = join(dirname(pkgPath), "build", "pdf.worker.min.mjs");

const target = join(app, "public", "pdfjs");
mkdirSync(target, { recursive: true });
copyFileSync(source, join(target, "pdf.worker.min.mjs"));

/*
 * Glyph data, needed to DRAW and not to read.
 *
 * Text extraction skipped these deliberately: pdf.js warns and carries on
 * without them, because `getTextContent()` never rasterises anything. Once the
 * viewer draws pages, their absence stops being free — a document using the 14
 * standard fonts renders with substituted glyphs, and a CJK or CID-keyed one
 * renders blank pages with no error to explain it.
 *
 * Copied rather than bundled: the worker fetches them over HTTP, on demand,
 * only for documents that actually need them. Nothing here reaches the
 * JavaScript bundle.
 */
const pdfjsRoot = dirname(pkgPath);
cpSync(join(pdfjsRoot, "standard_fonts"), join(target, "standard_fonts"), {
  recursive: true,
});
cpSync(join(pdfjsRoot, "cmaps"), join(target, "cmaps"), { recursive: true });

/*
 * The text layer's CSS, extracted rather than imported.
 *
 * pdf.js positions each run with inline custom properties
 * (--total-scale-factor, --font-height, --scale-x, --rotate) that only mean
 * anything alongside these rules, so hand-writing them would rot at the next
 * upgrade. But `web/pdf_viewer.css` is 6,000 lines of full-viewer chrome and
 * it styles `:root`, so importing it wholesale would leak custom properties
 * across every page of the app.
 *
 * So: take the `.textLayer` blocks, leave the rest, and regenerate on every
 * build so they cannot drift from the library that depends on them.
 */
const css = readFileSync(join(pdfjsRoot, "web", "pdf_viewer.css"), "utf8");
const blocks = [];

for (const match of css.matchAll(/^\.textLayer\s*\{/gm)) {
  // Brace matching, because these blocks nest — `:is(span, br)` and
  // `.markedContent` live inside them, and a regex to the first `}` would cut
  // the rule in half and produce CSS that parses but does not work.
  let depth = 0;
  // Start ON the opening brace, not on the `.` of the selector: starting at
  // the match's first character leaves depth at zero, exits immediately, and
  // yields a one-character "block" that looks like valid output.
  let index = match.index + match[0].length - 1;
  do {
    if (css[index] === "{") depth++;
    else if (css[index] === "}") depth--;
    index++;
  } while (depth > 0 && index < css.length);
  blocks.push(css.slice(match.index, index));
}

/*
 * Drop declarations pointing at the viewer's own image assets.
 *
 * The `.textLayer` blocks carry a nested `.editToolbar` rule for pdf.js's
 * annotation EDITOR — the floating highlight/delete toolbar — whose custom
 * properties are `url(images/…svg)` relative to `web/`. We do not render that
 * editor (docs/13 §5: our annotations live in `annotations` and resolve
 * through the anchoring engine), so the toolbar never appears and the
 * properties are never read. Left in, they are unresolvable module imports
 * that fail the build.
 */
const cleaned = blocks.map((block) =>
  block
    .split("\n")
    .filter((line) => !line.includes("url(images/"))
    .join("\n"),
);

if (blocks.length === 0) {
  throw new Error(
    "No .textLayer rules found in pdf_viewer.css — the text layer will not " +
      "position and selection will silently land in the wrong place.",
  );
}

const styles = join(app, "src", "styles");
mkdirSync(styles, { recursive: true });
writeFileSync(
  join(styles, "pdf-text-layer.css"),
  `/* Generated by scripts/vendor-pdfjs.mjs from pdfjs-dist ${version}.\n` +
    ` * Do not edit: rewritten on every dev and build run. */\n\n` +
    cleaned.join("\n\n") +
    "\n",
);

console.warn(
  `vendored pdf.js ${version} (worker, standard fonts, cmaps, ${blocks.length} textLayer rule blocks) → public/pdfjs/`,
);

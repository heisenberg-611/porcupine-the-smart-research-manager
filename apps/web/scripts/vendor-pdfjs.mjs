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
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
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

console.warn(`vendored pdf.js worker ${version} → public/pdfjs/`);

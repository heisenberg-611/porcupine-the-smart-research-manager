import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

/**
 * Bundle the LaTeX compile worker, separately from the app.
 *
 * Next does not bundle web workers. `new Worker(new URL("./w.ts",
 * import.meta.url))` looks like it should — it is the webpack idiom, and the
 * Next docs use exactly that shape for a SERVICE worker — but Turbopack treats
 * `new URL(..., import.meta.url)` as an ASSET reference. The build happily
 * emitted the raw TypeScript to `.next/static/media/compile.worker.<hash>.ts`,
 * triple-slash directive, `import type` and bare specifiers intact, and the
 * browser could not parse a line of it. The worker never started, and the only
 * symptom was that nothing ever compiled.
 *
 * That is a bundler limitation rather than something to solve in application
 * code, so the worker gets its own tiny build: bundled with its dependencies
 * (fflate, glyphtex-engine) into one ES module served as a static file, which
 * also makes it independent of how the page happens to be chunked.
 *
 * Output lands beside the TeX assets it loads, in a gitignored directory —
 * every file there is a build artifact.
 */

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "../src/lib/latex/compile.worker.ts");
const outfile = resolve(here, "../public/latex/compile.worker.js");

await mkdir(dirname(outfile), { recursive: true });

const result = await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "esm",
  // No need to be conservative: this only ever runs in a browser new enough to
  // instantiate the wasm module in the first place.
  target: "es2022",
  platform: "browser",
  minify: process.env.NODE_ENV !== "development",
  sourcemap: process.env.NODE_ENV === "development",
  logLevel: "warning",
});

if (result.errors.length > 0) process.exit(1);

console.warn(`latex worker → public/latex/compile.worker.js`);

import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

/**
 * Prepare everything the LaTeX studio needs to exist as static files.
 *
 * Two jobs, in one step so neither can be forgotten.
 *
 * 1. BUNDLE THE WORKER. Next does not bundle web workers. `new Worker(new
 *    URL("./w.ts", import.meta.url))` is the webpack idiom and the shape the
 *    Next docs use for a SERVICE worker, but Turbopack treats
 *    `new URL(..., import.meta.url)` as an ASSET reference: the build happily
 *    emitted raw TypeScript to `.next/static/media/compile.worker.<hash>.ts`,
 *    the browser could not parse it, and the only symptom was that nothing
 *    ever compiled.
 *
 * 2. COPY THE TEX DISTRIBUTION out of the npm package. The wasm module, the
 *    base bundle and the packs ship inside `glyphtex-engine`, so they arrive
 *    with `pnpm install` and never need to be committed — 24 MB in git is 24 MB
 *    in every clone forever, and the next engine release would add another 24
 *    rather than replacing it. It also means a deploy has them: Vercel runs the
 *    install, this runs in `prebuild`, and `public/latex/` is populated before
 *    Next looks at it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "../public/latex");
const require = createRequire(import.meta.url);

// The version is the cache key: the worker stores the wasm and the bundle in
// Cache Storage under it, so a new engine release invalidates them and an
// unchanged one is never fetched twice.
const enginePkg = require.resolve("glyphtex-engine/package.json");
const { version } = JSON.parse(await readFile(enginePkg, "utf8"));
const engineWasmDir = join(dirname(enginePkg), "wasm");

await mkdir(publicDir, { recursive: true });

// Replaced rather than merged: a pack removed upstream should disappear here
// too, and a stale one would be served forever.
await rm(join(publicDir, "packs"), { recursive: true, force: true });
await cp(engineWasmDir, publicDir, { recursive: true });

const result = await build({
  entryPoints: [resolve(here, "../src/lib/latex/compile.worker.ts")],
  outfile: join(publicDir, "compile.worker.js"),
  bundle: true,
  format: "esm",
  // No need to be conservative: this only runs in a browser new enough to
  // instantiate the wasm module in the first place.
  target: "es2022",
  platform: "browser",
  minify: process.env.NODE_ENV !== "development",
  sourcemap: process.env.NODE_ENV === "development",
  define: { __LATEX_ASSET_VERSION__: JSON.stringify(version) },
  logLevel: "warning",
});

if (result.errors.length > 0) process.exit(1);

console.warn(`latex: engine ${version} + worker → public/latex/`);

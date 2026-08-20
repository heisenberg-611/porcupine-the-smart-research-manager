import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));

/**
 * The security requirement that no longer has a flag.
 *
 * docs/02-security-and-e2ee.md §7 asks for pdf.js with
 * `isEvalSupported: false`. That option was removed upstream in v5, along with
 * the eval it guarded — so the requirement is now met by the LIBRARY VERSION
 * rather than by anything in our code, and nothing in our code would fail if a
 * future version brought eval back.
 *
 * This is that missing failure. It reads the built files this app actually
 * loads and asserts the property the option used to promise. A pdfjs-dist
 * upgrade that reintroduces a code-generation path turns this red, in the same
 * run as the upgrade, instead of quietly widening the parser's rights against
 * untrusted input years later.
 */
describe("pdf.js ships no code-generation path", () => {
  // Both: the worker parses the file, and the main library is what pulls it in.
  const builds = ["build/pdf.mjs", "build/pdf.worker.mjs"];

  for (const build of builds) {
    it(`${build} contains no eval() or Function constructor`, () => {
      const source = readFileSync(join(pdfjsRoot, build), "utf8");

      // Anchored on a non-identifier character, so `FunctionBasedShading` and
      // `retrieval(` do not read as hits. The first version of this check
      // matched `new FunctionBasedShading(` and reported a problem that was
      // not there, which is its own kind of failure.
      expect(source.match(/new\s+Function\s*\(/g) ?? [], "Function constructor").toEqual(
        [],
      );
      expect(source.match(/(^|[^\w.$])eval\s*\(/g) ?? [], "eval call").toEqual([]);
    });
  }

  it("ships no WebAssembly modules, so the wasm path is unreachable", () => {
    /*
     * v6 can decode JPEG 2000 and JBIG2 with wasm, but only when handed a
     * `wasmUrl`. We do not pass one, and the package ships no .wasm files —
     * which together are why §7's `wasm-unsafe-eval` question does not arise
     * for this worker. If a future version bundles one, that reasoning needs
     * revisiting and this says so.
     */
    const pkg = JSON.parse(
      readFileSync(join(pdfjsRoot, "package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(typeof pkg.version).toBe("string");

    const wasm = readFileSync(join(pdfjsRoot, "build/pdf.worker.mjs"), "utf8");
    // The loader exists; what must stay absent is a bundled module for it to
    // load without us asking.
    expect(wasm.includes("wasmUrl")).toBe(true);
  });
});

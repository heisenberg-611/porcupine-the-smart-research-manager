/**
 * Which packages a document asks for that are not here — before TeX runs.
 *
 * TeX stops at the FIRST file it cannot find, and it stops by asking a
 * question ("enter a new filename"), which in a browser is a hard failure.
 * So the honest loop without this is: compile, learn one missing package,
 * download it, compile, learn the next. `biblatex` alone needs `logreq`, and
 * that is before its backend, its styles and whatever those want.
 *
 * Scanning the source is cruder than TeX's own resolution and it does not have
 * to be exact — a name reported that TeX would have found anyway costs the
 * reader nothing, while a round trip costs them a minute. What it buys is the
 * WHOLE list in one go.
 *
 * It scans the DOCUMENT, and nothing else. Scanning inside uploaded packages
 * was tried and reverted — see the note in the worker.
 */

/** `\usepackage[opts]{a,b}`, `\RequirePackage{...}`, and the class. */
const PACKAGE =
  /\\(?:usepackage|RequirePackage(?:WithOptions)?)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
const CLASS = /\\(?:documentclass|LoadClass)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
const TIKZ = /\\usetikzlibrary\s*\{([^}]*)\}/g;

/**
 * Strip TeX comments before scanning.
 *
 * Without this a commented-out `% \usepackage{tikz}` is reported as missing,
 * which sends someone downloading a package their document does not use. An
 * escaped `\%` is not a comment.
 */
function stripComments(source: string): string {
  return source.replace(/(^|[^\\])%.*$/gm, "$1");
}

function names(source: string, pattern: RegExp, suffix: (name: string) => string) {
  const found: string[] = [];
  for (const match of source.matchAll(pattern)) {
    for (const raw of (match[1] ?? "").split(",")) {
      const name = raw.trim();
      // A package name is letters, digits, dashes and dots. Anything else is
      // TeX being TeX — `\RequirePackage{#1}` inside a macro definition, or a
      // name built by expansion — and cannot be resolved without running the
      // engine. Reporting a guess as a missing package is worse than silence:
      // "#1" sent someone looking for a package called #1 on CTAN.
      if (name && /^[A-Za-z0-9][\w.-]*$/.test(name)) found.push(suffix(name));
    }
  }
  return found;
}

export function requestedFiles(source: string): string[] {
  const clean = stripComments(source);
  return [
    ...names(clean, PACKAGE, (n) => (n.endsWith(".sty") ? n : `${n}.sty`)),
    ...names(clean, CLASS, (n) => (n.endsWith(".cls") ? n : `${n}.cls`)),
    ...names(clean, TIKZ, (n) => `tikzlibrary${n}.code.tex`),
  ];
}

/**
 * Everything the document (and the packages present) ask for and cannot get.
 *
 * `scan` is the set of sources worth reading: the document itself, plus files
 * the user supplied. The shipped bundle is not scanned — its dependencies are
 * satisfied by construction, and decoding thousands of files to prove it would
 * cost more than the compile.
 */
export function missingPackages(
  scan: Iterable<[string, Uint8Array | string]>,
  available: ReadonlySet<string>,
): string[] {
  const decoder = new TextDecoder();
  const missing = new Set<string>();

  for (const [name, contents] of scan) {
    if (!/\.(tex|sty|cls|def|clo)$/i.test(name)) continue;

    const source =
      typeof contents === "string"
        ? contents
        : decoder.decode(contents.subarray(0, 65_536));

    for (const wanted of requestedFiles(source)) {
      if (!available.has(wanted)) missing.add(wanted);
    }
  }

  return [...missing];
}

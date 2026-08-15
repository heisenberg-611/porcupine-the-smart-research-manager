import { gunzipSync, unzipSync } from "fflate";

import { untar } from "./untar";

/**
 * Turn something a person dropped on the page into files TeX can open.
 *
 * CTAN gives you a package as a `.zip` or a `.tar.gz` containing a directory
 * tree — `biblatex/latex/biblatex.sty`, `biblatex/doc/…`, and so on. TeX
 * Live's own trees are deeper still. The engine's filesystem is flat and asks
 * for `biblatex.sty`, so paths are reduced to their basename on the way in.
 *
 * That flattening is a real limitation and worth stating: two files with the
 * same basename in different directories collide, and the last one wins. It is
 * still the right trade — the alternative is asking the user to know which of
 * forty directories in a TeX Live tree the engine will search.
 *
 * Documentation, sources and build scripts are dropped. A CTAN package is
 * mostly PDF manuals, and storing thirty megabytes of documentation in a
 * browser to typeset a bibliography would be absurd.
 */

/** What TeX actually reads. Everything else in a package is for humans. */
const USEFUL = new Set([
  "sty",
  "cls",
  "def",
  "cfg",
  "clo",
  "ldf",
  "fd",
  "tex",
  "code",
  "bbx",
  "cbx",
  "lbx",
  "bst",
  "enc",
  "map",
  "tfm",
  "vf",
  "pfb",
  "otf",
  "ttf",
  "ucm",
]);

/** Directories in a CTAN or TeX Live tree that hold nothing TeX will open. */
const IGNORED = /(^|\/)(doc|source|docs?|examples?|test(s|ing)?)(\/|$)/i;

export interface ExtractResult {
  files: Map<string, Uint8Array>;
  /** Names skipped, so the UI can say what it did rather than silently drop. */
  skipped: number;
  /** Basenames that appeared more than once; later ones replaced earlier. */
  collisions: string[];
}

export async function extractUpload(file: File): Promise<ExtractResult> {
  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());

  if (name.endsWith(".zip")) return collect(unzipToMap(bytes));
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) {
    return collect(untar(gunzipSync(bytes)));
  }
  if (name.endsWith(".tar")) return collect(untar(bytes));
  if (name.endsWith(".gz")) {
    // A single gzipped file, e.g. `biblatex.sty.gz`.
    return collect(new Map([[file.name.replace(/\.gz$/i, ""), gunzipSync(bytes)]]));
  }

  // A bare file. Taken at face value — if someone drops `mystyle.sty`, that is
  // exactly what they meant, and second-guessing the extension would only get
  // in the way of a local package that has no CTAN entry.
  return { files: new Map([[file.name, bytes]]), skipped: 0, collisions: [] };
}

function unzipToMap(bytes: Uint8Array): Map<string, Uint8Array> {
  const entries = unzipSync(bytes);
  return new Map(Object.entries(entries));
}

function collect(raw: Map<string, Uint8Array>): ExtractResult {
  const files = new Map<string, Uint8Array>();
  const collisions: string[] = [];
  let skipped = 0;

  for (const [path, bytes] of raw) {
    if (IGNORED.test(path) || !isUseful(path)) {
      skipped++;
      continue;
    }

    const base = path.split("/").pop() ?? path;
    if (base === "") {
      skipped++;
      continue;
    }

    if (files.has(base)) collisions.push(base);
    files.set(base, bytes);
  }

  return { files, skipped, collisions };
}

function isUseful(path: string): boolean {
  const base = (path.split("/").pop() ?? "").toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false;

  const ext = base.slice(dot + 1);
  // `foo.code.tex` and friends end in `.tex`; the check above already covers
  // them, so this is only the final extension.
  return USEFUL.has(ext);
}

/// <reference lib="webworker" />

import { gunzipSync } from "fflate";
import {
  EnginePoisonedError,
  parsePackIndex,
  resolveMissing,
  TexEngine,
  type InstalledPack,
  type PackIndex,
} from "glyphtex-engine";

import { loadAll } from "./package-store";
import { untar } from "./untar";
import type { CompiledMessage, WorkerRequest, WorkerResponse } from "./protocol";

/**
 * LaTeX compilation, off the main thread.
 *
 * `TexEngine.compile()` is SYNCHRONOUS and runs for seconds. On the main
 * thread that is not merely slow, it is a lie: React sets "Compiling…" and
 * then blocks before the browser can paint it, so the button never changes and
 * the page stops responding to scrolls and clicks until the PDF appears.
 *
 * Three things are cached here for the life of the worker, which is the whole
 * reason a worker beats a module-level singleton on the main thread:
 *
 *   1. The wasm module. Instantiated once.
 *   2. The base bundle — 13 MB compressed, thousands of files. The first
 *      version re-fetched, re-gunzipped, re-untarred and re-added all of it on
 *      EVERY compile, so changing one character cost the full cold start.
 *   3. Installed packs, so a document that pulled in `amsmath` last compile
 *      does not fetch it again.
 *
 * The engine holds auxiliary files between compiles as well, which is what
 * lets a second run converge in fewer passes.
 */

const WASM_URL = "/latex/tectonic_wasm.wasm";
const BUNDLE_URL = "/latex/tectonic-bundle.tar.gz";
const PACK_INDEX_URL = "/latex/packs/packs-index.json";
const packUrl = (id: string) => `/latex/packs/pack-${id}.tar.gz`;

/** Survives across compiles. Rebuilt only if the engine is poisoned. */
let engine: TexEngine | null = null;
let bundle: Map<string, Uint8Array> | null = null;
let packIndex: PackIndex | null = null;
const installed: InstalledPack[] = [];
/**
 * Pack contents, kept so the filesystem can be rebuilt without refetching.
 *
 * The engine has no "remove these files" for a whole pack, so when the user's
 * own package set changes the only correct move is to clear the filesystem and
 * lay it down again: bundle, then packs, then the user's files. Holding the
 * bytes here is what makes that cost nothing.
 */
const packFiles = new Map<string, Uint8Array>();
let packagesToken: string | null = null;

const scope = self as unknown as DedicatedWorkerGlobalScope;

function post(message: WorkerResponse, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

/** Fetch that says which URL failed, and refuses an HTML error page. */
async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}. Is the asset deployed?`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function ensureEngine(id: number): Promise<TexEngine> {
  if (engine) return engine;

  post({ kind: "progress", id, step: "Starting the TeX engine" });
  // A Response, not bytes: it is the streaming path, and the only one V8 will
  // populate its compiled-code cache from — which is what makes the SECOND
  // page load fast.
  const created = await TexEngine.load(fetch(WASM_URL));

  post({ kind: "progress", id, step: "Unpacking the TeX distribution" });
  if (!bundle) {
    bundle = untar(gunzipSync(await fetchBytes(BUNDLE_URL)));
  }
  created.addFiles(bundle);

  engine = created;
  // Force the next check to rebuild: a fresh engine has the bundle and nothing
  // else, whatever token the caller thinks is current.
  packagesToken = null;
  return created;
}

/**
 * Fetch whatever packs provide the files the engine asked for.
 *
 * `missingFiles` is the engine's documented hook for exactly this, and the
 * first version ignored it: any document using a package outside the base
 * bundle failed with a raw TeX error and no explanation, while 8 MB of packs
 * sat unused in `public/`. Returns the names nothing provides, so the UI can
 * say which package is genuinely unavailable rather than "compilation failed".
 */
async function installFor(
  missing: readonly string[],
  id: number,
): Promise<{ unsupported: string[]; installedCount: number }> {
  if (missing.length === 0) return { unsupported: [], installedCount: 0 };

  if (!packIndex) {
    const response = await fetch(PACK_INDEX_URL);
    if (!response.ok) return { unsupported: [...missing], installedCount: 0 };
    packIndex = parsePackIndex(await response.json());
  }

  const { packs, unsupported } = resolveMissing(packIndex, missing, installed);
  if (packs.length === 0) return { unsupported, installedCount: 0 };

  post({
    kind: "progress",
    id,
    step: `Fetching ${packs.length} package ${packs.length === 1 ? "set" : "sets"}`,
  });

  for (const pack of packs) {
    const files = untar(gunzipSync(await fetchBytes(packUrl(pack.id))));
    for (const [name, bytes] of files) packFiles.set(name, bytes);
    engine?.addFiles(files);
    installed.push({ id: pack.id, hash: pack.hash });
  }

  return { unsupported, installedCount: packs.length };
}

/**
 * Lay the filesystem down in precedence order: bundle, packs, then yours.
 *
 * Last write wins in the engine, so a `.sty` a person uploaded deliberately
 * overrides the one shipped in the base bundle. That is the behaviour someone
 * uploading a package wants — they are usually doing it because the shipped
 * version is absent or wrong.
 */
async function rebuildFilesystem(token: string, id: number): Promise<void> {
  const active = engine;
  if (!active) return;

  post({ kind: "progress", id, step: "Loading your packages" });

  active.clearFiles();
  // The previous run's auxiliary files were computed against a different
  // filesystem, so keeping them would let a stale .aux decide the layout.
  active.clearOutputs();

  if (bundle) active.addFiles(bundle);
  if (packFiles.size > 0) active.addFiles(packFiles);

  const mine = await loadAll();
  if (mine.size > 0) active.addFiles(mine);

  packagesToken = token;
}

async function compile(request: WorkerRequest): Promise<void> {
  const { id, files, entry } = request;
  const active = await ensureEngine(id);

  if (request.packagesToken !== packagesToken) {
    await rebuildFilesystem(request.packagesToken, id);
  }

  for (const [name, contents] of Object.entries(files)) active.addFile(name, contents);

  post({ kind: "progress", id, step: "Typesetting" });
  let result = active.compile({ entry, synctex: true });

  /*
   * Install and retry until nothing new gets installed.
   *
   * A single retry is not enough, and a real document proves it: a package
   * only asks for its own dependencies once IT has loaded, so round one
   * discovers `tikz.sty`, round two discovers the tikz libraries that
   * `\usetikzlibrary` wants, and so on. Bounded at four rounds because each
   * one is a full typesetting pass and a document that has not converged by
   * then is missing something no pack provides.
   *
   * Retrying only when something was actually INSTALLED is what stops this
   * looping forever on files nothing supplies — and stops an ordinary document
   * paying for a second pass it does not need, since TeX asks for plenty of
   * files it copes fine without.
   */
  const unresolved = new Set<string>();
  for (let round = 0; round < 4 && result.missingFiles.length > 0; round++) {
    const outcome = await installFor(result.missingFiles, id);
    for (const name of outcome.unsupported) unresolved.add(name);

    if (outcome.installedCount === 0) break;

    post({ kind: "progress", id, step: "Typesetting again with the new packages" });
    result = active.compile({ entry, synctex: true });
  }

  // Anything still missing on the final pass, whether or not a pack was ever
  // tried for it.
  for (const name of result.missingFiles) unresolved.add(name);
  const unsupported = [...unresolved];

  // `errors` is NOT fatal — TeX recovers from most errors and still typesets,
  // so a document that reports errors usually has a perfectly good PDF. Only
  // `failed` means nothing was produced.
  const pdf = result.status === "failed" ? undefined : active.pdf();
  const bytes = pdf ? pdf.slice().buffer : null;

  const message: CompiledMessage = {
    kind: "compiled",
    id,
    status: result.status,
    pdf: bytes,
    diagnostics: result.diagnostics,
    unsupported,
    log: active.log() ?? null,
    passesRun: result.passesRun,
    message: result.message,
  };

  post(message, bytes ? [bytes] : []);
}

scope.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  void compile(request).catch((error: unknown) => {
    // A poisoned engine cannot be recovered from the inside: the session stays
    // borrowed and every later compile fails the same way. Discard it so the
    // next attempt rebuilds, rather than reporting a document error for what
    // is an engine error.
    if (error instanceof EnginePoisonedError) engine = null;

    post({
      kind: "failed",
      id: request.id,
      message: error instanceof Error ? error.message : "The compiler stopped.",
    });
  });
});

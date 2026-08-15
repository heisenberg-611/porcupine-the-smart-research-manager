/**
 * TeX packages you supply yourself, kept in this browser.
 *
 * The shipped distribution is deliberately small — a wasm engine, a base
 * bundle and ten curated packs — because every byte of it is downloaded by
 * everyone. That leaves real documents short: biblatex, listings, pgfplots and
 * most of the TikZ libraries are simply not in it, and a review that needs
 * them cannot be typeset.
 *
 * Rather than growing the distribution for everyone, a person can drop the
 * `.sty` files (or a whole CTAN tarball) into their own browser. They are
 * stored here, added to the virtual filesystem before every compile, and
 * belong to that browser alone: nothing is uploaded to any server, which is
 * also why nobody has to think about whether we are allowed to redistribute
 * them.
 *
 * They expire after thirty days. That is a deliberate cost rather than an
 * oversight — see TTL_DAYS.
 *
 * No DOM APIs are used here on purpose: the compile worker reads this store
 * directly, so the megabytes never cross a postMessage boundary.
 */

import { FILES, META, openLatexDb, openLatexDbForReading, runTx } from "./idb";

/**
 * Thirty days, then gone.
 *
 * The user asked for this and it is the right default anyway. A package cache
 * that never expires is a cache nobody ever revisits: the copy of `biblatex`
 * you dropped in eighteen months ago silently outlives the version your
 * document was written against, and the resulting failure looks like a bug in
 * the editor. An expiry that comes round makes the refresh a normal event.
 */
export const TTL_DAYS = 30;
const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;

export interface PackageMeta {
  name: string;
  bytes: number;
  addedAt: number;
  /** The upload it came from — an archive name, or the file's own. */
  source: string;
}

export interface StoredPackage extends PackageMeta {
  /** Whole days remaining before it is swept. Never negative. */
  daysLeft: number;
}

/**
 * Ask the browser not to evict this data.
 *
 * Without it, IndexedDB is "best effort": a browser under storage pressure may
 * drop the whole database, and a thirty-day promise the browser can break on
 * day two is not a promise. Chrome grants this silently for engaged sites;
 * Firefox prompts. Failing is fine — the packages just become evictable — so
 * the result is reported rather than thrown.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Delete everything past its thirty days. Returns how many went. */
export async function sweepExpired(now = Date.now()): Promise<number> {
  const db = await openLatexDb();
  const cutoff = now - TTL_MS;

  const expired = await runTx(db, [META], "readonly", (tx) => {
    const names: string[] = [];
    const store = tx.objectStore(META);
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      const meta = c.value as PackageMeta;
      if (meta.addedAt < cutoff) names.push(meta.name);
      c.continue();
    };
    return names;
  });

  if (expired.length > 0) {
    await runTx(db, [FILES, META], "readwrite", (tx) => {
      for (const name of expired) {
        tx.objectStore(FILES).delete(name);
        tx.objectStore(META).delete(name);
      }
    });
  }

  db.close();
  return expired.length;
}

/** Everything present, newest first, with its remaining life. */
export async function listPackages(now = Date.now()): Promise<StoredPackage[]> {
  const db = await openLatexDb();

  const metas = await runTx(db, [META], "readonly", (tx) => {
    const all: PackageMeta[] = [];
    const cursor = tx.objectStore(META).openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      all.push(c.value as PackageMeta);
      c.continue();
    };
    return all;
  });

  db.close();

  return metas
    .map((meta) => ({
      ...meta,
      daysLeft: Math.max(0, Math.ceil((meta.addedAt + TTL_MS - now) / 86_400_000)),
    }))
    .sort((a, b) => b.addedAt - a.addedAt || a.name.localeCompare(b.name));
}

/** Add files. Re-adding an existing name replaces it and resets its clock. */
export async function putFiles(
  files: Map<string, Uint8Array>,
  source: string,
): Promise<number> {
  if (files.size === 0) return 0;

  const db = await openLatexDb();
  const addedAt = Date.now();

  await runTx(db, [FILES, META], "readwrite", (tx) => {
    const fileStore = tx.objectStore(FILES);
    const metaStore = tx.objectStore(META);
    for (const [name, bytes] of files) {
      fileStore.put(bytes, name);
      metaStore.put({ name, bytes: bytes.byteLength, addedAt, source }, name);
    }
  });

  db.close();
  return files.size;
}

/**
 * Every stored file, for the engine's virtual filesystem.
 *
 * Called from the compile worker, which is why it reads without naming a
 * version and tolerates the store not existing — a browser that has never had
 * a package uploaded has no `files` store, and that is not an error.
 */
export async function loadAll(): Promise<Map<string, Uint8Array>> {
  const db = await openLatexDbForReading();

  if (!db.objectStoreNames.contains(FILES)) {
    db.close();
    return new Map();
  }

  const files = await runTx(db, [FILES], "readonly", (tx) => {
    const map = new Map<string, Uint8Array>();
    const cursor = tx.objectStore(FILES).openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      map.set(String(c.key), c.value as Uint8Array);
      c.continue();
    };
    return map;
  });

  db.close();
  return files;
}

export async function removePackage(name: string): Promise<void> {
  const db = await openLatexDb();
  await runTx(db, [FILES, META], "readwrite", (tx) => {
    tx.objectStore(FILES).delete(name);
    tx.objectStore(META).delete(name);
  });
  db.close();
}

export async function removeAll(): Promise<void> {
  const db = await openLatexDb();
  await runTx(db, [FILES, META], "readwrite", (tx) => {
    tx.objectStore(FILES).clear();
    tx.objectStore(META).clear();
  });
  db.close();
}

/**
 * A cheap token that changes whenever the stored set changes.
 *
 * The worker rebuilds its virtual filesystem when this differs from what it
 * last saw, which is what makes an upload take effect on the next compile —
 * and a removal actually remove, rather than leaving the file in an engine
 * that was never told.
 */
export async function storeToken(): Promise<string> {
  const packages = await listPackages();
  const newest = packages.reduce((max, p) => Math.max(max, p.addedAt), 0);
  return `${packages.length}:${newest}`;
}

import { openLatexDb, PROJECT, runTx } from "./idb";

/**
 * The document being written: every file in it, not just one.
 *
 * A thesis is not one `.tex`. It is a root document that `\input`s a chapter
 * per file, a `.bib`, and a directory of figures — and an editor that can hold
 * only `main.tex` cannot open any real project. The engine has always accepted
 * a whole filesystem; it was this side that offered one text box.
 *
 * Text and bytes both live here. Figures matter as much as chapters —
 * `\includegraphics` is not an advanced feature — and a store that could hold
 * only strings would push images into a second mechanism for no reason.
 *
 * In IndexedDB rather than localStorage because of those bytes, and because a
 * dissertation's worth of prose is past what localStorage is meant to carry.
 */

export type ProjectFile = string | Uint8Array;

/** A file's name is its path: `chapters/intro.tex`, `figures/plot.pdf`. */
export type ProjectFiles = Map<string, ProjectFile>;

export const DEFAULT_ENTRY = "main.tex";

/**
 * Where the root document's name is kept.
 *
 * A leading space, because no filename the engine will ever be given starts
 * with one — so this cannot collide with a real file in the same store.
 */
const ENTRY_KEY = " entry";

export async function loadProject(): Promise<{ files: ProjectFiles; entry: string }> {
  const db = await openLatexDb();

  const stored = await runTx(db, [PROJECT], "readonly", (tx) => {
    const map: ProjectFiles = new Map();
    const cursor = tx.objectStore(PROJECT).openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return;
      map.set(String(c.key), c.value as ProjectFile);
      c.continue();
    };
    return map;
  });

  db.close();

  const entryValue = stored.get(ENTRY_KEY);
  stored.delete(ENTRY_KEY);
  const entry = typeof entryValue === "string" ? entryValue : DEFAULT_ENTRY;

  // Falling back when the recorded root has been deleted: compiling against a
  // file that is not there fails in a way that looks like an engine fault.
  return { files: stored, entry: stored.has(entry) ? entry : DEFAULT_ENTRY };
}

export async function saveFile(name: string, contents: ProjectFile): Promise<void> {
  const db = await openLatexDb();
  await runTx(db, [PROJECT], "readwrite", (tx) =>
    tx.objectStore(PROJECT).put(contents, name),
  );
  db.close();
}

export async function deleteFile(name: string): Promise<void> {
  const db = await openLatexDb();
  await runTx(db, [PROJECT], "readwrite", (tx) => tx.objectStore(PROJECT).delete(name));
  db.close();
}

export async function renameFile(from: string, to: string): Promise<void> {
  const db = await openLatexDb();
  await runTx(db, [PROJECT], "readwrite", (tx) => {
    const store = tx.objectStore(PROJECT);
    const read = store.get(from);
    read.onsuccess = () => {
      if (read.result === undefined) return;
      store.put(read.result, to);
      store.delete(from);
    };
  });
  db.close();
}

export async function setEntry(entry: string): Promise<void> {
  await saveFile(ENTRY_KEY, entry);
}

/** Text files can be edited; everything else is carried, not opened. */
export function isEditable(name: string): boolean {
  return /\.(tex|bib|cls|sty|txt|md|csv)$/i.test(name);
}

export function isText(value: ProjectFile): value is string {
  return typeof value === "string";
}

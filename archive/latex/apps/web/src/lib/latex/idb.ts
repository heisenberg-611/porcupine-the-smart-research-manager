/**
 * The one IndexedDB the LaTeX studio uses, opened in one place.
 *
 * Two stores wanted the same database and that is a trap: an `indexedDB.open`
 * with a lower version than the database already has fails outright, so two
 * modules each opening "Porcupine-latex" at their own version would work until
 * one of them was bumped and then break the other permanently. Every store the
 * studio needs is created here, under one version.
 */

const DB_NAME = "Porcupine-latex";
const DB_VERSION = 2;

/** Uploaded TeX package bytes, keyed by the name TeX asks for. */
export const FILES = "files";
/** Name, size and age for each uploaded package. */
export const META = "meta";
/** The user's own document: every file in the project, keyed by path. */
export const PROJECT = "project";

/**
 * Open for writing, creating or upgrading the stores.
 *
 * Only the page does this. See `openLatexDbForReading` for why the worker
 * must not.
 */
export function openLatexDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of [FILES, META, PROJECT]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB refused"));
  });
}

/**
 * Open whatever version already exists, without asking for one.
 *
 * The compile worker only READS. Naming a version there is not merely
 * unnecessary, it is a bug waiting for a schema change: the worker is built by
 * a separate esbuild step, so a stale bundle can outlive the page that
 * upgraded the database, and `indexedDB.open` with a version lower than the
 * stored one fails outright — "The requested version (1) is less than the
 * existing version (2)", reported to the user as a compiler error, which it
 * is not.
 *
 * Omitting the version opens the current one whatever it is, and can never
 * trigger an upgrade or a downgrade error. A reader that finds a store missing
 * treats it as empty, which is the truth.
 */
export function openLatexDbForReading(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB refused"));
  });
}

export function runTx<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const result = work(tx);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

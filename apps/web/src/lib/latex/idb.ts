/**
 * The one IndexedDB the LaTeX studio uses, opened in one place.
 *
 * Two stores wanted the same database and that is a trap: an `indexedDB.open`
 * with a lower version than the database already has fails outright, so two
 * modules each opening "porcupine-latex" at their own version would work until
 * one of them was bumped and then break the other permanently. Every store the
 * studio needs is created here, under one version.
 */

const DB_NAME = "porcupine-latex";
const DB_VERSION = 2;

/** Uploaded TeX package bytes, keyed by the name TeX asks for. */
export const FILES = "files";
/** Name, size and age for each uploaded package. */
export const META = "meta";
/** The user's own document: every file in the project, keyed by path. */
export const PROJECT = "project";

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

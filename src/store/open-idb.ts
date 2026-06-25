// Shared guarded IndexedDB opener. Every store in this app needs two safeguards
// around indexedDB.open, or a version upgrade can hang the app:
//  - an OPEN TIMEOUT: if a stale tab (running older code, holding an old-version
//    connection) blocks the upgrade, fail the op instead of hanging every caller
//    forever. The cache is reset so a later call retries once the old tab is gone.
//  - db.onversionchange CLOSE: this connection closes itself when another tab
//    needs to upgrade, so this tab never becomes the one that blocks the upgrade.
//
// Returns a self-caching opener: each call reuses the live connection, but a
// timeout / error / versionchange clears the cache so the next call reopens.

const DEFAULT_OPEN_TIMEOUT_MS = 4000;

export function createDbOpener(opts: {
  dbName: string;
  version: number;
  // Runs on upgradeneeded; create/keep the object stores here.
  upgrade: (db: IDBDatabase) => void;
  timeoutMs?: number;
}): () => Promise<IDBDatabase> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
  let dbPromise: Promise<IDBDatabase> | null = null;

  return function open(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        if (dbPromise === attempt) dbPromise = null; // let a later call retry
        reject(
          new Error(
            `IndexedDB open timed out for "${opts.dbName}" (an old tab may be blocking an upgrade)`,
          ),
        );
      }, timeoutMs);

      const req = indexedDB.open(opts.dbName, opts.version);
      req.onupgradeneeded = () => opts.upgrade(req.result);
      req.onblocked = () =>
        console.warn(
          `IndexedDB: upgrade of "${opts.dbName}" blocked by another open tab`,
        );
      req.onsuccess = () => {
        clearTimeout(timer);
        const db = req.result;
        if (timedOut) {
          db.close(); // the open already rejected; a retry owns the connection now
          return;
        }
        // Never be the tab that blocks a future upgrade.
        db.onversionchange = () => {
          db.close();
          if (dbPromise === attempt) dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        clearTimeout(timer);
        if (dbPromise === attempt) dbPromise = null;
        reject(req.error);
      };
    });
    dbPromise = attempt;
    return attempt;
  };
}

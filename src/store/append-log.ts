// Append-only IDB log for the pixel log. Rows live in an auto-increment
// object store ("rows", db version 2), so a flush writes only the new rows of
// that stroke — the previous format rewrote the entire array (up to 100k
// rows) under one key on every stroke. Like store/indexeddb.ts, nothing
// outside this file should know about the IDB API.

const DB_NAME = "nekudot-pixel-log";
const DB_VERSION = 2; // v1: single "log" store holding the whole array
const ROWS_STORE = "rows";
const LEGACY_STORE = "log";
const LEGACY_KEY = "entries";
// The v1→v2 upgrade is blocked for as long as a tab running the old code
// holds its v1 connection. Rather than hang every caller forever, fail the
// op after this long; the cached promise is reset, so a later op retries
// (and succeeds once the old tab is gone).
const OPEN_TIMEOUT_MS = 4000;

export class AppendLogStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    const attempt = new Promise<IDBDatabase>((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        if (this.dbPromise === attempt) this.dbPromise = null; // retry later
        reject(new Error("pixel log open timed out (old tab blocking the upgrade?)"));
      }, OPEN_TIMEOUT_MS);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // Keep the legacy store: load() adopts its array, then deletes the key.
        if (!db.objectStoreNames.contains(LEGACY_STORE)) {
          db.createObjectStore(LEGACY_STORE);
        }
        if (!db.objectStoreNames.contains(ROWS_STORE)) {
          db.createObjectStore(ROWS_STORE, { autoIncrement: true });
        }
      };
      req.onblocked = () => {
        console.warn("pixel log: upgrade blocked by another open tab");
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        const db = req.result;
        if (timedOut) {
          db.close(); // a retry owns the connection now
          return;
        }
        // Never be the tab that blocks a future upgrade.
        db.onversionchange = () => {
          db.close();
          if (this.dbPromise === attempt) this.dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        clearTimeout(timer);
        if (this.dbPromise === attempt) this.dbPromise = null;
        reject(req.error);
      };
    });
    this.dbPromise = attempt;
    return attempt;
  }

  // Run `fn` inside one readwrite transaction over `stores`; resolves on
  // commit, so a multi-store migration/replace is all-or-nothing.
  private async write(
    stores: string[],
    fn: (tx: IDBTransaction) => void,
  ): Promise<void> {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, "readwrite");
      fn(tx);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // All rows in insertion order. An empty rows store falls back to the legacy
  // whole-array key, adopting it (rows written + key deleted, atomically).
  async load(): Promise<unknown[]> {
    const db = await this.openDb();
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const req = db
        .transaction(ROWS_STORE, "readonly")
        .objectStore(ROWS_STORE)
        .getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (rows.length > 0) return rows;

    const legacy = await new Promise<unknown>((resolve, reject) => {
      const req = db
        .transaction(LEGACY_STORE, "readonly")
        .objectStore(LEGACY_STORE)
        .get(LEGACY_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!Array.isArray(legacy) || legacy.length === 0) return [];
    await this.write([ROWS_STORE, LEGACY_STORE], (tx) => {
      const rowsStore = tx.objectStore(ROWS_STORE);
      for (const row of legacy) rowsStore.add(row);
      tx.objectStore(LEGACY_STORE).delete(LEGACY_KEY);
    });
    return legacy;
  }

  // Append rows; in the same transaction, drop the oldest rows beyond `max`
  // (walk a key cursor to the last key to evict, ranged-delete up to it).
  async append(rows: unknown[], max: number): Promise<void> {
    if (rows.length === 0) return;
    return this.write([ROWS_STORE], (tx) => {
      const store = tx.objectStore(ROWS_STORE);
      for (const row of rows) store.add(row);
      const countReq = store.count(); // runs after the adds, so it sees them
      countReq.onsuccess = () => {
        const excess = countReq.result - max;
        if (excess <= 0) return;
        let toSkip = excess - 1;
        const cursorReq = store.openKeyCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          if (toSkip > 0) {
            const n = toSkip;
            toSkip = 0;
            cursor.advance(n);
            return;
          }
          store.delete(IDBKeyRange.upperBound(cursor.key));
        };
      };
    });
  }

  // Swap the whole log (loaded .nekudot): clear + re-add + drop any legacy
  // key in one transaction.
  async replaceAll(rows: unknown[]): Promise<void> {
    return this.write([ROWS_STORE, LEGACY_STORE], (tx) => {
      const rowsStore = tx.objectStore(ROWS_STORE);
      rowsStore.clear();
      for (const row of rows) rowsStore.add(row);
      tx.objectStore(LEGACY_STORE).delete(LEGACY_KEY);
    });
  }

  async clear(): Promise<void> {
    return this.write([ROWS_STORE, LEGACY_STORE], (tx) => {
      tx.objectStore(ROWS_STORE).clear();
      tx.objectStore(LEGACY_STORE).delete(LEGACY_KEY);
    });
  }
}

// Append-only IDB store for the event log (P1.2): a close clone of
// store/append-log.ts MINUS head-eviction - the event log is process truth, so
// dropping its oldest rows would corrupt replay. It never evicts; count() lets a
// caller warn near a size threshold. New db nekudot-events; readRange/truncateFrom
// land with their Phase 2/4 consumers.

import { createDbOpener } from "../store/open-idb";

const DB_NAME = "nekudot-events";
const DB_VERSION = 1;
const ROWS_STORE = "events";
const OPEN_TIMEOUT_MS = 4000;

// What the recorder needs from persistence; EventLogStore in the app, a fake in
// tests. Rows are opaque here - validation is the schema's job on decode.
export type EventLogBackend = {
  append(rows: unknown[]): Promise<void>;
  load(): Promise<unknown[]>;
  count(): Promise<number>;
  clear(): Promise<void>;
  replaceAll(rows: unknown[]): Promise<void>;
};

export class EventLogStore implements EventLogBackend {
  private readonly open = createDbOpener({
    dbName: DB_NAME,
    version: DB_VERSION,
    timeoutMs: OPEN_TIMEOUT_MS,
    upgrade: (db) => {
      if (!db.objectStoreNames.contains(ROWS_STORE)) {
        db.createObjectStore(ROWS_STORE, { autoIncrement: true });
      }
    },
  });

  // Optional flush-stall meter (P1.3 telemetry): the synchronous main-thread cost
  // of a batch is the IDB structured-clone at store.add(), so it's timed HERE (the
  // recorder can't see it - store.add runs after an awaited db-open, off the
  // recorder's synchronous span). Left unset in tests / when telemetry is off.
  private readonly onWriteCost?: (syncMs: number, rows: number) => void;

  constructor(opts?: { onWriteCost?: (syncMs: number, rows: number) => void }) {
    this.onWriteCost = opts?.onWriteCost;
  }

  private async write(fn: (tx: IDBTransaction) => void): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(ROWS_STORE, "readwrite");
      fn(tx);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // Append rows in insertion order. No eviction - the log is append-only truth.
  // The add() loop is where IDB structured-clones each row on the main thread, so
  // it's the flush's real stall; the meter times exactly that span.
  async append(rows: unknown[]): Promise<void> {
    if (rows.length === 0) return;
    const meter = this.onWriteCost;
    return this.write((tx) => {
      const store = tx.objectStore(ROWS_STORE);
      const t0 = meter ? performance.now() : 0;
      for (const row of rows) store.add(row);
      if (meter) meter(performance.now() - t0, rows.length);
    });
  }

  async load(): Promise<unknown[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(ROWS_STORE, "readonly").objectStore(ROWS_STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async count(): Promise<number> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(ROWS_STORE, "readonly").objectStore(ROWS_STORE).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async clear(): Promise<void> {
    return this.write((tx) => tx.objectStore(ROWS_STORE).clear());
  }

  // Swap the whole log (a loaded .nekudot): clear + re-add in one transaction.
  async replaceAll(rows: unknown[]): Promise<void> {
    return this.write((tx) => {
      const store = tx.objectStore(ROWS_STORE);
      store.clear();
      for (const row of rows) store.add(row);
    });
  }
}

// Low-level IndexedDB wrapper. Callers (e.g. PaintStore) use this; nothing
// outside this file should know about the IDB API. Opening goes through the
// shared guarded opener (open-idb.ts) so a stale tab can't hang an upgrade.

import { createDbOpener } from "./open-idb";

export type BatchOp =
  | { type: "put"; key: string; value: unknown }
  | { type: "delete"; key: string };

export class IndexedDbStore {
  private readonly open: () => Promise<IDBDatabase>;

  constructor(
    dbName: string,
    private readonly storeName: string,
    version: number = 1,
  ) {
    this.open = createDbOpener({
      dbName,
      version,
      upgrade: (db) => {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      },
    });
  }

  async get<T>(key: string): Promise<T | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readonly");
      const req = tx.objectStore(this.storeName).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async put(key: string, value: unknown): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const req = tx.objectStore(this.storeName).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async delete(key: string): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const req = tx.objectStore(this.storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Apply several puts/deletes in one transaction: all land or none do, and
  // readers never observe a half-applied group.
  async batch(ops: readonly BatchOp[]): Promise<void> {
    if (ops.length === 0) return;
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, "readwrite");
      const store = tx.objectStore(this.storeName);
      for (const op of ops) {
        if (op.type === "put") store.put(op.value, op.key);
        else store.delete(op.key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
}

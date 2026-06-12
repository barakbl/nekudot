import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { AppendLogStore } from "../src/store/append-log";

// Real IDB semantics via fake-indexeddb: auto-increment append, in-transaction
// trim, and the v1 (whole-array "entries" key) → v2 (rows store) migration.

const g = globalThis as { indexedDB?: unknown; IDBKeyRange?: unknown };
g.IDBKeyRange = IDBKeyRange;
beforeEach(() => {
  g.indexedDB = new IDBFactory(); // fresh databases per test
});

// Create the db as the OLD code did: version 1, one "log" store, the whole
// array under the "entries" key.
async function seedLegacy(rows: unknown[]): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = (g.indexedDB as IDBFactory).open("nekudot-pixel-log", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("log");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("log", "readwrite");
    tx.objectStore("log").put(rows, "entries");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

const row = (n: number) => ({ n });
const ns = (rows: unknown[]) => rows.map((r) => (r as { n: number }).n);

describe("AppendLogStore", () => {
  it("starts empty and appends in order across instances", async () => {
    const store = new AppendLogStore();
    expect(await store.load()).toEqual([]);
    await store.append([row(1), row(2)], 100);
    await store.append([row(3)], 100);
    expect(ns(await new AppendLogStore().load())).toEqual([1, 2, 3]);
  });

  it("trims the oldest rows beyond max, atomically with the append", async () => {
    const store = new AppendLogStore();
    await store.append([row(1), row(2), row(3)], 5);
    await store.append([row(4), row(5), row(6), row(7)], 5);
    expect(ns(await new AppendLogStore().load())).toEqual([3, 4, 5, 6, 7]);
    // Trim by exactly one (the excess-1 cursor walk's edge case).
    await store.append([row(8)], 5);
    expect(ns(await new AppendLogStore().load())).toEqual([4, 5, 6, 7, 8]);
  });

  it("adopts a legacy v1 whole-array log and deletes the old key", async () => {
    await seedLegacy([row(1), row(2)]);
    const store = new AppendLogStore();
    expect(ns(await store.load())).toEqual([1, 2]);
    // The adopted rows are real rows now: appends stack on top of them, and a
    // fresh load no longer consults the legacy key.
    await store.append([row(3)], 100);
    expect(ns(await new AppendLogStore().load())).toEqual([1, 2, 3]);
  });

  it("replaceAll swaps the whole log and clear empties it", async () => {
    await seedLegacy([row(9)]);
    const store = new AppendLogStore();
    await store.replaceAll([row(1), row(2)]);
    // replaceAll also dropped the legacy key — nothing resurfaces.
    expect(ns(await new AppendLogStore().load())).toEqual([1, 2]);
    await store.clear();
    expect(await new AppendLogStore().load()).toEqual([]);
  });
});

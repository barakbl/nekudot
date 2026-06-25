import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createDbOpener } from "../src/store/open-idb";

// Real IDB semantics via fake-indexeddb, including the versionchange/blocked
// events the guard depends on. Fresh databases per test.
const g = globalThis as { indexedDB?: unknown };
beforeEach(() => {
  g.indexedDB = new IDBFactory();
});
const factory = () => g.indexedDB as IDBFactory;

// Open a raw connection (bypassing the opener) to play the role of "another tab".
function rawOpen(
  name: string,
  version: number,
  upgrade: (db: IDBDatabase) => void,
  onBlocked?: () => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory().open(name, version);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    if (onBlocked) req.onblocked = onBlocked;
  });
}

describe("createDbOpener", () => {
  it("caches the connection and runs the upgrade once", async () => {
    let upgrades = 0;
    const open = createDbOpener({
      dbName: "t",
      version: 1,
      upgrade: (db) => {
        upgrades++;
        db.createObjectStore("s");
      },
    });

    const a = await open();
    const b = await open();

    expect(a).toBe(b); // same cached connection
    expect(upgrades).toBe(1);
    expect(a.objectStoreNames.contains("s")).toBe(true);
  });

  it("closes on versionchange so it never blocks another tab's upgrade", async () => {
    const open = createDbOpener({
      dbName: "t",
      version: 1,
      upgrade: (db) => db.createObjectStore("s"),
    });
    await open(); // our connection holds v1 open

    // Another tab upgrades to v2. Without the onversionchange-close, our open
    // connection would block it (the v2 open would fire onblocked and hang).
    const db2 = await rawOpen(
      "t",
      2,
      (db) => db.createObjectStore("s2"),
      () => {
        throw new Error("upgrade was blocked - the guard did not close on versionchange");
      },
    );

    expect(db2.version).toBe(2);
    expect(db2.objectStoreNames.contains("s2")).toBe(true);
    db2.close();
  });

  it("times out when a stale connection blocks the upgrade, then a retry succeeds", async () => {
    // A stale tab: a v1 connection that ignores versionchange (no handler), so it
    // keeps blocking a v2 upgrade.
    const stale = await rawOpen("t", 1, (db) => db.createObjectStore("s"));

    const open = createDbOpener({
      dbName: "t",
      version: 2,
      timeoutMs: 50,
      upgrade: (db) => db.createObjectStore("s2"),
    });

    await expect(open()).rejects.toThrow(/timed out/);

    // Once the stale tab is gone the cache has been reset, so a retry reopens.
    stale.close();
    const db = await open();
    expect(db.version).toBe(2);
    db.close();
  });
});

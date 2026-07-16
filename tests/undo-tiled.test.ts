import { describe, it, expect, beforeEach } from "vitest";

import type { BatchOp } from "../src/store/indexeddb";
import {
  type StoredBase,
  type StoredChain,
  type StoredEntry,
  type TiledBackend,
  TiledUndoStore,
} from "../src/store/undo-tiled";

class FakeBackend implements TiledBackend {
  store = new Map<string, unknown>();
  batches: BatchOp[][] = [];
  failNext = false;
  async get<T>(key: string) {
    return (this.store.get(key) as T | undefined) ?? null;
  }
  async batch(ops: readonly BatchOp[]) {
    this.batches.push([...ops]);
    if (this.failNext) {
      this.failNext = false;
      throw new Error("batch boom");
    }
    for (const op of ops) {
      if (op.type === "put") this.store.set(op.key, op.value);
      else this.store.delete(op.key);
    }
  }
  keys(re: RegExp) {
    return [...this.store.keys()].filter((k) => re.test(k)).sort();
  }
}

const blob = (s: string) => new Blob([s]);
const base = (id = 0): StoredBase => ({
  id,
  config: { base: id },
  layers: [{ layerId: "L0", blob: blob(`base${id}`), w: 512, h: 512 }],
  clouds: [{ mapId: "m", points: [] }],
});
const entry = (id: number): StoredEntry => ({
  id,
  config: { c: id },
  patches: [{ layerId: "L0", rect: { x: 0, y: 0, w: 256, h: 256 }, blob: blob(`e${id}`), full: false }],
  mapOps: [{ mapId: "m", op: "add", points: [{ x: id, y: id }] }],
  bytes: 10,
});
const chain = (entries: StoredEntry[], pointer: number, b = base()): StoredChain => ({
  epoch: { cssW: 256, cssH: 256, dpr: 2 },
  pointer,
  base: b,
  entries,
});

const puts = (ops: BatchOp[]) => ops.filter((o) => o.type === "put").map((o) => o.key);
const dels = (ops: BatchOp[]) => ops.filter((o) => o.type === "delete").map((o) => o.key);

describe("TiledUndoStore", () => {
  let backend: FakeBackend;
  beforeEach(() => {
    backend = new FakeBackend();
  });

  it("round-trips a chain through a fresh reader", async () => {
    await new TiledUndoStore(backend).save(chain([entry(1), entry(2)], 2));
    const loaded = await new TiledUndoStore(backend).load();
    expect(loaded?.pointer).toBe(2);
    expect(loaded?.epoch).toEqual({ cssW: 256, cssH: 256, dpr: 2 });
    expect(loaded?.base.id).toBe(0);
    expect(loaded?.entries.map((e) => e.id)).toEqual([1, 2]);
    expect(loaded?.entries[0].mapOps).toEqual([{ mapId: "m", op: "add", points: [{ x: 1, y: 1 }] }]);
  });

  it("only writes new entries on an incremental save", async () => {
    const store = new TiledUndoStore(backend);
    await store.save(chain([entry(1)], 1));
    backend.batches = [];
    await store.save(chain([entry(1), entry(2)], 2));
    expect(puts(backend.batches[0])).toEqual(["entry:2", "meta2"]); // not entry:1 again
  });

  it("deletes rows evicted from the chain", async () => {
    const store = new TiledUndoStore(backend);
    const [e1, e2, e3] = [entry(1), entry(2), entry(3)];
    await store.save(chain([e1, e2], 2));
    backend.batches = [];
    await store.save(chain([e2, e3], 2));
    expect(dels(backend.batches[0])).toContain("entry:1");
    expect(puts(backend.batches[0])).toContain("entry:3");
  });

  it("load returns null when an entry row is missing", async () => {
    await new TiledUndoStore(backend).save(chain([entry(1)], 1));
    backend.store.delete("entry:1");
    expect(await new TiledUndoStore(backend).load()).toBeNull();
  });

  it("load returns null for absent or foreign meta", async () => {
    expect(await new TiledUndoStore(backend).load()).toBeNull();
    backend.store.set("meta2", { version: 1, pointer: 0 });
    expect(await new TiledUndoStore(backend).load()).toBeNull();
  });

  it("commits ids only after the tx succeeds, retrying on the next save", async () => {
    const store = new TiledUndoStore(backend);
    await store.save(chain([entry(1)], 1));
    backend.failNext = true;
    await store.save(chain([entry(1), entry(2)], 2)); // batch throws, caught
    expect(backend.store.has("entry:2")).toBe(false);
    backend.batches = [];
    await store.save(chain([entry(1), entry(2)], 2)); // retry
    expect(puts(backend.batches[0])).toContain("entry:2"); // entry:2 re-attempted
    expect(backend.store.has("entry:2")).toBe(true);
  });

  it("clear wipes v2 keys and never touches v1 keys", async () => {
    backend.store.set("meta", { version: 1 }); // v1 rollback artifact
    backend.store.set("row:0", { paint: true });
    const store = new TiledUndoStore(backend);
    await store.save(chain([entry(1), entry(2)], 2));
    await store.clear();
    expect(backend.keys(/^(meta2|base:|entry:)/)).toEqual([]);
    expect(backend.store.has("meta")).toBe(true);
    expect(backend.store.has("row:0")).toBe(true);
  });
});

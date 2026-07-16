import { describe, it, expect, beforeEach } from "vitest";

import type { BatchOp } from "../src/store/indexeddb";
import { ShadowKeyframeStore } from "../src/store/shadow-keyframe";
import { UndoStore } from "../src/store/undo";
import { TiledUndoStore, type StoredChain } from "../src/store/undo-tiled";
import type { UndoSnapshot, UndoStateData } from "../src/undo";

// A shared in-memory backend that is BOTH a v1 (UndoStore) and v2 (TiledUndoStore)
// backend - they key into the same "stacks" store in the real app, so testing them
// against one Map is exactly the rollback scenario.
class FakeBackend {
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
}

// A distinct UndoSnapshot object per label (identity is what UndoStore diffs on).
const snap = (label: string): UndoSnapshot =>
  ({
    config: { tag: label } as unknown as UndoSnapshot["config"],
    paint: { version: 2, layers: [], neighborsMaps: [] },
    description: label,
  }) as UndoSnapshot;

const state = (stack: UndoSnapshot[], pointer: number): UndoStateData<UndoSnapshot> => ({
  stack,
  pointer,
});

describe("ShadowKeyframeStore", () => {
  let backend: FakeBackend;
  beforeEach(() => {
    backend = new FakeBackend();
  });

  it("persists ONLY the pointer snapshot as a 1-deep v1 stack", async () => {
    const [a, b, c] = [snap("a"), snap("b"), snap("c")];
    const store = new ShadowKeyframeStore(backend, 10_000);
    await store.save(state([a, b, c], 1)); // pointer on b
    await store.flush();
    // A rolled-back build's UndoStore reads it back as a single-entry stack.
    const loaded = await new UndoStore<UndoSnapshot>(backend).load();
    expect(loaded?.pointer).toBe(0);
    expect(loaded?.stack).toHaveLength(1);
    expect(loaded?.stack[0]).toBe(b);
    expect(backend.store.get("meta")).toMatchObject({ version: 1, pointer: 0 });
  });

  it("debounces: save() alone writes nothing; flush() commits the latest pointer", async () => {
    const [a, b] = [snap("a"), snap("b")];
    const store = new ShadowKeyframeStore(backend, 10_000);
    await store.save(state([a], 0));
    await store.save(state([a, b], 1)); // supersedes before any write lands
    expect(backend.store.has("meta")).toBe(false); // nothing yet (timer not fired)
    await store.flush();
    const loaded = await new UndoStore<UndoSnapshot>(backend).load();
    expect(loaded?.stack[0]).toBe(b); // only the last state persisted
    expect(backend.batches).toHaveLength(1); // one coalesced write
  });

  it("swaps the row when the pointer moves, leaving exactly one keyframe row", async () => {
    const [a, b] = [snap("a"), snap("b")];
    const store = new ShadowKeyframeStore(backend, 10_000);
    await store.save(state([a, b], 0));
    await store.flush();
    await store.save(state([a, b], 1));
    await store.flush();
    const rowKeys = [...backend.store.keys()].filter((k) => k.startsWith("row:"));
    expect(rowKeys).toHaveLength(1); // the old keyframe row was deleted
    const loaded = await new UndoStore<UndoSnapshot>(backend).load();
    expect(loaded?.stack[0]).toBe(b);
  });

  it("flush is idempotent and a no-op with nothing pending", async () => {
    const store = new ShadowKeyframeStore(backend, 10_000);
    await store.flush(); // nothing pending
    expect(backend.batches).toHaveLength(0);
    await store.save(state([snap("a")], 0));
    await store.flush();
    await store.flush(); // second flush writes nothing more
    expect(backend.batches).toHaveLength(1);
  });

  it("clear wipes the v1 keys", async () => {
    const store = new ShadowKeyframeStore(backend, 10_000);
    await store.save(state([snap("a")], 0));
    await store.flush();
    await store.clear();
    expect(backend.store.has("meta")).toBe(false);
    expect([...backend.store.keys()].some((k) => k.startsWith("row:"))).toBe(false);
  });

  it("adopts a pre-migration N-deep v1 stack on load (first on-mode boot)", async () => {
    // A prior shadow/off session left a full stack under the v1 keys.
    const [a, b, c] = [snap("a"), snap("b"), snap("c")];
    await new UndoStore<UndoSnapshot>(backend).save(state([a, b, c], 2));
    const loaded = await new ShadowKeyframeStore(backend, 10_000).load();
    expect(loaded?.stack).toHaveLength(3); // reads the full stack, so migration can adopt the tip
    expect(loaded?.pointer).toBe(2);
  });
});

describe("rollback: v1 code reads a v2 DB", () => {
  it("a plain UndoStore restores the shadow keyframe and ignores meta2", async () => {
    const backend = new FakeBackend();
    // New code writes the v2 delta chain...
    const chain: StoredChain = {
      epoch: { cssW: 256, cssH: 256, dpr: 1 },
      pointer: 1,
      base: {
        id: 0,
        config: { tag: "base" },
        layers: [{ layerId: "L0", blob: new Blob(["b"]), w: 256, h: 256 }],
        clouds: [],
      },
      folded: [],
      entries: [
        {
          id: 1,
          config: { tag: "e1" },
          patches: [],
          mapOps: [],
          bytes: 4,
        },
      ],
    };
    await new TiledUndoStore(backend).save(chain);
    // ...and the 1-deep shadow keyframe under the OLD keys.
    const tip = snap("tip");
    const shadow = new ShadowKeyframeStore(backend, 10_000);
    await shadow.save(state([snap("older"), tip], 1));
    await shadow.flush();

    // A rolled-back build (plain v1 UndoStore) must restore the keyframe, unaware of
    // meta2, without throwing.
    const rolledBack = await new UndoStore<UndoSnapshot>(backend).load();
    expect(rolledBack?.stack).toHaveLength(1);
    expect(rolledBack?.stack[0]).toBe(tip);
    expect(backend.store.has("meta2")).toBe(true); // v2 rows untouched, just ignored
  });

  it("a failed v2 migration write leaves the v1 keyframe fully intact", async () => {
    const backend = new FakeBackend();
    // A prior session's v1 stack is the rollback artifact / migration source.
    const [older, tip] = [snap("older"), snap("tip")];
    await new UndoStore<UndoSnapshot>(backend).save(state([older, tip], 1));
    // The migration's v2 write throws (quota etc): meta2 must NOT land...
    backend.failNext = true;
    await new TiledUndoStore(backend).save({
      epoch: { cssW: 256, cssH: 256, dpr: 1 },
      pointer: 0,
      base: { id: 0, config: {}, layers: [], clouds: [] },
      folded: [],
      entries: [],
    });
    expect(backend.store.has("meta2")).toBe(false);
    // ...and the untouched v1 stack still restores the pointer paint.
    const stillThere = await new UndoStore<UndoSnapshot>(backend).load();
    expect(stillThere?.stack).toHaveLength(2);
    expect(stillThere?.stack[1]).toBe(tip);
  });
});

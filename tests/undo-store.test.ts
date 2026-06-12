import { describe, it, expect, beforeEach } from "vitest";
import { UndoStore, type UndoStoreBackend } from "../src/store/undo";
import type { BatchOp } from "../src/store/indexeddb";

// In-memory backend recording each batch, so the tests can assert exactly
// what a save writes (the whole point of the incremental store: a push is
// one row put + one meta put, undo/redo are meta-only).
class FakeBackend implements UndoStoreBackend {
  data = new Map<string, unknown>();
  batches: BatchOp[][] = [];
  failNextBatch = false;

  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T | undefined) ?? null;
  }

  async batch(ops: readonly BatchOp[]): Promise<void> {
    if (this.failNextBatch) {
      this.failNextBatch = false;
      throw new Error("quota boom");
    }
    // Atomic by construction: applied all at once after the throw point.
    for (const op of ops) {
      if (op.type === "put") this.data.set(op.key, op.value);
      else this.data.delete(op.key);
    }
    this.batches.push([...ops]);
  }

  lastBatch(): BatchOp[] {
    return this.batches[this.batches.length - 1] ?? [];
  }

  keys(): string[] {
    return [...this.data.keys()].sort();
  }
}

type Snap = { description: string };
const snap = (description: string): Snap => ({ description });

const meta = (backend: FakeBackend) =>
  backend.data.get("meta") as { pointer: number; rowIds: number[] };

describe("UndoStore incremental persistence", () => {
  let backend: FakeBackend;
  let store: UndoStore<Snap>;
  beforeEach(() => {
    backend = new FakeBackend();
    store = new UndoStore<Snap>(backend);
  });

  it("a push-shaped save writes one row + meta", async () => {
    const a = snap("a");
    await store.save({ stack: [a], pointer: 0 });
    expect(backend.lastBatch().map((op) => [op.type, op.key])).toEqual([
      ["put", "row:0"],
      ["put", "meta"],
    ]);
    expect(meta(backend)).toMatchObject({ pointer: 0, rowIds: [0] });
  });

  it("a pointer-only save (undo/redo) writes just the meta row", async () => {
    const stack = [snap("a"), snap("b")];
    await store.save({ stack, pointer: 1 });
    await store.save({ stack, pointer: 0 }); // undo
    expect(backend.lastBatch().map((op) => [op.type, op.key])).toEqual([
      ["put", "meta"],
    ]);
    expect(meta(backend).pointer).toBe(0);
  });

  it("eviction and redo-branch truncation delete the dropped rows", async () => {
    const [a, b, c, d] = [snap("a"), snap("b"), snap("c"), snap("d")];
    await store.save({ stack: [a, b, c], pointer: 2 });
    // Undo twice then push d: b and c leave the stack.
    await store.save({ stack: [a, d], pointer: 1 });
    const ops = backend.lastBatch().map((op) => [op.type, op.key]);
    expect(ops).toContainEqual(["delete", "row:1"]);
    expect(ops).toContainEqual(["delete", "row:2"]);
    expect(ops).toContainEqual(["put", "row:3"]);
    expect(meta(backend)).toMatchObject({ pointer: 1, rowIds: [0, 3] });
    expect(backend.keys()).toEqual(["meta", "row:0", "row:3"]);
  });

  it("load reconstructs the stack and later saves diff against it", async () => {
    await store.save({ stack: [snap("a"), snap("b")], pointer: 1 });

    const reopened = new UndoStore<Snap>(backend);
    const loaded = await reopened.load();
    expect(loaded?.pointer).toBe(1);
    expect(loaded?.stack.map((s) => s.description)).toEqual(["a", "b"]);

    // Pushing onto the loaded stack must not rewrite the existing rows, and
    // new ids must not collide with theirs.
    const c = snap("c");
    await reopened.save({ stack: [...loaded!.stack, c], pointer: 2 });
    expect(backend.lastBatch().map((op) => [op.type, op.key])).toEqual([
      ["put", "row:2"],
      ["put", "meta"],
    ]);
    expect(meta(backend)).toMatchObject({ pointer: 2, rowIds: [0, 1, 2] });
  });

  it("load returns null when a row referenced by meta is missing", async () => {
    await store.save({ stack: [snap("a"), snap("b")], pointer: 1 });
    backend.data.delete("row:0");
    expect(await new UndoStore<Snap>(backend).load()).toBeNull();
  });

  it("migrates the legacy whole-stack format to rows and deletes it", async () => {
    backend.data.set("stack", {
      stack: [snap("old-a"), snap("old-b")],
      pointer: 0,
    });
    const loaded = await store.load();
    expect(loaded?.pointer).toBe(0);
    expect(loaded?.stack.map((s) => s.description)).toEqual(["old-a", "old-b"]);
    expect(backend.keys()).toEqual(["meta", "row:0", "row:1"]);
    expect(meta(backend)).toMatchObject({ pointer: 0, rowIds: [0, 1] });

    // The migrated rows are known to the store: a pointer move is meta-only.
    await store.save({ stack: loaded!.stack, pointer: 1 });
    expect(backend.lastBatch().map((op) => [op.type, op.key])).toEqual([
      ["put", "meta"],
    ]);
  });

  it("a failed write is retried by the next save (nothing half-recorded)", async () => {
    const a = snap("a");
    backend.failNextBatch = true;
    await store.save({ stack: [a], pointer: 0 }); // swallowed, like today
    expect(backend.keys()).toEqual([]);

    const b = snap("b");
    await store.save({ stack: [a, b], pointer: 1 });
    // Both rows land: the store didn't mark `a` as stored on the failure
    // (and since the failed batch wrote nothing, reusing its ids is safe).
    expect(backend.keys()).toEqual(["meta", "row:0", "row:1"]);
    expect(meta(backend)).toMatchObject({ pointer: 1, rowIds: [0, 1] });
  });

  it("clear deletes the rows, the meta and any legacy key", async () => {
    backend.data.set("stack", { legacy: true });
    await store.save({ stack: [snap("a"), snap("b")], pointer: 1 });
    await store.clear();
    expect(backend.keys()).toEqual([]);

    // And the store keeps working after a clear.
    await store.save({ stack: [snap("c")], pointer: 0 });
    expect(meta(backend).rowIds).toHaveLength(1);
  });

  it("saves run in call order even when issued back-to-back", async () => {
    const stack = [snap("a")];
    const p1 = store.save({ stack, pointer: 0 });
    const p2 = store.save({ stack: [...stack, snap("b")], pointer: 1 });
    await Promise.all([p1, p2]);
    expect(meta(backend).pointer).toBe(1);
    expect(backend.keys()).toEqual(["meta", "row:0", "row:1"]);
  });
});

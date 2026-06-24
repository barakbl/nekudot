import { IndexedDbStore, type BatchOp } from "./indexeddb";

// Persistence layer for the undo stack, stored incrementally: one IDB row per
// snapshot plus a tiny meta row ({ pointer, rowIds }). A push writes the new
// snapshot + meta (and deletes evicted rows) in one atomic transaction; an
// undo/redo writes only the meta row. The previous format rewrote the whole
// stack — every snapshot's layer blobs — on every change.
//
// Callers (UndoManager) still only see load/save/clear. The diff against
// what's already stored happens here, keyed by snapshot object identity
// (UndoManager never clones the snapshots it holds, so identity is stable).

type UndoState<S> = { stack: S[]; pointer: number };

// The subset of IndexedDbStore the store needs — injectable for tests.
export type UndoStoreBackend = {
  get<T>(key: string): Promise<T | null>;
  batch(ops: readonly BatchOp[]): Promise<void>;
};

type Meta = { version: 1; pointer: number; rowIds: number[] };

const META_KEY = "meta";
// Pre-incremental format: the entire { stack, pointer } under one key.
const LEGACY_KEY = "stack";
const rowKey = (id: number) => `row:${id}`;

export class UndoStore<S> {
  private backend: UndoStoreBackend;
  // Snapshot -> id of the IDB row that holds it. Only committed after the
  // write transaction succeeds, so a failed write (quota) is retried by the
  // next save instead of leaving meta pointing at rows that never landed.
  private ids = new Map<S, number>();
  private nextId = 0;
  // Writes run one at a time in call order. Each save diffs against `ids`
  // when it runs (not when queued), so under bursts an earlier queued save
  // already writes the latest rows and the later ones become meta-only puts.
  private chain: Promise<void> = Promise.resolve();

  constructor(backend?: UndoStoreBackend) {
    this.backend = backend ?? new IndexedDbStore("nekudot-undo", "stacks");
  }

  private write(op: () => Promise<void>): Promise<void> {
    const next = this.chain.then(op).catch((e) => {
      console.warn("UndoStore: write failed", e);
    });
    this.chain = next;
    return next;
  }

  async load(): Promise<UndoState<S> | null> {
    try {
      const meta = await this.backend.get<Meta>(META_KEY);
      if (meta) return await this.loadRows(meta);
      return await this.migrateLegacy();
    } catch (e) {
      console.warn("UndoStore.load failed", e);
      return null;
    }
  }

  private async loadRows(meta: Meta): Promise<UndoState<S> | null> {
    const rows = await Promise.all(
      meta.rowIds.map((id) => this.backend.get<S>(rowKey(id))),
    );
    // A missing row means a past write never landed; the pointer can't be
    // trusted against a stack with holes, so start fresh.
    if (rows.some((row) => row === null)) {
      console.warn("UndoStore.load: missing snapshot rows, dropping stack");
      return null;
    }
    const stack = rows as S[];
    stack.forEach((snap, i) => {
      this.ids.set(snap, meta.rowIds[i]);
    });
    this.nextId = Math.max(-1, ...meta.rowIds) + 1;
    return { stack, pointer: meta.pointer };
  }

  // One-time adoption of the previous whole-stack format: rewrite it as rows
  // + meta and delete the legacy key, atomically. The in-memory state is
  // returned even if the rewrite fails (the next save retries the rows).
  private async migrateLegacy(): Promise<UndoState<S> | null> {
    const legacy = await this.backend.get<UndoState<S>>(LEGACY_KEY);
    if (!legacy || !Array.isArray(legacy.stack)) return null;
    const ids = new Map<S, number>();
    const ops: BatchOp[] = legacy.stack.map((snap) => {
      const id = ids.size;
      ids.set(snap, id);
      return { type: "put", key: rowKey(id), value: snap };
    });
    ops.push(
      { type: "put", key: META_KEY, value: this.meta(legacy, ids) },
      { type: "delete", key: LEGACY_KEY },
    );
    try {
      await this.backend.batch(ops);
      this.ids = ids;
      this.nextId = ids.size;
    } catch (e) {
      console.warn("UndoStore: legacy migration write failed", e);
    }
    return legacy;
  }

  save(state: UndoState<S>): Promise<void> {
    return this.write(async () => {
      const ops: BatchOp[] = [];
      const next = new Map<S, number>();
      let nextId = this.nextId;
      for (const snap of state.stack) {
        let id = this.ids.get(snap);
        if (id === undefined) {
          id = nextId++;
          ops.push({ type: "put", key: rowKey(id), value: snap });
        }
        next.set(snap, id);
      }
      for (const [snap, id] of this.ids) {
        if (!next.has(snap)) ops.push({ type: "delete", key: rowKey(id) });
      }
      ops.push({
        type: "put",
        key: META_KEY,
        value: this.meta(state, next),
      });
      await this.backend.batch(ops);
      this.ids = next;
      this.nextId = nextId;
    });
  }

  clear(): Promise<void> {
    return this.write(async () => {
      const ops: BatchOp[] = [...this.ids.values()].map((id) => ({
        type: "delete",
        key: rowKey(id),
      }));
      ops.push({ type: "delete", key: META_KEY });
      ops.push({ type: "delete", key: LEGACY_KEY });
      await this.backend.batch(ops);
      this.ids.clear();
    });
  }

  private meta(state: UndoState<S>, ids = this.ids): Meta {
    return {
      version: 1,
      pointer: state.pointer,
      rowIds: state.stack.map((snap) => ids.get(snap)!),
    };
  }
}

import { IndexedDbStore, type BatchOp } from "./indexeddb";

// v2 tiled undo persistence. Shares the v1 db ("nekudot-undo" / "stacks") but uses
// its own keys (meta2 / base:<id> / entry:<id>) and NEVER touches the v1 keys, so
// a rolled-back build reading v1 still finds a valid stack (the v1 shadow keyframe,
// written separately). Same discipline as src/store/undo.ts: one atomic batch per
// save, and `ids` are committed to memory only after the tx succeeds, so a failed
// write (quota) is retried by the next save rather than leaving meta pointing at
// rows that never landed.

export type TileEpoch = { cssW: number; cssH: number; dpr: number };
export type StoredRect = { x: number; y: number; w: number; h: number };
export type StoredPatch = { layerId: string; rect: StoredRect; blob: Blob; full: boolean };

// One captured delta (post-encode: patch pixels are already Blobs).
export type StoredEntry = {
  id: number;
  config: unknown; // LayersConfig JSON - the store treats it opaquely
  patches: StoredPatch[];
  mapOps: unknown[];
  bytes: number;
};

// The base keyframe: a full-layer blob per layer + the cloud points.
export type StoredBase = {
  id: number;
  config: unknown;
  layers: { layerId: string; blob: Blob; w: number; h: number }[];
  clouds: unknown[];
};

export type StoredChain = {
  epoch: TileEpoch;
  pointer: number;
  base: StoredBase;
  // Evicted-from-the-undo-window entries, kept below the floor until compaction
  // bakes them into the base. Always applied before `entries` on reconstruction.
  folded: StoredEntry[];
  entries: StoredEntry[];
};

type Meta2 = {
  version: 2;
  epoch: TileEpoch;
  pointer: number;
  baseId: number;
  foldedIds: number[];
  entryIds: number[];
};

// The subset of IndexedDbStore this needs - injectable for tests.
export type TiledBackend = {
  get<T>(key: string): Promise<T | null>;
  batch(ops: readonly BatchOp[]): Promise<void>;
};

const META2_KEY = "meta2";
const baseKey = (id: number) => `base:${id}`;
const entryKey = (id: number) => `entry:${id}`;

function isMeta2(m: unknown): m is Meta2 {
  if (typeof m !== "object" || m === null) return false;
  const x = m as Record<string, unknown>;
  return (
    x.version === 2 &&
    typeof x.baseId === "number" &&
    typeof x.pointer === "number" &&
    isNumberArray(x.entryIds) &&
    // foldedIds was added in PR11; a meta2 written before it (no folded rows) is
    // still valid and loads with an empty folded list.
    (x.foldedIds === undefined || isNumberArray(x.foldedIds)) &&
    typeof x.epoch === "object" &&
    x.epoch !== null
  );
}

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((i) => typeof i === "number");
}

export class TiledUndoStore {
  private backend: TiledBackend;
  // Ids already persisted, so a save only writes the base/rows that are new. Rows
  // cover BOTH the folded and active entries - they share one `entry:<id>` key
  // namespace (ids are globally unique), so this one set tracks all of them.
  private savedBaseId = -1;
  private savedRowIds = new Set<number>();
  private chain: Promise<void> = Promise.resolve();

  constructor(backend?: TiledBackend) {
    this.backend = backend ?? new IndexedDbStore("nekudot-undo", "stacks");
  }

  private write(op: () => Promise<void>): Promise<void> {
    const next = this.chain.then(op).catch((e) => {
      console.warn("TiledUndoStore: write failed", e);
    });
    this.chain = next;
    return next;
  }

  // Unlike write()/clear(), save propagates its error to the caller (AppHistory
  // watches for QuotaExceededError to drive recovery) while keeping the write chain
  // alive - the ids are committed only after the tx lands, so a failed save leaves
  // nothing half-tracked and the next save retries it.
  save(chain: StoredChain): Promise<void> {
    const run = this.chain.then(() => this.commitSave(chain));
    this.chain = run.catch(() => {});
    return run;
  }

  private async commitSave(chain: StoredChain): Promise<void> {
    const ops: BatchOp[] = [];
    if (chain.base.id !== this.savedBaseId) {
      ops.push({ type: "put", key: baseKey(chain.base.id), value: chain.base });
    }
    const nextRowIds = new Set<number>();
    for (const entry of [...chain.folded, ...chain.entries]) {
      nextRowIds.add(entry.id);
      if (!this.savedRowIds.has(entry.id))
        ops.push({ type: "put", key: entryKey(entry.id), value: entry });
    }
    // Delete rows that fell out (truncated redo tail, or folded rows a compaction
    // baked into a new base). A compaction's base rewrite + these deletes land in
    // this one tx, so the store never has folded rows without a base to hold them.
    for (const id of this.savedRowIds)
      if (!nextRowIds.has(id)) ops.push({ type: "delete", key: entryKey(id) });
    if (this.savedBaseId >= 0 && this.savedBaseId !== chain.base.id)
      ops.push({ type: "delete", key: baseKey(this.savedBaseId) });
    ops.push({ type: "put", key: META2_KEY, value: this.meta(chain) });
    await this.backend.batch(ops);
    this.savedBaseId = chain.base.id;
    this.savedRowIds = nextRowIds;
  }

  // Load the persisted chain, or null when there is no valid v2 meta / a row is
  // missing (a past write never landed - the pointer can't be trusted, so the
  // caller falls to the boot ladder rather than a holed chain).
  async load(): Promise<StoredChain | null> {
    try {
      const meta = await this.backend.get<Meta2>(META2_KEY);
      if (!isMeta2(meta)) return null;
      const base = await this.backend.get<StoredBase>(baseKey(meta.baseId));
      if (!base) return null;
      const foldedIds = meta.foldedIds ?? [];
      const folded = await this.loadRows(foldedIds);
      const entries = await this.loadRows(meta.entryIds);
      if (!folded || !entries) return null;
      this.savedBaseId = meta.baseId;
      this.savedRowIds = new Set([...foldedIds, ...meta.entryIds]);
      return { epoch: meta.epoch, pointer: meta.pointer, base, folded, entries };
    } catch (e) {
      console.warn("TiledUndoStore.load failed", e);
      return null;
    }
  }

  // Fetch a list of entry rows in order; null if any is missing (holed chain).
  private async loadRows(ids: readonly number[]): Promise<StoredEntry[] | null> {
    const rows: StoredEntry[] = [];
    for (const id of ids) {
      const entry = await this.backend.get<StoredEntry>(entryKey(id));
      if (!entry) {
        console.warn("TiledUndoStore.load: missing entry row, dropping chain");
        return null;
      }
      rows.push(entry);
    }
    return rows;
  }

  clear(): Promise<void> {
    return this.write(async () => {
      const ops: BatchOp[] = [{ type: "delete", key: META2_KEY }];
      if (this.savedBaseId >= 0) ops.push({ type: "delete", key: baseKey(this.savedBaseId) });
      for (const id of this.savedRowIds) ops.push({ type: "delete", key: entryKey(id) });
      await this.backend.batch(ops);
      this.savedBaseId = -1;
      this.savedRowIds = new Set();
    });
  }

  private meta(chain: StoredChain): Meta2 {
    return {
      version: 2,
      epoch: chain.epoch,
      pointer: chain.pointer,
      baseId: chain.base.id,
      foldedIds: chain.folded.map((e) => e.id),
      entryIds: chain.entries.map((e) => e.id),
    };
  }
}

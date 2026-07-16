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
  entries: StoredEntry[];
};

type Meta2 = {
  version: 2;
  epoch: TileEpoch;
  pointer: number;
  baseId: number;
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
    Array.isArray(x.entryIds) &&
    x.entryIds.every((i) => typeof i === "number") &&
    typeof x.epoch === "object" &&
    x.epoch !== null
  );
}

export class TiledUndoStore {
  private backend: TiledBackend;
  // Ids already persisted, so a save only writes the base/entries that are new.
  private savedBaseId = -1;
  private savedEntryIds = new Set<number>();
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

  save(chain: StoredChain): Promise<void> {
    return this.write(async () => {
      const ops: BatchOp[] = [];
      if (chain.base.id !== this.savedBaseId) {
        ops.push({ type: "put", key: baseKey(chain.base.id), value: chain.base });
      }
      const nextEntryIds = new Set<number>();
      for (const entry of chain.entries) {
        nextEntryIds.add(entry.id);
        if (!this.savedEntryIds.has(entry.id))
          ops.push({ type: "put", key: entryKey(entry.id), value: entry });
      }
      // Delete rows that fell out of the chain (evicted/folded or truncated redo tail).
      for (const id of this.savedEntryIds)
        if (!nextEntryIds.has(id)) ops.push({ type: "delete", key: entryKey(id) });
      if (this.savedBaseId >= 0 && this.savedBaseId !== chain.base.id)
        ops.push({ type: "delete", key: baseKey(this.savedBaseId) });
      ops.push({ type: "put", key: META2_KEY, value: this.meta(chain) });
      await this.backend.batch(ops);
      this.savedBaseId = chain.base.id;
      this.savedEntryIds = nextEntryIds;
    });
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
      const entries: StoredEntry[] = [];
      for (const id of meta.entryIds) {
        const entry = await this.backend.get<StoredEntry>(entryKey(id));
        if (!entry) {
          console.warn("TiledUndoStore.load: missing entry row, dropping chain");
          return null;
        }
        entries.push(entry);
      }
      this.savedBaseId = meta.baseId;
      this.savedEntryIds = new Set(meta.entryIds);
      return { epoch: meta.epoch, pointer: meta.pointer, base, entries };
    } catch (e) {
      console.warn("TiledUndoStore.load failed", e);
      return null;
    }
  }

  clear(): Promise<void> {
    return this.write(async () => {
      const ops: BatchOp[] = [{ type: "delete", key: META2_KEY }];
      if (this.savedBaseId >= 0) ops.push({ type: "delete", key: baseKey(this.savedBaseId) });
      for (const id of this.savedEntryIds) ops.push({ type: "delete", key: entryKey(id) });
      await this.backend.batch(ops);
      this.savedBaseId = -1;
      this.savedEntryIds = new Set();
    });
  }

  private meta(chain: StoredChain): Meta2 {
    return {
      version: 2,
      epoch: chain.epoch,
      pointer: chain.pointer,
      baseId: chain.base.id,
      entryIds: chain.entries.map((e) => e.id),
    };
  }
}

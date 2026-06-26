import { IndexedDbStore } from "./indexeddb";

// Snapshot shape — callers only deal with this. The backend (IndexedDB
// today, something else tomorrow) is an implementation detail of PaintStore.

export type LayerPaint = {
  layerIndex: number;
  blob: Blob | null;
};

export type NeighborsMapPaint = {
  index: number;
  pixels: { x: number; y: number }[];
};

export type PaintSnapshot = {
  version: 2;
  layers: LayerPaint[];
  neighborsMaps?: NeighborsMapPaint[];
};

// Paint with bitmaps already decoded (vs LayerPaint's raw blob), ready to write
// straight to the live layers. Shared input for LayerManager.applyDecodedPaint,
// used by both undo-apply and file-load-apply so the two can't drift.
export type DecodedLayerPaint = {
  index: number;
  bitmaps: ImageBitmap[];
};

export type DecodedPaint = {
  layers: DecodedLayerPaint[];
  maps: NeighborsMapPaint[];
};

const SNAPSHOT_KEY = "snapshot";

export class PaintStore {
  private backend: IndexedDbStore;

  constructor(dbName = "nekudot-paint", storeName = "snapshots") {
    this.backend = new IndexedDbStore(dbName, storeName);
  }

  async load(): Promise<PaintSnapshot | null> {
    try {
      const snap = await this.backend.get<PaintSnapshot>(SNAPSHOT_KEY);
      // Pre-v2 snapshots used per-sub-layer storage; not migrated.
      if (!snap || snap.version !== 2) return null;
      return snap;
    } catch (e) {
      console.warn("PaintStore.load failed", e);
      return null;
    }
  }

  async save(snapshot: PaintSnapshot): Promise<void> {
    try {
      await this.backend.put(SNAPSHOT_KEY, snapshot);
    } catch (e) {
      console.warn("PaintStore.save failed", e);
    }
  }

  async clear(): Promise<void> {
    try {
      await this.backend.delete(SNAPSHOT_KEY);
    } catch (e) {
      console.warn("PaintStore.clear failed", e);
    }
  }
}

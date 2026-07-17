import { describe, it, expect } from "vitest";

import type { DirtySet } from "../src/layered/dirty";
import type { MapJournalSnapshot, MapPoint } from "../src/layered/map-journal";
import type { LayersConfig } from "../src/layered/schema";
import { decodePatch, encodePatch } from "../src/store/patch-codec";
import type { DeviceRect } from "../src/renderer";
import {
  type Cloud,
  type RawImage,
  type TileHost,
  TileShadow,
  captureCut,
  countDiffs,
  encodeCut,
  planCapture,
  putRect,
  readUndoTilesMode,
} from "../src/app/tile-capture";

const blank = (w: number, h: number): RawImage => ({
  data: new Uint8ClampedArray(w * h * 4),
  width: w,
  height: h,
});

const subRect = (img: RawImage, r: DeviceRect): RawImage => {
  const out = blank(r.w, r.h);
  putRect(out, img, -r.x, -r.y);
  return out;
};

const emptyDirty = (): DirtySet => ({ all: false, rects: [] });

// A pixel host backed by in-memory arrays. captureFull/decodeFull use the real
// deflate codec (Node has no PNG canvas), so the whole pipeline - grid, degrade,
// chain, reconstruction - runs with a genuine encode/decode round-trip.
class FakeHost implements TileHost {
  private readonly dW: number;
  private readonly dH: number;
  live = new Map<string, RawImage>();
  private dirty = new Map<string, DirtySet>();
  journal: MapJournalSnapshot = { ops: [], truncated: false };
  clouds: Cloud[] = [];
  config = { tag: "cfg" } as unknown as LayersConfig;

  constructor(
    readonly cssW: number,
    readonly cssH: number,
    readonly dpr: number,
    readonly ids: string[],
  ) {
    this.dW = cssW * dpr;
    this.dH = cssH * dpr;
    for (const id of ids) {
      this.live.set(id, blank(this.dW, this.dH));
      this.dirty.set(id, emptyDirty());
    }
  }

  getConfig() {
    return this.config;
  }
  cssSize() {
    return { width: this.cssW, height: this.cssH };
  }
  layers() {
    return this.ids.map((id) => ({ id, deviceW: this.dW, deviceH: this.dH }));
  }
  takeLayerDirty(id: string) {
    const d = this.dirty.get(id) ?? emptyDirty();
    this.dirty.set(id, emptyDirty());
    return d;
  }
  takeJournal() {
    const j = this.journal;
    this.journal = { ops: [], truncated: false };
    return j;
  }
  collectClouds() {
    return this.clouds.map((c) => ({ mapId: c.mapId, points: c.points.map((p) => ({ ...p })) }));
  }
  readSpan(id: string, rect: DeviceRect) {
    return subRect(this.getLive(id), rect);
  }
  readLayer(id: string) {
    return { data: new Uint8ClampedArray(this.getLive(id).data), width: this.dW, height: this.dH };
  }
  async captureFull(id: string) {
    return encodePatch(this.getLive(id));
  }
  async decodeFull(blob: Blob) {
    return decodePatch(blob);
  }
  async rawToBlob(img: RawImage) {
    return encodePatch(img);
  }

  private getLive(id: string): RawImage {
    const img = this.live.get(id);
    if (!img) throw new Error(`no layer ${id}`);
    return img;
  }

  // ---- test helpers ----
  paint(id: string, r: DeviceRect, rgba: [number, number, number, number]): void {
    const img = this.getLive(id);
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) {
        const i = (y * img.width + x) * 4;
        img.data[i] = rgba[0];
        img.data[i + 1] = rgba[1];
        img.data[i + 2] = rgba[2];
        img.data[i + 3] = rgba[3];
      }
  }
  markDirty(id: string, cssRect: DeviceRect): void {
    this.dirty.get(id)?.rects.push(cssRect);
  }
  markAll(id: string): void {
    this.dirty.set(id, { all: true, rects: [] });
  }
}

// A device rect, given in css px, at dpr=1 for the simple cases.
const R = (x: number, y: number, w: number, h: number): DeviceRect => ({ x, y, w, h });

describe("planCapture (grid + degrade)", () => {
  it("snaps a small dirty rect to a single tile span", () => {
    const plan = planCapture({ all: false, rects: [R(10, 10, 20, 20)] }, 512, 512, 1);
    expect(plan.degrade).toBe(false);
    expect(plan.spans).toEqual([{ x: 0, y: 0, w: 256, h: 256 }]);
  });

  it("degrades on FULL", () => {
    expect(planCapture({ all: true, rects: [] }, 512, 512, 1).degrade).toBe(true);
  });

  it("degrades past 40% of the grid", () => {
    // 512x512 = 2x2 = 4 tiles; 2 dirty tiles = 50% > 40%.
    const plan = planCapture({ all: false, rects: [R(0, 0, 300, 10)] }, 512, 512, 1);
    expect(plan.degrade).toBe(true);
  });

  it("degrades past 8 merged spans", () => {
    // A big grid, dirty a scattered checkerboard so runs can't merge -> many spans.
    const rects: DeviceRect[] = [];
    for (let i = 0; i < 12; i++) rects.push(R(i * 512, 0, 10, 10)); // 12 isolated columns
    const plan = planCapture({ all: false, rects }, 512 * 13, 512, 1);
    expect(plan.degrade).toBe(true);
  });

  it("merges a 2x2 dirty block into one span, scaled by dpr", () => {
    // css 512 @ dpr 2 = 1024 device (4x4 grid). css rect 0..256 -> device 0..512
    // -> the top-left 2x2 tiles (25% of the grid), merged into one span.
    const plan = planCapture({ all: false, rects: [R(0, 0, 256, 256)] }, 1024, 1024, 2);
    expect(plan.degrade).toBe(false);
    expect(plan.spans).toEqual([{ x: 0, y: 0, w: 512, h: 512 }]);
  });
});

describe("putRect / countDiffs", () => {
  it("putRect overwrites the anchored rect, clipped to bounds", () => {
    const dst = blank(4, 4);
    const src: RawImage = { data: new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]), width: 2, height: 1 };
    putRect(dst, src, 3, 0); // second pixel falls off the right edge
    expect(Array.from(dst.data.slice(12, 16))).toEqual([1, 2, 3, 4]);
  });
  it("countDiffs respects tolerance and dimension mismatch", () => {
    const a = blank(2, 1);
    const b = blank(2, 1);
    b.data[0] = 3;
    expect(countDiffs(a, b, 2)).toBe(1);
    expect(countDiffs(a, b, 3)).toBe(0);
    expect(countDiffs(a, blank(3, 1), 0)).toBeGreaterThan(0);
  });
});

describe("readUndoTilesMode", () => {
  it("defaults to on with no localStorage", () => {
    expect(readUndoTilesMode()).toBe("on");
  });

  it("honors the explicit off/shadow escape hatches, defaults unknown to on", () => {
    const store = new Map<string, string>();
    const prev = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    };
    try {
      expect(readUndoTilesMode()).toBe("on"); // unset
      store.set("nekudot.undoTiles", "off");
      expect(readUndoTilesMode()).toBe("off");
      store.set("nekudot.undoTiles", "shadow");
      expect(readUndoTilesMode()).toBe("shadow");
      store.set("nekudot.undoTiles", "nonsense");
      expect(readUndoTilesMode()).toBe("on"); // unknown value -> default
    } finally {
      (globalThis as { localStorage?: unknown }).localStorage = prev;
    }
  });
});

describe("TileShadow capture -> reconstruct -> verify round-trip", () => {
  const seeded = (): { host: FakeHost; shadow: TileShadow } => {
    const host = new FakeHost(512, 512, 1, ["L0"]);
    const shadow = new TileShadow(host, 10);
    shadow.seedBase(); // base = blank
    return { host, shadow };
  };

  const captureCommit = async (host: FakeHost, shadow: TileShadow) => {
    const entry = await encodeCut(captureCut(host));
    await shadow.commit(entry);
    return entry;
  };

  it("verifies clean when the dirty bound covers the change (exact)", async () => {
    const { host, shadow } = seeded();
    host.paint("L0", R(20, 20, 40, 40), [200, 100, 50, 255]);
    host.markDirty("L0", R(16, 16, 48, 48)); // covers the change
    await captureCommit(host, shadow);
    const res = await shadow.verify(0);
    expect(res).toEqual({ layerDiffs: 0, cloudMismatch: false });
    expect(shadow.mismatches).toBe(0);
  });

  it("catches an injected bounds bug (dirty set misses the change)", async () => {
    const { host, shadow } = seeded();
    host.paint("L0", R(300, 300, 40, 40), [10, 220, 30, 255]); // in tile (1,1)
    host.markDirty("L0", R(0, 0, 40, 40)); // WRONG - marks tile (0,0), misses (1,1)
    await captureCommit(host, shadow);
    const res = await shadow.verify(0);
    expect(res.layerDiffs).toBeGreaterThan(0);
    expect(shadow.mismatches).toBe(1);
  });

  it("captures via the degrade (full-layer) path and still verifies", async () => {
    const { host, shadow } = seeded();
    host.paint("L0", R(0, 0, 512, 512), [1, 2, 3, 4]); // whole layer
    host.markAll("L0"); // -> degrade -> full-layer patch
    const entry = await captureCommit(host, shadow);
    expect(entry.patches).toHaveLength(1);
    expect(entry.patches[0].full).toBe(true);
    expect((await shadow.verify(0)).layerDiffs).toBe(0);
  });

  it("the cut is atomic: mutations after captureCut are excluded", async () => {
    const { host } = seeded();
    host.paint("L0", R(20, 20, 40, 40), [200, 100, 50, 255]);
    host.markDirty("L0", R(16, 16, 48, 48));
    const cut = captureCut(host); // atomic snapshot
    host.paint("L0", R(20, 20, 40, 40), [9, 9, 9, 255]); // bleed-in AFTER the cut
    const entry = await encodeCut(cut);
    // The span pixels captured the pre-mutation colour.
    const px = await decodePatch(entry.patches[0].blob);
    expect(Array.from(px.data.slice(0, 4))).not.toEqual([9, 9, 9, 255]);
  });

  it("serializes the chain for v2 persistence (base blobs + entry ids + epoch)", async () => {
    const { host, shadow } = seeded();
    host.paint("L0", R(20, 20, 40, 40), [1, 2, 3, 255]);
    host.markDirty("L0", R(16, 16, 48, 48));
    await captureCommit(host, shadow);
    const chain = await shadow.serialize();
    expect(chain.pointer).toBe(1);
    expect(chain.epoch).toEqual({ cssW: 512, cssH: 512, dpr: 1 });
    expect(chain.base.layers.map((l) => l.layerId)).toEqual(["L0"]);
    expect(chain.base.layers[0].blob).toBeInstanceOf(Blob);
    expect(chain.entries.map((e) => e.id)).toEqual([0]);
    expect(chain.entries[0].patches[0].blob).toBeInstanceOf(Blob);
  });
});

describe("TileShadow cloud verify", () => {
  it("clean when journal ops reproduce the live cloud multiset", async () => {
    const host = new FakeHost(256, 256, 1, ["L0"]);
    const shadow = new TileShadow(host, 10);
    shadow.seedBase(); // base clouds empty
    const pts: MapPoint[] = [{ x: 1, y: 1 }, { x: 2, y: 2, color: "#f00" }];
    host.clouds = [{ mapId: "m1", points: pts }];
    host.journal = { ops: [{ mapId: "m1", op: "add", points: pts }], truncated: false };
    await shadow.commit(await encodeCut(captureCut(host)));
    expect((await shadow.verify(0)).cloudMismatch).toBe(false);
  });

  it("flags a cloud mismatch when the journal misses a deposit", async () => {
    const host = new FakeHost(256, 256, 1, ["L0"]);
    const shadow = new TileShadow(host, 10);
    shadow.seedBase();
    host.clouds = [{ mapId: "m1", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }];
    host.journal = { ops: [{ mapId: "m1", op: "add", points: [{ x: 1, y: 1 }] }], truncated: false };
    await shadow.commit(await encodeCut(captureCut(host)));
    expect((await shadow.verify(0)).cloudMismatch).toBe(true);
  });
});

describe("TileShadow chain: undo/redo + evict-fold", () => {
  const paintStroke = async (host: FakeHost, shadow: TileShadow, n: number) => {
    // Each stroke paints a distinct 32px block and marks it dirty.
    const x = 10 + n * 40;
    host.paint("L0", R(x, 10, 30, 30), [n & 255, 0, 0, 255]);
    host.markDirty("L0", R(x - 4, 6, 38, 38));
    await shadow.commit(await encodeCut(captureCut(host)));
  };

  it("reconstructs after undo and redo", async () => {
    const host = new FakeHost(1024, 256, 1, ["L0"]);
    const shadow = new TileShadow(host, 10);
    shadow.seedBase();
    await paintStroke(host, shadow, 1);
    await paintStroke(host, shadow, 2);
    expect((await shadow.verify(0)).layerDiffs).toBe(0);
    // Undo the live layer to the 1-stroke state, then verify the shadow matches.
    host.live.set("L0", blank(1024, 256));
    host.paint("L0", R(50, 10, 30, 30), [1, 0, 0, 255]); // stroke 1 only
    shadow.step("undo");
    expect((await shadow.verify(0)).layerDiffs).toBe(0);
  });

  it("evicts oldest entries into folded past maxUndo, staying exact", async () => {
    const host = new FakeHost(1024, 256, 1, ["L0"]);
    const shadow = new TileShadow(host, 3); // tiny cap -> forces evictions
    shadow.seedBase();
    for (let n = 1; n <= 6; n++) await paintStroke(host, shadow, n);
    // maxUndo 3 keeps 2 active entries; the rest sit in `folded` below the floor.
    const chain = await shadow.serialize();
    expect(chain.entries.length).toBe(2);
    expect(chain.folded.length).toBe(4);
    expect(chain.base.id).toBe(0); // no compaction yet (folded <= 30)
    // Live holds all six strokes; base + folded + active reconstructs exactly.
    expect((await shadow.verify(0)).layerDiffs).toBe(0);
    expect(shadow.mismatches).toBe(0);
  });

  it("evicts on the byte budget independently of the count", async () => {
    const host = new FakeHost(1024, 256, 1, ["L0"]);
    const shadow = new TileShadow(host, 100, () => {}, 1); // huge count cap, 1-byte budget
    shadow.seedBase();
    for (let n = 1; n <= 5; n++) await paintStroke(host, shadow, n);
    const chain = await shadow.serialize();
    expect(chain.entries.length).toBe(1); // budget folds down to the one kept entry
    expect(chain.folded.length).toBe(4);
    expect((await shadow.verify(0)).layerDiffs).toBe(0);
  });

  it("compacts folded into the base past the threshold, staying exact", async () => {
    const host = new FakeHost(1024, 256, 1, ["L0"]);
    const shadow = new TileShadow(host, 3);
    shadow.seedBase();
    // maxUndo 3 folds ~1 entry per stroke; 34 strokes drives folded past 30 -> compact.
    for (let n = 1; n <= 34; n++) await paintStroke(host, shadow, n);
    const chain = await shadow.serialize();
    expect(chain.base.id).toBeGreaterThan(0); // compaction bumped the base version
    expect(chain.folded.length).toBeLessThanOrEqual(30); // stayed bounded
    expect((await shadow.verify(0)).layerDiffs).toBe(0); // state preserved across compaction
    expect(shadow.mismatches).toBe(0);
  });

  it("reconstructs undo/redo within the active window after eviction", async () => {
    const host = new FakeHost(1024, 256, 1, ["L0"]);
    const shadow = new TileShadow(host, 3);
    shadow.seedBase();
    for (let n = 1; n <= 5; n++) await paintStroke(host, shadow, n); // entries=[s4,s5], folded=[s1..3]
    // Undo to the 4-stroke state (pointer into the active window; folded still applied).
    host.live.set("L0", blank(1024, 256));
    for (let n = 1; n <= 4; n++) host.paint("L0", R(10 + n * 40, 10, 30, 30), [n & 255, 0, 0, 255]);
    shadow.step("undo");
    expect((await shadow.verify(0)).layerDiffs).toBe(0);
    // Redo back to 5 strokes.
    host.paint("L0", R(10 + 5 * 40, 10, 30, 30), [5, 0, 0, 255]);
    shadow.step("redo");
    expect((await shadow.verify(0)).layerDiffs).toBe(0);
  });

  it("dropRedoTail drops not-yet-reached redo states, staying exact", async () => {
    const host = new FakeHost(1024, 256, 1, ["L0"]);
    const shadow = new TileShadow(host, 10);
    shadow.seedBase();
    for (let n = 1; n <= 3; n++) await paintStroke(host, shadow, n);
    shadow.step("undo"); // pointer 2, redo tail = [stroke3]
    expect(shadow.dropRedoTail()).toBe(true);
    const chain = await shadow.serialize();
    expect(chain.entries.length).toBe(2); // stroke3 gone
    expect(chain.pointer).toBe(2);
    // Live is the 2-stroke state; reconstruction at the (unchanged) pointer is exact.
    host.live.set("L0", blank(1024, 256));
    for (let n = 1; n <= 2; n++) host.paint("L0", R(10 + n * 40, 10, 30, 30), [n & 255, 0, 0, 255]);
    expect((await shadow.verify(0)).layerDiffs).toBe(0);
    expect(shadow.dropRedoTail()).toBe(false); // nothing left above the pointer
  });

  it("compactNow forces folded into the base below the threshold, staying exact", async () => {
    const host = new FakeHost(1024, 256, 1, ["L0"]);
    const shadow = new TileShadow(host, 3);
    shadow.seedBase();
    for (let n = 1; n <= 5; n++) await paintStroke(host, shadow, n); // folded = 3, base.id 0
    await shadow.compactNow();
    const chain = await shadow.serialize();
    expect(chain.folded.length).toBe(0); // baked into the base
    expect(chain.base.id).toBeGreaterThan(0);
    expect((await shadow.verify(0)).layerDiffs).toBe(0); // floor preserved
  });

  // A real 500-iteration soak with encode/decode + repeated compaction: seconds of
  // genuine work, so it needs headroom over the default 5s per-test timeout on slow
  // CI runners (it is not hung - just long).
  it("500-stroke soak stays under budget and the folded cap, still exact", async () => {
    const BUDGET = 4000;
    const host = new FakeHost(1024, 256, 1, ["L0"]);
    const shadow = new TileShadow(host, 10, () => {}, BUDGET);
    shadow.seedBase();
    for (let n = 1; n <= 500; n++) {
      // Each stroke overwrites the SAME tile, so live == last stroke and the chain
      // stays exactly reconstructible while eviction + compaction churn underneath.
      host.live.set("L0", blank(1024, 256));
      host.paint("L0", R(20, 20, 60, 60), [n & 255, (n * 7) & 255, 0, 255]);
      host.markDirty("L0", R(16, 16, 68, 68));
      await shadow.commit(await encodeCut(captureCut(host)));
    }
    const chain = await shadow.serialize();
    const activeBytes = chain.entries.reduce((n, e) => n + e.bytes, 0);
    expect(chain.entries.length).toBeLessThanOrEqual(10); // count bound
    // byte bound holds, unless eviction is down to the single always-kept entry
    expect(activeBytes <= BUDGET || chain.entries.length === 1).toBe(true);
    expect(chain.folded.length).toBeLessThanOrEqual(30); // boot-replay cap holds
    expect((await shadow.verify(0)).layerDiffs).toBe(0); // exact through every compaction
    expect(shadow.mismatches).toBe(0);
  }, 30_000);
});

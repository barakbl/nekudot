import { describe, it, expect } from "vitest";

import type { DirtySet } from "../src/layered/dirty";
import type { MapJournalSnapshot } from "../src/layered/map-journal";
import type { LayersConfig } from "../src/layered/schema";
import { decodePatch, encodePatch } from "../src/store/patch-codec";
import type { DeviceRect } from "../src/renderer";
import type { PaintSnapshot } from "../src/store/paint";
import {
  type Cloud,
  type RawImage,
  type TileHost,
  TileShadow,
  captureCut,
  encodeCut,
} from "../src/app/tile-capture";

const blank = (w: number, h: number): RawImage => ({
  data: new Uint8ClampedArray(w * h * 4),
  width: w,
  height: h,
});

const subRect = (img: RawImage, r: DeviceRect): RawImage => {
  const out = blank(r.w, r.h);
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const sx = r.x + x;
      const sy = r.y + y;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      const si = (sy * img.width + sx) * 4;
      const di = (y * r.w + x) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  return out;
};

const emptyDirty = (): DirtySet => ({ all: false, rects: [] });

// A config whose layer/map ids match the host, so reconstructPaintSnapshot's
// layer-set check passes and it emits a real PaintSnapshot.
const CONFIG = {
  maxLayers: 10,
  activeIndex: 0,
  layers: [{ id: "L0", index: 0, name: "L0", types: ["normal"], opacity: 100 }],
  neighborsMaps: [{ id: "m1", name: "m1", opacity: 100 }],
  selectedNeighborsMapIndex: 0,
  background: { color: "#ffffff", transparent: false },
} as unknown as LayersConfig;

class FakeHost implements TileHost {
  private readonly dW: number;
  private readonly dH: number;
  live = new Map<string, RawImage>();
  private dirty = new Map<string, DirtySet>();
  journal: MapJournalSnapshot = { ops: [], truncated: false };
  clouds: Cloud[] = [];

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
    return CONFIG;
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
  markDirty(id: string, r: DeviceRect): void {
    this.dirty.get(id)?.rects.push(r);
  }
}

const R = (x: number, y: number, w: number, h: number): DeviceRect => ({ x, y, w, h });

// Decode a reconstructed snapshot's single layer back to pixels for comparison.
const layerPixels = async (snap: PaintSnapshot): Promise<RawImage> => {
  const blob = snap.layers[0]?.blob;
  if (!blob) throw new Error("no layer blob");
  return decodePatch(blob);
};

const samePixels = (a: RawImage, b: RawImage): boolean =>
  a.width === b.width &&
  a.height === b.height &&
  a.data.length === b.data.length &&
  a.data.every((v, i) => v === b.data[i]);

describe("TileShadow.hydrate: boot round-trip", () => {
  const buildChain = async () => {
    const host = new FakeHost(512, 512, 1, ["L0"]);
    const shadow = new TileShadow(host, 10);
    shadow.seedBase(); // base = blank
    // Stroke 1: a block in tile (0,0).
    host.paint("L0", R(20, 20, 40, 40), [200, 100, 50, 255]);
    host.markDirty("L0", R(16, 16, 48, 48));
    await shadow.commit(await encodeCut(captureCut(host)));
    // Stroke 2: a block in tile (1,1).
    host.paint("L0", R(300, 300, 40, 40), [10, 220, 30, 255]);
    host.markDirty("L0", R(296, 296, 48, 48));
    await shadow.commit(await encodeCut(captureCut(host)));
    return { host, shadow };
  };

  it("hydrates a serialized chain and reconstructs every pointer identically", async () => {
    const { shadow } = await buildChain();
    const chain = await shadow.serialize();
    expect(chain.pointer).toBe(2);

    // A cold reader with a blank canvas hydrates the persisted chain.
    const freshHost = new FakeHost(512, 512, 1, ["L0"]);
    const booted = new TileShadow(freshHost, 10);
    await booted.hydrate(chain);
    expect(booted.entryCount()).toBe(2);
    expect(booted.pointerIndex()).toBe(2);
    expect(booted.currentEpoch()).toEqual({ cssW: 512, cssH: 512, dpr: 1 });

    for (let k = 0; k <= 2; k++) {
      const original = await shadow.reconstructPaintSnapshotAt(k);
      const restored = await booted.reconstructPaintSnapshotAt(k);
      expect(original).not.toBeNull();
      expect(restored).not.toBeNull();
      const a = await layerPixels(original as PaintSnapshot);
      const b = await layerPixels(restored as PaintSnapshot);
      expect(samePixels(a, b)).toBe(true);
    }
  });

  it("reconstructs the base (pointer 0) as a blank layer after hydrate", async () => {
    const { shadow } = await buildChain();
    const chain = await shadow.serialize();
    const booted = new TileShadow(new FakeHost(512, 512, 1, ["L0"]), 10);
    await booted.hydrate(chain);
    const atBase = await booted.reconstructPaintSnapshotAt(0);
    const px = await layerPixels(atBase as PaintSnapshot);
    expect(px.data.every((v) => v === 0)).toBe(true); // base was seeded blank
  });

  it("rebuilds every FIFO position after an eviction reload (folded present)", async () => {
    // maxUndo 3 forces eviction into folded; serialize + hydrate, then mimic
    // AppHistory.rebuildManagerStack: reconstruct every pointer 0..entryCount.
    const host = new FakeHost(512, 512, 1, ["L0"]);
    const shadow = new TileShadow(host, 3);
    shadow.seedBase();
    for (let n = 1; n <= 5; n++) {
      host.paint("L0", R(20 + n * 30, 20, 24, 24), [n & 255, 0, 0, 255]);
      host.markDirty("L0", R(16 + n * 30, 16, 32, 32));
      await shadow.commit(await encodeCut(captureCut(host)));
    }
    const chain = await shadow.serialize();
    expect(chain.folded.length).toBeGreaterThan(0); // eviction happened
    expect(chain.pointer).toBeGreaterThan(0);

    const booted = new TileShadow(new FakeHost(512, 512, 1, ["L0"]), 3);
    await booted.hydrate(chain);
    for (let k = 0; k <= booted.entryCount(); k++) {
      expect(booted.configAt(k), `configAt(${k})`).not.toBeNull();
      expect(await booted.reconstructPaintSnapshotAt(k), `reconstructAt(${k})`).not.toBeNull();
    }
    expect(booted.pointerIndex()).toBeGreaterThan(0); // undo is available post-reload
  });

  it("configAt tracks the entry configs across the window", async () => {
    const { shadow } = await buildChain();
    const chain = await shadow.serialize();
    const booted = new TileShadow(new FakeHost(512, 512, 1, ["L0"]), 10);
    await booted.hydrate(chain);
    expect(booted.configAt(0)?.layers.map((l) => l.id)).toEqual(["L0"]);
    expect(booted.configAt(2)?.layers.map((l) => l.id)).toEqual(["L0"]);
  });
});

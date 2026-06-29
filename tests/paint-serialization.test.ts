import { describe, it, expect, beforeEach } from "vitest";

// A1: getPaintData() (undo snapshot) and save-artwork (.nekudot file) now share
// LayerManager.collectLayerBlobs() / collectMapPixels(). These tests lock that
// single path so the two serializers can't silently drift.
import type { LayerManager } from "../src/layered/manager";
import {
  installDocumentStub,
  makeCanvasStub,
  newManager,
} from "./_layer-manager-harness";

// Default stub: toBlob resolves null synchronously. These tests assert the shape
// of the shared collectors, not bitmap contents.
installDocumentStub(() => makeCanvasStub());

describe("paint serialization: shared collectors", () => {
  let manager: LayerManager;
  beforeEach(() => {
    manager = newManager(); // two layers + one (empty) neighbors map
  });

  it("collectMapPixels reflects the finder points, and getPaintData is built from it", async () => {
    const finder = manager.allNeighborsMaps[0].finder;
    finder.addPixel(3, 4);
    finder.addPixel(7, 8);

    const maps = manager.collectMapPixels();
    expect(maps).toHaveLength(1);
    expect(maps[0].index).toBe(0);
    expect(new Set(maps[0].pixels.map((p) => `${p.x},${p.y}`))).toEqual(
      new Set(["3,4", "7,8"]),
    );

    // The undo snapshot must walk the same path - this is the anti-drift guard.
    const snap = await manager.getPaintData();
    expect(snap.version).toBe(2);
    expect(snap.neighborsMaps).toEqual(maps);
  });

  it("collectLayerBlobs yields one entry per layer keyed by config.index, ordered, and feeds getPaintData", async () => {
    const order = manager.orderedLayers().map((l) => l.config.index);
    const blobs = await manager.collectLayerBlobs();
    expect(blobs.map((b) => b.layerIndex)).toEqual(order);

    const snap = await manager.getPaintData();
    expect(snap.layers.map((l) => l.layerIndex)).toEqual(order);
  });

  it("round-trips neighbors-map points through getPaintData -> applyPaintData", async () => {
    manager.allNeighborsMaps[0].finder.addPixel(1, 2);
    const snap = await manager.getPaintData();

    const fresh = newManager();
    await fresh.applyPaintData(snap);

    const restored = fresh.allNeighborsMaps[0].finder
      .allPixels()
      .map((p) => `${p.x},${p.y}`);
    expect(restored).toEqual(["1,2"]);
  });

  it("round-trips per-point colour (the 'From mark' hue), omitting it on uncoloured points", async () => {
    const finder = manager.allNeighborsMaps[0].finder;
    finder.addPixel(1, 2).color = "#ff8800";
    finder.addPixel(3, 4); // uncoloured

    const maps = manager.collectMapPixels();
    const byPos = Object.fromEntries(maps[0].pixels.map((p) => [`${p.x},${p.y}`, p.color]));
    expect(byPos["1,2"]).toBe("#ff8800");
    expect(byPos["3,4"]).toBeUndefined(); // omitted to keep snapshots compact

    const snap = await manager.getPaintData();
    const fresh = newManager();
    await fresh.applyPaintData(snap);
    const restored = Object.fromEntries(
      fresh.allNeighborsMaps[0].finder.allPixels().map((p) => [`${p.x},${p.y}`, p.color]),
    );
    expect(restored["1,2"]).toBe("#ff8800"); // colour survived the round-trip
    expect(restored["3,4"]).toBeUndefined();
  });

  // A2: applyPaintData (undo) and applyArtwork (file load) now both route through
  // LayerManager.applyDecodedPaint. These lock the shared apply path.
  it("applyDecodedPaint writes map points to the live finders", () => {
    manager.applyDecodedPaint({
      layers: [],
      maps: [{ index: 0, pixels: [{ x: 5, y: 6 }] }],
    });
    expect(
      manager.allNeighborsMaps[0].finder.allPixels().map((p) => `${p.x},${p.y}`),
    ).toEqual(["5,6"]);
  });

  it("applyDecodedPaint clears the finder before re-adding", () => {
    const finder = manager.allNeighborsMaps[0].finder;
    finder.addPixel(9, 9);
    manager.applyDecodedPaint({
      layers: [],
      maps: [{ index: 0, pixels: [{ x: 1, y: 1 }] }],
    });
    expect(finder.allPixels().map((p) => `${p.x},${p.y}`)).toEqual(["1,1"]);
  });

  // #29: the maps-box / navbar dot count must update after a restore. applyConfig
  // emits while the finders are empty, so applyDecodedPaint has to re-emit once the
  // points are back - otherwise a loaded .nekudot shows 0 dots in the navbar.
  it("applyDecodedPaint emits so subscribers (maps box / navbar) refresh", () => {
    let emits = 0;
    const unsub = manager.subscribe(() => emits++);
    manager.applyDecodedPaint({
      layers: [],
      maps: [{ index: 0, pixels: [{ x: 1, y: 2 }] }],
    });
    unsub();
    expect(emits).toBe(1); // fired once, after the points were restored
    expect(manager.allNeighborsMaps[0].finder.allPixels()).toHaveLength(1);
  });
});

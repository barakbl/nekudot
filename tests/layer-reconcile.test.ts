import { describe, it, expect } from "vitest";
import { installDocumentStub, newManager } from "./_layer-manager-harness";

// LayerManager.reconcileConfig (vector-replay config replay): applies a recorded
// LayersConfig mid-session WITHOUT wiping survivors' pixels/points - matched by
// stable id. The "same object" checks below are the proxy for pixel/point
// preservation (a kept Layer keeps its canvas; a kept NeighborsMap keeps its finder).

installDocumentStub();

describe("LayerManager.reconcileConfig (pixel-preserving config replay)", () => {
  it("keeps surviving layers by id, adds new empties, drops removed, applies opacity/name/order", () => {
    const m = newManager(); // 2 default layers + 1 map
    const cfg0 = m.getConfig();
    const [layerA, layerB] = m.orderedLayers();
    const keepId = layerA.config.id;
    const dropId = layerB.config.id;

    const target = {
      ...cfg0,
      layers: [
        { ...cfg0.layers[0], name: "Kept", opacity: 40 }, // survive, retitled + dimmed
        { id: "NEW", index: 1, name: "Added", types: ["normal" as const], opacity: 100 }, // new
        // cfg0.layers[1] omitted => removed
      ],
      activeIndex: 1,
    };
    m.reconcileConfig(target);
    const after = m.orderedLayers();

    // the surviving layer is the SAME object => its canvas + pixels are intact
    const kept = after.find((l) => l.config.id === keepId);
    expect(kept).toBe(layerA);
    expect(kept?.config.opacity).toBe(40);
    expect(kept?.config.name).toBe("Kept");
    // new layer spawned, removed layer dropped
    expect(after.some((l) => l.config.id === "NEW")).toBe(true);
    expect(after.some((l) => l.config.id === dropId)).toBe(false);
    // clean 0..n-1 indices in target order
    expect(after.map((l) => l.config.id)).toEqual([keepId, "NEW"]);
    expect(after.map((l) => l.config.index)).toEqual([0, 1]);
    expect(m.getConfig().activeIndex).toBe(1);
  });

  it("reorders surviving layers by id without losing either", () => {
    const m = newManager();
    const cfg0 = m.getConfig();
    const [a, b] = m.orderedLayers();
    m.reconcileConfig({ ...cfg0, layers: [{ ...cfg0.layers[1] }, { ...cfg0.layers[0] }] });
    const after = m.orderedLayers();
    expect(after[0]).toBe(b); // same objects, swapped order
    expect(after[1]).toBe(a);
    expect(after.map((l) => l.config.index)).toEqual([0, 1]);
  });

  it("reconciles neighbour maps by id (survivor keeps its finder) and applies background", () => {
    const m = newManager();
    const cfg0 = m.getConfig();
    m.addPixel(10, 12); // deposit into the selected (index 0) map's finder
    expect(m.pixelCount()).toBe(1);
    const mapId = cfg0.neighborsMaps[0].id;

    m.reconcileConfig({
      ...cfg0,
      neighborsMaps: [
        { ...cfg0.neighborsMaps[0], name: "renamed" }, // survive
        { id: "M2", name: "map-2", opacity: 100 }, // new empty map
      ],
      background: { color: "#123456", transparent: false },
    });

    expect(m.getConfig().neighborsMaps.map((x) => x.id)).toEqual([mapId, "M2"]);
    expect(m.getBackground()).toEqual({ color: "#123456", transparent: false });
    // the surviving map (still selected at index 0) kept its deposited point
    expect(m.pixelCount()).toBe(1);
  });

  it("falls back to a destructive rebuild when the canvas size changes", () => {
    const m = newManager({ width: 100, height: 100 });
    const cfg0 = m.getConfig();
    const layerA = m.orderedLayers()[0];
    m.reconcileConfig(cfg0, { width: 200, height: 150 });
    expect(m.currentSize).toEqual({ width: 200, height: 150 });
    // resize can't preserve pixels 1:1 -> layers are rebuilt (new objects)
    expect(m.orderedLayers()[0]).not.toBe(layerA);
  });
});

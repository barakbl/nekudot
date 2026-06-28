import { describe, it, expect } from "vitest";

// These lock CRITICAL LayerManager invariants the architecture map flagged as
// "enforced by convention" with no test behind them, so a regression fails CI
// instead of silently corrupting layer order, undo history, or a restore:
//   1. config.index == array position (renumberLayers after every order change,
//      and applyConfig normalizing legacy/odd saved indices) - z-index,
//      persistence, and undo-snapshot matching all assume it.
//   2. getConfig() returns a fully detached deep clone (the "safety line" that
//      keeps a later edit from bleeding into an undo snapshot) - down to nested
//      maps/background/layer fields, not just the top-level array.
//   3. applyConfig round-trips the whole config by index (layers AND the
//      connection cursor / maps / background), and getPaintData keys each layer
//      by config.index (the key applyPaintData matches on).
//   4. layers and neighbor maps are never emptied (removeLayer/removeNeighborsMap
//      refuse the last one).
import type { LayerManager } from "../src/layered/manager";
import { installDocumentStub, newManager } from "./_layer-manager-harness";

installDocumentStub();

const indices = (m: LayerManager): number[] => m.all.map((l) => l.config.index);
const ids = (m: LayerManager): string[] => m.all.map((l) => l.config.id);

describe("LayerManager: config.index tracks array position", () => {
  it("stays 0..n-1 == position through add / remove / reorder / duplicate", () => {
    const m = newManager();
    const positionsMatch = () => m.all.every((l, i) => l.config.index === i);

    // A fresh manager starts with two layers.
    expect(indices(m)).toEqual([0, 1]);
    expect(positionsMatch()).toBe(true);

    m.addLayer();
    expect(indices(m)).toEqual([0, 1, 2]);
    expect(positionsMatch()).toBe(true);

    // Remove the middle layer: renumberLayers must close the gap so the formerly
    // index-2 layer becomes index 1.
    m.removeLayer(1);
    expect(indices(m)).toEqual([0, 1]);
    expect(positionsMatch()).toBe(true);

    // Reverse the order: indices stay 0..n-1, the contents swap.
    const before = ids(m);
    const reversed = before.slice().reverse();
    expect(m.reorderByIds(reversed)).toBe(true);
    expect(indices(m)).toEqual([0, 1]);
    expect(positionsMatch()).toBe(true);
    expect(ids(m)).toEqual(reversed);

    m.duplicateLayer(0);
    expect(positionsMatch()).toBe(true);
    expect(indices(m)).toEqual(m.all.map((_, i) => i));
  });

  it("rejects no-op / wrong-length / unknown-id reorders without mutating order", () => {
    const m = newManager();
    m.addLayer(); // 3 layers
    const before = ids(m);

    expect(m.reorderByIds(before)).toBe(false); // same order -> no-op
    expect(m.reorderByIds(before.slice(0, -1))).toBe(false); // wrong length
    expect(
      m.reorderByIds(before.map((id, i) => (i === 0 ? "bogus" : id))),
    ).toBe(false); // unknown id -> bail, no partial reorder

    // None of the rejected calls reordered or renumbered anything.
    expect(ids(m)).toEqual(before);
    expect(indices(m)).toEqual([0, 1, 2]);
  });

  it("applyConfig normalizes legacy/odd saved indices to 0..n-1", () => {
    const a = newManager();
    a.addLayer(); // 3 layers
    const cfg = a.getConfig();
    // Simulate a legacy/odd saved config: index fields scrambled, array order intact.
    cfg.layers[0].index = 7;
    cfg.layers[1].index = 2;
    cfg.layers[2].index = 99;

    const b = newManager();
    b.applyConfig(cfg);
    expect(indices(b)).toEqual([0, 1, 2]);
    expect(b.all.every((l, i) => l.config.index === i)).toBe(true);
  });
});

describe("LayerManager: layers and maps are never emptied", () => {
  it("removeLayer refuses the last layer", () => {
    const m = newManager();
    expect(m.removeLayer(0)).toBe(true); // 2 -> 1
    expect(m.all.length).toBe(1);
    expect(m.removeLayer(0)).toBe(false); // refuse the last
    expect(m.all.length).toBe(1);
  });

  it("removeNeighborsMap refuses the last map", () => {
    const m = newManager();
    expect(m.allNeighborsMaps.length).toBe(1);
    expect(m.removeNeighborsMap(0)).toBe(false); // refuse the last
    expect(m.allNeighborsMaps.length).toBe(1);
  });
});

describe("LayerManager: getConfig() is a detached clone (the undo safety line)", () => {
  it("a captured config does not move when the manager mutates afterward", () => {
    const m = newManager();
    m.setName(0, "first");

    const snap = m.getConfig();
    const snapLen = snap.layers.length;
    const snapName0 = snap.layers[0].name;
    const snapActive = snap.activeIndex;

    // Mutate the live manager in ways an undo snapshot must not retroactively see.
    m.addLayer();
    m.setName(0, "RENAMED");
    m.setActive(0);

    // The previously captured snapshot is frozen at capture time.
    expect(snap.layers.length).toBe(snapLen);
    expect(snap.layers[0].name).toBe(snapName0);
    expect(snap.activeIndex).toBe(snapActive);

    // ...and a fresh read does reflect the changes, so the snapshot above was a
    // real point-in-time copy, not getConfig() silently returning stale data.
    const fresh = m.getConfig();
    expect(fresh.layers.length).toBe(snapLen + 1);
    expect(fresh.layers[0].name).toBe("RENAMED");
  });

  it("detaches nested config (layer fields, maps, background), not just the top array", () => {
    const m = newManager();
    const snap = m.getConfig();

    // Element-level identity is detached: a shallow copy of the snapshot would
    // alias the live config object here, so this fails on a shallow-clone regression.
    expect(snap.layers[0]).not.toBe(m.all[0].config);

    // Mutating live nested state must not move the captured snapshot.
    m.setOpacity(0, 33);
    m.setBackground({ color: "#000000" });
    m.addNeighborsMap();

    expect(snap.layers[0].opacity).toBe(100); // the default, pre-mutation
    expect(snap.background.color).toBe("#ffffff");
    expect(snap.neighborsMaps.length).toBe(1);
  });
});

describe("LayerManager: applyConfig round-trips by index; getPaintData keyed by index", () => {
  it("applyConfig reproduces the layer structure by index", () => {
    const a = newManager();
    a.addLayer(); // 3 layers: indices 0,1,2
    a.setName(0, "base");
    a.setName(2, "top");
    a.setOpacity(1, 50);
    const cfg = a.getConfig();

    const b = newManager(); // starts with its own 2 layers
    b.applyConfig(cfg);

    expect(b.all.length).toBe(a.all.length);
    b.all.forEach((l, i) => {
      expect(l.config.index).toBe(i);
      expect(l.config.id).toBe(cfg.layers[i].id);
      expect(l.config.name).toBe(cfg.layers[i].name);
      expect(l.config.opacity).toBe(cfg.layers[i].opacity);
    });
    expect(b.activeIdx).toBe(cfg.activeIndex);
  });

  it("carries non-layer state across applyConfig (maps / background)", () => {
    const a = newManager();
    a.addLayer(); // 3 layers
    a.addNeighborsMap(); // 2 maps
    a.selectNeighborsMap(1);
    a.setBackground({ color: "#abcdef", transparent: true });
    const cfg = a.getConfig();

    const b = newManager(); // fresh defaults: 1 map, white bg
    b.applyConfig(cfg);

    // Each is non-default, so these only pass if applyConfig actually round-trips
    // the non-layer state (not just the layers array).
    expect(b.allNeighborsMaps.length).toBe(a.allNeighborsMaps.length);
    expect(b.selectedNeighborsMapIdx).toBe(cfg.selectedNeighborsMapIndex);
    expect(b.getBackground().color).toBe("#abcdef");
    expect(b.getBackground().transparent).toBe(true);
  });

  it("getPaintData snapshots layers keyed by config.index (applyPaintData's match key)", async () => {
    const a = newManager();
    a.addLayer(); // indices 0,1,2
    const paint = await a.getPaintData();
    expect(paint.layers.map((l) => l.layerIndex)).toEqual([0, 1, 2]);
  });
});

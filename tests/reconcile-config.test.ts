import { describe, it, expect, beforeEach } from "vitest";

import type { LayerManager } from "../src/layered/manager";
import type { LayersConfig } from "../src/layered/schema";
import { installDocumentStub, newManager } from "./_layer-manager-harness";

installDocumentStub();

// reconcileConfig is the pixel-preserving config apply (matches surviving layers/
// maps by stable id and keeps their canvas/finder). PR7 pins its behaviour with
// round-trips ahead of its promotion to a live undo/redo restore path (risk S8).
// The bare harness has no real pixels, so "pixels preserved" is asserted as
// "the same Layer instance (hence the same canvas) is retained".

describe("reconcileConfig round-trips", () => {
  let manager: LayerManager;

  beforeEach(() => {
    manager = newManager();
  });

  // Clone the live config, mutate it, reconcile.
  const reconcile = (mutate: (cfg: LayersConfig) => void): void => {
    const cfg = manager.getConfig();
    mutate(cfg);
    manager.reconcileConfig(cfg);
  };

  it("opacity: updates the survivor without recreating it", () => {
    const layer = manager.all[0];
    reconcile((cfg) => {
      cfg.layers[0].opacity = 42;
    });
    expect(manager.all[0]).toBe(layer); // same instance => pixels preserved
    expect(manager.all[0].config.opacity).toBe(42);
    expect(manager.all[0].canvas.style.opacity).toBe("0.42");
  });

  it("rename: updates the name in place", () => {
    const layer = manager.all[1];
    reconcile((cfg) => {
      cfg.layers[1].name = "Renamed";
    });
    expect(manager.all[1]).toBe(layer);
    expect(manager.all[1].config.name).toBe("Renamed");
  });

  it("reorder: keeps every surviving layer's canvas, in the new order", () => {
    const [l0, l1] = [manager.all[0], manager.all[1]];
    reconcile((cfg) => cfg.layers.reverse());
    expect(manager.all[0]).toBe(l1); // reordered, not rebuilt
    expect(manager.all[1]).toBe(l0);
  });

  it("z-index renumber: config.index + zIndex track the new array position", () => {
    const [l0, l1] = [manager.all[0], manager.all[1]];
    reconcile((cfg) => cfg.layers.reverse());
    expect(manager.all[0].config.index).toBe(0);
    expect(manager.all[1].config.index).toBe(1);
    // z-index is 1-based (index + 1).
    expect(manager.all[0].canvas.style.zIndex).toBe("1");
    expect(manager.all[1].canvas.style.zIndex).toBe("2");
    // the reversed pair carried its identity across the renumber
    expect(manager.all[0]).toBe(l1);
    expect(manager.all[1]).toBe(l0);
  });

  it("background: adopts the new background", () => {
    reconcile((cfg) => {
      cfg.background = { color: "#123456", transparent: true };
    });
    expect(manager.getBackground()).toEqual({ color: "#123456", transparent: true });
  });

  it("activeIndex clamp: an out-of-range index is clamped into the stack", () => {
    reconcile((cfg) => {
      cfg.activeIndex = 99;
    });
    expect(manager.activeIdx).toBe(manager.all.length - 1);
    reconcile((cfg) => {
      cfg.activeIndex = -5;
    });
    expect(manager.activeIdx).toBe(0);
  });

  it("wet-overlay z-order: the overlay sits just above the active layer after a reorder", () => {
    // Reverse the stack and make the bottom layer active. The wet buffer opens at
    // z-index active.config.index + 1 (WetStrokeBuffer.begin / manager.beginStroke).
    reconcile((cfg) => {
      cfg.layers.reverse();
      cfg.activeIndex = 0;
    });
    const active = manager.active;
    const wetZ = active.config.index + 1;
    // Co-planar with the active layer (the overlay paints on top via DOM order)...
    expect(Number(active.canvas.style.zIndex)).toBe(wetZ);
    // ...and below the layer directly above it, so it never hides that layer.
    const above = manager.all[manager.activeIdx + 1];
    expect(Number(above.canvas.style.zIndex)).toBeGreaterThan(wetZ);
  });

  it("adds new layers empty and drops removed ones, preserving survivors", () => {
    const survivor = manager.all[0];
    const survivorId = survivor.config.id;
    reconcile((cfg) => {
      cfg.layers = [
        cfg.layers[0], // keep the first (same id)
        { id: "brand-new", index: 1, name: "New", types: ["normal"], opacity: 100 },
      ];
    });
    expect(manager.all).toHaveLength(2);
    expect(manager.all[0]).toBe(survivor); // survivor kept (canvas/pixels intact)
    expect(manager.all[0].config.id).toBe(survivorId);
    expect(manager.all[1].config.id).toBe("brand-new");
    expect(manager.all[1]).not.toBe(survivor);
  });

  it("preserves surviving maps by id (name/opacity reconciled in place)", () => {
    const map = manager.allNeighborsMaps[0];
    reconcile((cfg) => {
      cfg.neighborsMaps[0].name = "Renamed map";
      cfg.neighborsMaps[0].opacity = 55;
    });
    expect(manager.allNeighborsMaps[0]).toBe(map); // same finder => points preserved
    expect(manager.allNeighborsMaps[0].config.name).toBe("Renamed map");
    expect(manager.allNeighborsMaps[0].config.opacity).toBe(55);
  });
});

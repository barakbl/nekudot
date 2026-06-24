import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Minimal DOM stub. LayerManager builds real <canvas>-backed layers, so we give
// it just enough of `document` + a canvas 2D context (every ctx method is a
// no-op) to run headlessly in the node test environment. This lets us exercise
// the actual manager logic rather than a re-implementation of it.
// ---------------------------------------------------------------------------
function makeCanvasStub(): HTMLCanvasElement {
  const canvas: Record<string, unknown> = {
    width: 0,
    height: 0,
    style: {},
    remove() {},
  };
  const ctx = new Proxy(
    { canvas } as Record<string, unknown>,
    {
      get: (t, p) => (p in t ? t[p as string] : () => {}),
      set: (t, p, v) => {
        t[p as string] = v;
        return true;
      },
    },
  );
  canvas.getContext = () => ctx;
  return canvas as unknown as HTMLCanvasElement;
}

(globalThis as { document?: unknown }).document = {
  createElement: (tag: string) =>
    tag === "canvas"
      ? makeCanvasStub()
      : { style: {}, appendChild() {}, remove() {} },
};

import { LayerManager } from "../src/layered/manager";
import { defaultLayersConfig } from "../src/layered/schema";

const container = { style: {}, appendChild() {} } as unknown as HTMLElement;

// Fresh manager with no store -> seeded from defaultLayersConfig.
function newManager(): LayerManager {
  return new LayerManager({ container, size: { width: 100, height: 100 }, dpr: 1 });
}

const connId = (m: LayerManager) => m.all[m.activeConnectionIdx].config.id;

describe("default new artwork", () => {
  it("starts with two layers: layer-2 selected, layer-1 the connection layer", () => {
    const m = newManager();
    expect(m.all.length).toBe(2);
    expect(m.all.map((l) => l.config.name)).toEqual(["layer-1", "layer-2"]);
    expect(m.activeIdx).toBe(1); // layer-2 selected for painting
    expect(m.activeConnectionIdx).toBe(0); // layer-1 holds connections
    expect(m.activeConnectionLayerId()).toBe(m.all[0].config.id);
  });

  it("matches defaultLayersConfig (the create/reset default)", () => {
    const cfg = defaultLayersConfig();
    expect(cfg.layers.length).toBe(2);
    expect(cfg.activeIndex).toBe(1);
    expect(cfg.activeConnectionIndex).toBe(0);
  });
});

describe("setActiveConnection", () => {
  it("moves the connection independently of the selected layer", () => {
    const m = newManager();
    m.setActiveConnection(1);
    expect(m.activeConnectionIdx).toBe(1);
    expect(m.activeConnectionLayerId()).toBe(m.all[1].config.id);
    expect(m.activeIdx).toBe(1); // selection untouched
  });

  it("ignores out-of-range indices", () => {
    const m = newManager();
    m.setActiveConnection(99);
    m.setActiveConnection(-1);
    expect(m.activeConnectionIdx).toBe(0);
  });
});

describe("addLayer", () => {
  it("carries the connection to the new layer when selected === connection", () => {
    const m = newManager();
    m.setActive(0); // selected and connection now both layer-1 (index 0)
    expect(m.activeIdx).toBe(0);
    expect(m.activeConnectionIdx).toBe(0);
    m.addLayer();
    expect(m.activeIdx).toBe(2); // new layer selected
    expect(m.activeConnectionIdx).toBe(2); // ...and took the connection too
  });

  it("leaves the connection in place when selected !== connection", () => {
    const m = newManager(); // selected=1, connection=0
    m.addLayer();
    expect(m.activeIdx).toBe(2);
    expect(m.activeConnectionIdx).toBe(0); // unchanged
  });
});

describe("duplicateLayer", () => {
  it("carries the connection to the copy when duplicating the connection layer", () => {
    const m = newManager(); // connection = index 0
    m.duplicateLayer(0);
    expect(m.activeIdx).toBe(2);
    expect(m.activeConnectionIdx).toBe(2);
  });

  it("leaves the connection in place when duplicating any other layer", () => {
    const m = newManager(); // connection = index 0
    const before = connId(m);
    m.duplicateLayer(1); // duplicate the non-connection layer
    expect(m.activeIdx).toBe(2);
    expect(m.activeConnectionIdx).toBe(0);
    expect(connId(m)).toBe(before);
  });
});

describe("removeLayer", () => {
  // Helper: build a 3-layer manager (indices 0,1,2).
  function threeLayers(): LayerManager {
    const m = newManager();
    m.addLayer();
    return m;
  }

  it("hands the connection to the layer under it when the connection layer is deleted", () => {
    const m = threeLayers();
    m.setActiveConnection(2); // top layer holds connection
    m.removeLayer(2);
    expect(m.all.length).toBe(2);
    expect(m.activeConnectionIdx).toBe(1); // the layer that was under it
  });

  it("keeps the connection on the bottom when the bottom connection layer is deleted", () => {
    const m = threeLayers();
    m.setActiveConnection(0);
    m.removeLayer(0);
    expect(m.activeConnectionIdx).toBe(0); // new bottom inherits it
  });

  it("shifts the connection index down but keeps pointing at the same layer when a lower layer is removed", () => {
    const m = threeLayers();
    m.setActiveConnection(2);
    const target = connId(m);
    m.removeLayer(0); // remove a layer below the connection layer
    expect(m.activeConnectionIdx).toBe(1); // 2 -> 1 after the shift
    expect(connId(m)).toBe(target); // still the same layer
  });

  it("leaves the connection index untouched when a higher layer is removed", () => {
    const m = threeLayers();
    m.setActiveConnection(0);
    m.removeLayer(2); // remove a layer above the connection layer
    expect(m.activeConnectionIdx).toBe(0);
  });

  it("keeps the connection index valid after deleting down to one layer", () => {
    const m = newManager(); // 2 layers, connection = 0
    m.setActiveConnection(1);
    m.removeLayer(1);
    expect(m.all.length).toBe(1);
    expect(m.activeConnectionIdx).toBe(0);
    expect(m.activeConnectionLayerId()).toBe(m.all[0].config.id);
  });
});

describe("getConfig persistence", () => {
  it("round-trips activeConnectionIndex", () => {
    const m = newManager();
    m.setActiveConnection(1);
    expect(m.getConfig().activeConnectionIndex).toBe(1);
  });
});

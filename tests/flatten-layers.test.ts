import { describe, it, expect } from "vitest";

import { flattenLayers } from "../src/export";
import { installDocumentStub, newManager } from "./_layer-manager-harness";

installDocumentStub();

// A renderer that records the compositing calls flattenLayers makes into it.
function recordingRenderer() {
  const calls: { method: string; args: unknown[] }[] = [];
  const renderer = new Proxy(
    {},
    {
      get:
        (_t, p) =>
        (...args: unknown[]) => {
          calls.push({ method: String(p), args });
        },
    },
  );
  return { renderer: renderer as never, calls };
}

describe("LayerManager.orderedLayers", () => {
  it("returns layers in ascending config.index, matching array order", () => {
    const m = newManager();
    m.addLayer(); // indices 0,1,2
    expect(m.orderedLayers().map((l) => l.config.index)).toEqual([0, 1, 2]);

    // Reverse the order: orderedLayers stays ascending by index (renumber keeps
    // config.index == position) and tracks the new layer identities.
    m.reorderByIds(m.all.map((l) => l.config.id).reverse());
    expect(m.orderedLayers().map((l) => l.config.index)).toEqual([0, 1, 2]);
    expect(m.orderedLayers().map((l) => l.config.id)).toEqual(
      m.all.map((l) => l.config.id),
    );
  });
});

describe("flattenLayers (the single compositing source of truth)", () => {
  it("fills the background then composites every layer in index order at opacity/100", () => {
    const m = newManager();
    m.addLayer(); // 3 layers
    m.setOpacity(0, 80);
    m.setOpacity(1, 40);
    m.setOpacity(2, 20);

    const flat = recordingRenderer();
    m.createMatchingRenderer = () => flat.renderer;

    flattenLayers(m, { backgroundColor: "#ffffff" });

    expect(
      flat.calls.filter((c) => c.method === "fillBackground").map((c) => c.args[0]),
    ).toEqual(["#ffffff"]);
    expect(
      flat.calls.filter((c) => c.method === "drawSource").map((c) => c.args[1]),
    ).toEqual([80 / 100, 40 / 100, 20 / 100]);
  });

  it('skips the background fill when it is "transparent"', () => {
    const m = newManager();
    const flat = recordingRenderer();
    m.createMatchingRenderer = () => flat.renderer;

    flattenLayers(m, { backgroundColor: "transparent" });

    expect(flat.calls.some((c) => c.method === "fillBackground")).toBe(false);
    // layers are still composited
    expect(flat.calls.some((c) => c.method === "drawSource")).toBe(true);
  });
});

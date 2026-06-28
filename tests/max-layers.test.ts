import { describe, it, expect } from "vitest";

import { LayerManager } from "../src/layered/manager";
import { MAX_LAYERS_DEFAULT, defaultLayersConfig } from "../src/layered/schema";
import { installDocumentStub, newManager } from "./_layer-manager-harness";

installDocumentStub();

const container = { style: {}, appendChild() {} } as unknown as HTMLElement;

describe("layer cap", () => {
  it("defaults to 10 and addLayer stops there", () => {
    expect(MAX_LAYERS_DEFAULT).toBe(10);
    const m = newManager(); // starts with 2 layers
    while (m.canAddMore()) m.addLayer();
    expect(m.all.length).toBe(10);
    expect(m.addLayer()).toBeNull();
  });

  it("the code cap wins over a stale persisted value (bumps returning users)", () => {
    const persisted = { ...defaultLayersConfig(5), maxLayers: 5 };
    const store = { get: () => persisted, set() {}, remove() {} };
    const m = new LayerManager({
      container,
      size: { width: 100, height: 100 },
      dpr: 1,
      maxLayers: 10,
      store: store as never,
    });
    expect(m.maxLayers).toBe(10);
  });
});

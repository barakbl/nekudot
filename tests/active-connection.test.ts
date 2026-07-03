import { describe, it, expect } from "vitest";

import { defaultLayersConfig } from "../src/layered/schema";
import { installDocumentStub, newManager } from "./_layer-manager-harness";

installDocumentStub();

// The connecting web bakes onto the active layer (there is no separate
// connection layer). activeConnectionLayerId() always tracks the selected layer.
describe("connections target the active layer", () => {
  it("starts with two layers, Layer 2 selected", () => {
    const m = newManager();
    expect(m.all.map((l) => l.config.name)).toEqual(["Layer 1", "Layer 2"]);
    expect(m.activeIdx).toBe(1);
    expect(m.activeConnectionLayerId()).toBe(m.active.config.id);
  });

  it("follows the selection when the active layer changes", () => {
    const m = newManager();
    m.setActive(0);
    expect(m.activeConnectionLayerId()).toBe(m.all[0].config.id);
    m.setActive(1);
    expect(m.activeConnectionLayerId()).toBe(m.all[1].config.id);
  });

  it("targets the new layer after addLayer", () => {
    const m = newManager();
    m.addLayer();
    expect(m.activeIdx).toBe(2);
    expect(m.activeConnectionLayerId()).toBe(m.all[2].config.id);
  });

  it("no longer persists a connection index", () => {
    const m = newManager();
    expect("activeConnectionIndex" in m.getConfig()).toBe(false);
    expect("activeConnectionIndex" in defaultLayersConfig()).toBe(false);
  });
});

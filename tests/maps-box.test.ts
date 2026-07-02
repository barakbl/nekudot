// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { createMapsBox, type MapsControl } from "../src/layered/maps-box";

function control(): MapsControl {
  return {
    getInfo: () => ({ maps: [{ name: "map-1", dots: 0, active: true }] }),
    onFlashActive: () => {},
    onFlashMap: () => {},
    onAddMap: () => {},
    onRenameMap: () => {},
    onSelectMap: () => {},
    onDeleteMap: () => {},
    getHighlightColor: () => "#ffcc00",
    onPickHighlightColor: () => {},
    subscribe: () => () => {},
  };
}

describe("Memory Maps panel explainer (#93)", () => {
  it("pins an always-visible explainer of the memory-map idea", () => {
    const box = createMapsBox(control());
    const intro = box.el.querySelector(".maps-intro");
    expect(intro).not.toBeNull();
    expect(intro?.textContent).toMatch(/remembered/i);
    // A plain always-on panel child, not an opt-in help chip.
    expect(intro?.parentElement).toBe(box.el);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { Store } from "../src/store/base";
import { createBareHost } from "../src/paint-host";
import { RoundBrush } from "../src/brushes/round";
import type { BrushBase, BrushSetting } from "../src/base";
import type { IRenderer } from "../src/renderer";
import type { NeighborFinder, Pixel } from "../src/neighbor-finder";

// In-memory store that counts writes — so "restore must not write back" is
// checkable, not just asserted in prose.
class FakeStore extends Store {
  data = new Map<string, unknown>();
  sets = 0;
  get<T>(key: string): T | undefined {
    return this.data.has(key) ? (this.data.get(key) as T) : undefined;
  }
  set<T>(key: string, value: T): void {
    this.sets++;
    this.data.set(key, value);
  }
}

const noopRenderer = new Proxy({}, { get: () => () => {} }) as unknown as IRenderer;
function makeFinder(): NeighborFinder {
  let id = 0;
  return {
    addPixel: (x, y) => ({ id: id++, x, y }) as Pixel,
    findNeighbors: () => [],
    allPixels: () => [],
    pixelCount: () => id,
    livePixelCount: () => 0,
    clear: () => {},
  };
}

const newRound = (store: FakeStore) =>
  new RoundBrush(createBareHost(noopRenderer, makeFinder()), 1, store);

// Find a setting descriptor by key in the current getSettings() snapshot.
const find = (b: BrushBase, key: string): BrushSetting => {
  const s = b.getSettings().find((x) => x.key === key);
  if (!s) throw new Error(`no setting "${key}"`);
  return s;
};
const settingValue = (b: BrushBase, key: string) => find(b, key).value;

// Simulate the panel: change a setting and persist it the way makeRow does.
const change = (b: BrushBase, key: string, v: unknown) => {
  const s = find(b, key);
  (s.onChange as (x: unknown) => void)(v);
  b.persistSetting(s, v);
};

describe("brush settings persistence", () => {
  let store: FakeStore;
  beforeEach(() => {
    store = new FakeStore();
  });

  it("persists a brush-own setting per key and restores it on a fresh brush", () => {
    const a = newRound(store);
    change(a, "strokeDash", "dashed");
    expect(store.data.get("brush.Round.strokeDash")).toBe("dashed");

    const b = newRound(store);
    const setsBefore = store.sets;
    b.restore();
    expect(settingValue(b, "strokeDash")).toBe("dashed");
    expect(store.sets).toBe(setsBefore); // restore reads, never writes back
  });

  it("persists a pen toggle (boolean, brush-own) and restores it", () => {
    const a = newRound(store);
    change(a, "penPressureAlpha", true);
    expect(store.data.get("brush.Round.penPressureAlpha")).toBe(true);
    const b = newRound(store);
    b.restore();
    expect(settingValue(b, "penPressureAlpha")).toBe(true);
  });

  it("stores art-style dials under a per-style key (the whole flat), not per dial", () => {
    const a = newRound(store);
    change(a, "density", 7);
    // No flat per-dial key; one style snapshot holds it.
    expect(store.data.get("brush.Round.density")).toBeUndefined();
    const flat = store.data.get("brush.Round.style.shaded") as Record<string, unknown>;
    expect(flat).toBeDefined();
    expect(flat.density).toBe(7);
  });

  it("restores per-style dials via selectArtStyle, not via restore()", () => {
    const def = settingValue(newRound(store), "density"); // shaded's default
    const a = newRound(store);
    change(a, "density", 7);

    const b = newRound(store);
    b.restore(); // brush-own only — style dials are NOT touched here
    expect(settingValue(b, "density")).toBe(def);
    b.selectArtStyle("shaded"); // now the saved dials load
    expect(settingValue(b, "density")).toBe(7);
  });

  it("remembers each style's dials independently", () => {
    const a = newRound(store);
    a.selectArtStyle("shaded");
    change(a, "density", 7);
    a.selectArtStyle("web");
    const webDefault = settingValue(a, "density");
    change(a, "density", webDefault === 9 ? 11 : 9); // anything but its default
    const webCustom = settingValue(a, "density");

    const b = newRound(store);
    b.selectArtStyle("web");
    expect(settingValue(b, "density")).toBe(webCustom);
    b.selectArtStyle("shaded");
    expect(settingValue(b, "density")).toBe(7); // shaded's own value, not web's
  });

  it("resetArtStyle overwrites saved dials with the preset defaults", () => {
    const def = settingValue(newRound(store), "density");
    const a = newRound(store);
    change(a, "density", 7);
    a.resetArtStyle("shaded");
    expect(settingValue(a, "density")).toBe(def);

    const b = newRound(store);
    b.selectArtStyle("shaded");
    expect(settingValue(b, "density")).toBe(def); // the custom 7 is gone
  });

  it("switching styles preserves routing (copied), independent of per-style dials", () => {
    const a = newRound(store);
    change(a, "connecting_mode", "stroke");
    a.selectArtStyle("web");
    expect(settingValue(a, "connecting_mode")).toBe("stroke");
  });

  it("resetSettings reverts brush-own params and art-style dials to defaults", () => {
    const a = newRound(store);
    a.restore(); // captures the brush-own defaults
    const dashDefault = settingValue(a, "strokeDash");
    const densityDefault = settingValue(a, "density");
    change(a, "strokeDash", "dotted");
    change(a, "density", 3);
    change(a, "connecting_mode", "stroke"); // routing — should be PRESERVED
    a.resetSettings();
    expect(settingValue(a, "strokeDash")).toBe(dashDefault);
    expect(settingValue(a, "density")).toBe(densityDefault);
    expect(settingValue(a, "connecting_mode")).toBe("stroke"); // routing kept
  });

  it("reset persists — a reloaded brush is default too", () => {
    const a = newRound(store);
    a.restore();
    const densityDefault = settingValue(a, "density");
    change(a, "density", 3);
    a.resetSettings();

    const b = newRound(store);
    b.restore();
    b.selectArtStyle("shaded");
    expect(settingValue(b, "density")).toBe(densityDefault);
  });
});

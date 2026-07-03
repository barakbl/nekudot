import { describe, it, expect } from "vitest";
import { EraserBrush } from "../src/brushes/eraser";
import {
  applySettingValue,
  isConnectingSetting,
  type BrushSetting,
} from "../src/base";
import { createBareHost } from "../src/paint-host";
import { createNeighborFinder } from "../src/neighbor-finder";
import type { IRenderer } from "../src/renderer";

// The Eraser's three-way "Erase" mode decides what a wipe removes: the paint,
// the remembered dots, or both. "both" (default) draws the erase mark AND
// forgets the dots under it; "paint" only draws; "dots" only forgets. These
// tests drive a real tap over a bare host wired into a live quadtree finder and
// assert which of the two effects fired: a captured drawLine (paint wiped) and
// a shrunk point cloud (dots forgotten).

// A renderer that records drawLine calls; every other method is a no-op.
function spyRenderer() {
  const drawn: unknown[][] = [];
  const renderer = new Proxy(
    { drawLine: (...args: unknown[]) => drawn.push(args) },
    { get: (t, p) => (p in t ? (t as Record<string, unknown>)[p] : () => {}) },
  ) as unknown as IRenderer;
  return { renderer, drawn };
}

function makeEraser(mode: "both" | "paint" | "dots") {
  const finder = createNeighborFinder("quadtree", []);
  finder.addPixel(100, 100); // a dot right under the stroke
  finder.addPixel(300, 300); // a dot far away - always survives
  const { renderer, drawn } = spyRenderer();
  // isErasing() must be true for the brush to take its erase path (bare host
  // answers false); everything else - drawLine, forgetPointsNear - is genuine.
  const host = { ...createBareHost(renderer, finder), isErasing: () => true };
  const brush = new EraserBrush(host, 1);
  const setting = brush
    .getSettings()
    .find((s: BrushSetting) => s.key === "eraseMode")!;
  applySettingValue(setting, mode);
  return { brush, finder, drawn };
}

function tapErase(brush: EraserBrush) {
  brush.strokeStart(100, 100);
  brush.stroke(100, 100, true);
  brush.strokeEnd();
}

describe("Eraser three-way erase mode", () => {
  it('defaults to "both"', () => {
    const finder = createNeighborFinder("quadtree", []);
    const brush = new EraserBrush(createBareHost(spyRenderer().renderer, finder));
    const setting = brush
      .getSettings()
      .find((s: BrushSetting) => s.key === "eraseMode")!;
    expect(setting.value).toBe("both");
  });

  it("is a plain eraser: no connection, so no Web tab and no web dials", () => {
    const finder = createNeighborFinder("quadtree", []);
    const brush = new EraserBrush(createBareHost(spyRenderer().renderer, finder));
    expect(brush.supportsConnecting()).toBe(false);
    expect(brush.activeConnection()).toBeNull();
    // No connecting/web dials at all - only the eraser's own Erase mode + pen.
    expect(brush.getSettings().some(isConnectingSetting)).toBe(false);
  });

  it('"both" wipes the paint AND forgets the dots under it', () => {
    const { brush, finder, drawn } = makeEraser("both");
    tapErase(brush);
    expect(drawn.length).toBeGreaterThan(0); // paint wiped
    expect(finder.livePixelCount()).toBe(1); // near dot forgotten, far one kept
  });

  it('"paint" wipes the paint but keeps every dot', () => {
    const { brush, finder, drawn } = makeEraser("paint");
    tapErase(brush);
    expect(drawn.length).toBeGreaterThan(0); // paint wiped
    expect(finder.livePixelCount()).toBe(2); // both dots kept
  });

  it('"dots" forgets the dots without touching the paint', () => {
    const { brush, finder, drawn } = makeEraser("dots");
    tapErase(brush);
    expect(drawn.length).toBe(0); // no paint wiped
    expect(finder.livePixelCount()).toBe(1); // near dot forgotten, far one kept
  });
});

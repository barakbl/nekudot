import { describe, it, expect } from "vitest";
import { SymmetryController } from "../src/symmetry/controller";

// Tile "Fill canvas" must spread copies evenly across the WHOLE canvas, not
// cluster around the stroke (the bug: fill collapsed into a fading disk centred
// on the pen, so a stroke on the left left the right side empty). The logic now
// lives in the TileTool, so drive it through the controller (the real path).

type Opts = {
  xSpacing: number;
  ySpacing: number;
  reach: number;
  falloffPct: number;
  fillCanvas: boolean;
};
const base: Opts = { xSpacing: 40, ySpacing: 40, reach: 140, falloffPct: 70, fillCanvas: false };
const size = { width: 1000, height: 700 };

// Run the Tile tool with the given params + stroke anchor, returning its copies.
function tileTs(opts: Opts, startX: number, startY: number, sz = size) {
  const c = new SymmetryController({ get: () => undefined, set() {} } as never);
  c.setMode("tile");
  c.setActiveSetting("xSpacing", opts.xSpacing);
  c.setActiveSetting("ySpacing", opts.ySpacing);
  c.setActiveSetting("reach", opts.reach);
  c.setActiveSetting("falloffPct", opts.falloffPct);
  c.setActiveSetting("fillCanvas", opts.fillCanvas);
  c.beginStroke(startX, startY, sz);
  return c.transforms();
}

describe("Tile fill canvas (TileTool)", () => {
  it("covers the whole canvas even when the stroke is in a corner", () => {
    const ts = tileTs({ ...base, fillCanvas: true }, 20, 20);
    const xs = ts.map((t) => 20 + t.e); // absolute x of each copied stroke
    const ys = ts.map((t) => 20 + t.f);
    expect(Math.min(...xs)).toBeLessThanOrEqual(base.xSpacing);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(size.width - base.xSpacing);
    expect(Math.min(...ys)).toBeLessThanOrEqual(base.ySpacing);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(size.height - base.ySpacing);
  });

  it("places every copy at full strength (no falloff)", () => {
    const ts = tileTs({ ...base, fillCanvas: true }, 500, 350);
    expect(ts.every((t) => t.aMul === 1)).toBe(true);
    expect(ts.length).toBeGreaterThan(10);
  });

  it("stays bounded for a very dense grid (and keeps coverage even)", () => {
    const dense = { ...base, xSpacing: 10, ySpacing: 10, fillCanvas: true };
    const big = { width: 2560, height: 1440 };
    const ts = tileTs(dense, 30, 30, big);
    expect(ts.length).toBeLessThanOrEqual(1600);
    const xs = ts.map((t) => 30 + t.e);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(big.width - 200);
  });

  it("reach mode is unchanged when fill is off", () => {
    const ts = tileTs(base, 500, 350);
    expect(ts.some((t) => t.aMul < 1)).toBe(true); // faded toward the reach edge
    expect(ts.every((t) => Math.hypot(t.e, t.f) <= base.reach + 1e-9)).toBe(true);
  });
});

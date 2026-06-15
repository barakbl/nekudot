import { describe, it, expect } from "vitest";
import { tileTransforms, type TileParams } from "../src/symmetry/transforms";

// Tile "Fill canvas" must spread copies evenly across the WHOLE canvas, not
// cluster around the stroke (the bug: fill collapsed into a fading disk centred
// on the pen, so a stroke on the left left the right side empty).

const base: TileParams = {
  xSpacing: 40,
  ySpacing: 40,
  reach: 140,
  falloffPct: 70,
  fillCanvas: false,
};
const size = { width: 1000, height: 700 };

describe("tileTransforms — fill canvas", () => {
  it("covers the whole canvas even when the stroke is in a corner", () => {
    // Draw near the top-left corner: the OLD code kept only the copies nearest
    // here, leaving the right/bottom empty. Coverage must reach every edge.
    const ts = tileTransforms({ ...base, fillCanvas: true }, 20, 20, size);
    const xs = ts.map((t) => 20 + t.e); // absolute x of each copied stroke
    const ys = ts.map((t) => 20 + t.f);
    expect(Math.min(...xs)).toBeLessThanOrEqual(base.xSpacing);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(size.width - base.xSpacing);
    expect(Math.min(...ys)).toBeLessThanOrEqual(base.ySpacing);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(size.height - base.ySpacing);
  });

  it("places every copy at full strength (no falloff)", () => {
    const ts = tileTransforms({ ...base, fillCanvas: true }, 500, 350, size);
    expect(ts.every((t) => t.aMul === 1)).toBe(true);
    expect(ts.length).toBeGreaterThan(10);
  });

  it("stays bounded for a very dense grid (and keeps coverage even)", () => {
    const dense = { ...base, xSpacing: 10, ySpacing: 10, fillCanvas: true };
    const big = { width: 2560, height: 1440 };
    const ts = tileTransforms(dense, 30, 30, big);
    expect(ts.length).toBeLessThanOrEqual(1600);
    // still reaches the far edges (even, not a corner blob)
    const xs = ts.map((t) => 30 + t.e);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(big.width - 200);
  });

  it("ignores fill when no canvas size is given (falls back to reach)", () => {
    const ts = tileTransforms({ ...base, fillCanvas: true }, 500, 350);
    // reach mode fades copies toward the edge → at least one partial-opacity copy
    expect(ts.some((t) => t.aMul < 1)).toBe(true);
  });

  it("reach mode is unchanged when fill is off", () => {
    const ts = tileTransforms(base, 500, 350, size);
    expect(ts.some((t) => t.aMul < 1)).toBe(true); // faded toward the reach edge
    // every copy within `reach` of the anchor
    expect(ts.every((t) => Math.hypot(t.e, t.f) <= base.reach + 1e-9)).toBe(true);
  });
});

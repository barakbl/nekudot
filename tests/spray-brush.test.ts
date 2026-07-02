import { describe, it, expect } from "vitest";
import { SprayBrush } from "../src/brushes/spray";
import type { Pixel } from "../src/neighbor-finder";

// The Spray (airbrush) brush: each frame scatters `flow` specks within a radius
// and deposits exactly ONE searchable point (the throttled feeder). strokeStart
// fires one immediate puff (so a tap leaves a mark) - we exercise that, which
// runs spray() once without needing requestAnimationFrame.
function setup() {
  const specks: { x: number; y: number; r: number }[] = [];
  const points: { x: number; y: number }[] = [];
  const host = {
    fillCircle: (x: number, y: number, r: number) => specks.push({ x, y, r }),
    addPixel: (x: number, y: number): Pixel => {
      points.push({ x, y });
      return { id: 0, x, y };
    },
    selectedMapId: () => "",
    strokeWidth: () => 1,
  } as never;
  const brush = new SprayBrush(host, 1); // fixed seed, no store
  return { brush, specks, points };
}

describe("Spray brush", () => {
  it("a puff scatters `flow` specks and deposits ONE point (throttled feeder)", () => {
    const { brush, specks, points } = setup();
    brush.strokeStart(50, 50); // one immediate puff
    expect(specks.length).toBe(12); // default Flow
    expect(points.length).toBe(1); // one deposit per frame, not one per speck
  });

  it("keeps every speck inside the radius disc", () => {
    const { brush, specks } = setup();
    brush.strokeStart(50, 50);
    for (const s of specks) {
      expect(Math.hypot(s.x - 50, s.y - 50)).toBeLessThanOrEqual(28 + 1e-9); // default Radius
      expect(s.r).toBeCloseTo(2); // dotSize 4 -> radius 2
    }
  });

  it("does not buffer (specks build individually) and selects at a soft-but-visible opacity", () => {
    const { brush } = setup();
    expect(brush.bufferedStroke()).toBe(false);
    expect(brush.getSelectOpacity()).toBeGreaterThanOrEqual(0.3);
    expect(brush.getSelectOpacity()).toBeLessThan(0.5);
  });
});

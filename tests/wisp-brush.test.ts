import { describe, it, expect } from "vitest";
import { WispBrush } from "../src/brushes/wisp";
import type { Pixel } from "../src/neighbor-finder";

// The Wisp (smoke plume) brush: a live particle system. strokeStart spawns one
// immediate batch of puffs but paints nothing yet - stamping happens in the
// 60fps loop (needs requestAnimationFrame) and in the synchronous "bake" at
// strokeEnd. We drive strokeStart -> strokeEnd, which bakes the initial batch to
// completion without a real animation frame, so the tests stay deterministic.
function setup(size = 20) {
  const specks: { x: number; y: number; r: number; c?: string; a: number }[] = [];
  const points: { x: number; y: number }[] = [];
  const host = {
    fillCircle: (x: number, y: number, r: number, c?: string, a = 1) =>
      specks.push({ x, y, r, c, a }),
    addPixel: (x: number, y: number): Pixel => {
      points.push({ x, y });
      return { id: 0, x, y };
    },
    selectedMapId: () => "",
    strokeWidth: () => size,
    strokeAlpha: () => 1,
  } as never;
  const brush = new WispBrush(host, 1); // fixed seed, no store
  return { brush, specks, points };
}

describe("Wisp brush", () => {
  it("paints nothing until the plume is baked at stroke end", () => {
    const { brush, specks } = setup();
    brush.strokeStart(50, 50); // spawns puffs, but the loop/bake does the drawing
    expect(specks.length).toBe(0);
  });

  it("bakes the whole plume on release (fast-forwards past the initial batch)", () => {
    const { brush, specks } = setup();
    brush.strokeStart(50, 50);
    brush.strokeEnd();
    // The initial batch is 6 puffs; baking advances + stamps each across its
    // whole fading life, so far more stamps land than there are particles.
    expect(specks.length).toBeGreaterThan(6);
    // A second end paints nothing: the bake drained every particle.
    const baked = specks.length;
    brush.strokeEnd();
    expect(specks.length).toBe(baked);
  });

  it("every baked stamp is a soft, growing, fading puff", () => {
    const { brush, specks } = setup(20);
    brush.strokeStart(50, 50);
    brush.strokeEnd();
    for (const s of specks) {
      expect(s.a).toBeGreaterThanOrEqual(0.002); // spent puffs are retired, not drawn
      expect(s.a).toBeLessThan(0.3); // starts faint (<= 0.3) and only fades
      expect(s.r).toBeGreaterThan(20 * 0.2); // radius floor = size * 0.2, then grows
    }
  });

  it("the bake deposits no feeder points (those ride live spawn frames only)", () => {
    const { brush, points } = setup();
    brush.strokeStart(50, 50);
    brush.strokeEnd();
    expect(points.length).toBe(0);
  });

  it("does not buffer (puffs composite individually)", () => {
    const { brush } = setup();
    expect(brush.bufferedStroke()).toBe(false);
    expect(brush.name()).toBe("Wisp");
  });

  it("defaults to a single colour (inherits the toolbar Primary)", () => {
    const { brush, specks } = setup();
    brush.strokeStart(50, 50);
    brush.strokeEnd();
    // The "main" source latches no colour, so every fill inherits the stroke style.
    expect(specks.every((s) => s.c === undefined)).toBe(true);
  });

  it("defaults to rising (puffs move up from the source)", () => {
    const { brush, specks } = setup();
    brush.strokeStart(50, 50);
    brush.strokeEnd();
    const meanY = specks.reduce((s, p) => s + p.y, 0) / specks.length;
    expect(meanY).toBeLessThan(50); // up = smaller y
  });

  it("Direction aims the plume (180° drives it downward)", () => {
    const { brush, specks } = setup();
    const dir = brush.getSettings().find((s) => s.key === "wispDirection");
    if (dir && dir.kind === "number") dir.onChange(180); // down
    brush.strokeStart(50, 50);
    brush.strokeEnd();
    const meanY = specks.reduce((s, p) => s + p.y, 0) / specks.length;
    expect(meanY).toBeGreaterThan(50); // down = larger y
  });

  it("a gradient source colours puffs from the palette, with spread", () => {
    const { brush, specks } = setup();
    // Rainbow needs no store (it maps a 0..1 driver straight to a hue).
    const src = brush.getSettings().find((s) => s.key === "wispColorSource");
    if (src && src.kind === "select") src.onChange("rainbow");
    brush.strokeStart(50, 50);
    brush.strokeEnd();
    const colored = specks.filter((s) => typeof s.c === "string");
    expect(colored.length).toBeGreaterThan(0);
    // The phase + spread give a range of hues, not one flat colour.
    expect(new Set(colored.map((s) => s.c)).size).toBeGreaterThan(1);
  });
});

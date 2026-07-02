import { describe, it, expect } from "vitest";
import { createBareHost } from "../src/paint-host";
import { RoundBrush } from "../src/brushes/round";
import type { IRenderer } from "../src/renderer";
import type { NeighborFinder, Pixel } from "../src/neighbor-finder";

// Regression guard for the first-run "white-out" fix (#88): the mandala start
// opens Round in the Bloomer style, whose old defaults saturated the canvas to
// white. Pins the fix invariants, not the tuned numbers, so the look can retune.

const noopRenderer = () =>
  new Proxy({}, { get: () => () => {} }) as unknown as IRenderer;

function makeFinder(): NeighborFinder {
  const pts: Pixel[] = [];
  let nextId = 0;
  return {
    addPixel(x, y) {
      const p = { id: nextId++, x, y };
      pts.push(p);
      return p;
    },
    findNeighbors(px, radius) {
      return pts.filter(
        (p) => p.id !== px.id && Math.hypot(p.x - px.x, p.y - px.y) <= radius,
      );
    },
    allPixels: () => [...pts],
    pixelCount: () => nextId,
    livePixelCount: () => pts.length,
    clear() {
      pts.length = 0;
    },
  };
}

// Web lines are drawn through host.drawConnectionToLayer, not the IRenderer, so
// spy on the host to count them (the plain bare host renders them uncountably).
function spyHost(finder: NeighborFinder) {
  const base = createBareHost(noopRenderer(), finder);
  const counts = { web: 0 };
  const host = new Proxy(base as Record<string, unknown>, {
    get(t, k, r) {
      if (k === "drawConnectionToLayer") {
        return (...args: unknown[]) => {
          counts.web++;
          return (base as { drawConnectionToLayer: (...a: unknown[]) => unknown })
            .drawConnectionToLayer(...args);
        };
      }
      return Reflect.get(t, k, r);
    },
  });
  return { host, counts };
}

function fiveConvergingStrokes(override?: Record<string, number>) {
  const finder = makeFinder();
  const { host, counts } = spyHost(finder);
  const brush = new RoundBrush(host as never, 1);
  brush.selectArtStyle("bloom");
  if (override) brush.activeConnection()!.applyFlat(override);
  const paths = [
    [[-90, -40], [80, 30]],
    [[-70, 50], [60, -60]],
    [[10, -90], [-20, 80]],
    [[-100, 10], [90, -10]],
    [[40, -70], [-50, 70]],
  ];
  for (const [[x0, y0], [x1, y1]] of paths) {
    brush.strokeStart(x0, y0);
    const steps = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 2));
    for (let i = 1; i <= steps; i++) {
      brush.stroke(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, true);
    }
    brush.strokeEnd();
  }
  return { lines: counts.web, points: finder.livePixelCount() };
}

describe("mandala first-run recipe (#88 white-out fix)", () => {
  it("the shipped Bloomer style keeps the fix invariants", () => {
    const brush = new RoundBrush(createBareHost(noopRenderer(), makeFinder()), 1);
    brush.selectArtStyle("bloom");
    const c = brush.activeConnection()!;
    const flat = c.toFlat();

    expect(flat.sampleSpacing as number).toBeGreaterThan(0);
    const stroke = c.strokeOpacity();
    expect(stroke).toBeDefined();
    expect(stroke as number).toBeGreaterThan(0);
    expect(stroke as number).toBeLessThan(0.35);
    expect(brush.getSelectOpacity()).toBe(stroke);
    expect(flat.bloom as number).toBeGreaterThan(0);
    expect(flat.density as number).toBeLessThan(100);
  });

  it("weaves far less ink than the old untamed recipe over the same strokes", () => {
    const untamed = { density: 100, bloom: 32, sampleSpacing: 0, strokeAlpha: 0 };
    const shipped = fiveConvergingStrokes();
    const old = fiveConvergingStrokes(untamed);
    expect(shipped.lines).toBeLessThan(old.lines * 0.4);
    expect(shipped.points).toBeLessThan(old.points * 0.6);
    expect(shipped.lines).toBeGreaterThan(0);
    expect(shipped.points).toBeGreaterThan(0);
  });
});

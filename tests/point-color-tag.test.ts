import { describe, it, expect } from "vitest";
import { createBareHost } from "../src/paint-host";
import { RoundBrush } from "../src/brushes/round";
import { ColorPenBrush } from "../src/brushes/color-pen";
import type { IRenderer } from "../src/renderer";
import type { NeighborFinder, Pixel } from "../src/neighbor-finder";

// Every brush now tags the points it deposits with the colour being painted
// (Primary), so a connecting brush set to "From mark" inherits the real colours
// in a single pass. The Color Pen overrides the tag with its per-direction hue.

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
    findNeighbors: (px, r) =>
      pts.filter((p) => p.id !== px.id && Math.hypot(p.x - px.x, p.y - px.y) <= r),
    allPixels: () => [...pts],
    pixelCount: () => nextId,
    livePixelCount: () => pts.length,
    clear() {
      pts.length = 0;
    },
  };
}

function store(main: string) {
  const m: Record<string, unknown> = {
    "app.color.main": main,
    "app.color.secondary": "#888888",
  };
  return {
    get: (k: string) => m[k],
    set: (k: string, v: unknown) => {
      m[k] = v;
    },
  } as never;
}

describe("deposited points carry the painted colour", () => {
  it("a normal brush tags every deposited point with the active Primary", () => {
    const finder = makeFinder();
    const brush = new RoundBrush(createBareHost(noopRenderer(), finder), 1, store("#123456"));
    brush.strokeStart(10, 10);
    brush.stroke(10, 10, true);
    brush.stroke(20, 12, true);
    brush.strokeEnd();
    const pts = finder.allPixels();
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.every((p) => p.color === "#123456")).toBe(true);
  });

  it("the Color Pen overrides the tag with its own per-direction hue", () => {
    const finder = makeFinder();
    const pen = new ColorPenBrush(createBareHost(noopRenderer(), finder), 1, store("#123456"));
    pen.strokeStart(10, 10);
    pen.stroke(10, 10, true);
    pen.stroke(40, 10, true); // moving -> a sampled hue, not the Primary tag
    pen.strokeEnd();
    const pts = finder.allPixels();
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.every((p) => !!p.color)).toBe(true);
    expect(pts.some((p) => p.color !== "#123456")).toBe(true);
  });
});

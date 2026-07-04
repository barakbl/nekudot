import { describe, it, expect } from "vitest";
import { speedTaperFactor } from "../src/base";
import { ColorPenBrush } from "../src/brushes/color-pen";
import { RoundBrush } from "../src/brushes/round";
import { createBareHost } from "../src/paint-host";
import { createNeighborFinder } from "../src/neighbor-finder";
import { MOUSE_SAMPLE, type PenSample } from "../src/pen";
import type { IRenderer } from "../src/renderer";

describe("speedTaperFactor", () => {
  it("is full width at rest and below the slow threshold", () => {
    expect(speedTaperFactor(0)).toBe(1);
    expect(speedTaperFactor(0.2)).toBe(1);
  });

  it("floors at high speed and decreases monotonically", () => {
    const a = speedTaperFactor(0.5);
    const b = speedTaperFactor(2);
    const c = speedTaperFactor(4);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(a).toBeLessThanOrEqual(1);
    expect(speedTaperFactor(100)).toBeCloseTo(0.35); // the floor
  });
});

// Drive a brush over a spy renderer, capturing the width of each drawn line
// segment (drawLine's style.width). The bare host reports strokeWidth() === 1,
// so a set width < 1 means the line thinned. Speed taper lives on the Color Pen
// (its line is the whole mark), so that's the default-on host.
const PEN: PenSample = { isPen: true, pressure: 1, tilt: 0, azimuth: 0, hasTilt: false };
// ~0.01 px/ms (below the taper threshold) vs ~5 px/ms (well past it).
const SLOW = { t: [0, 400, 800, 1200], x: [0, 4, 8, 12] };
const FAST = { t: [0, 12, 24, 36], x: [0, 60, 120, 180] };

function widthsFor(
  make: (host: ReturnType<typeof createBareHost>) => RoundBrush | ColorPenBrush,
  step: { t: number[]; x: number[] },
  pen = MOUSE_SAMPLE,
) {
  const finder = createNeighborFinder("quadtree", []);
  const widths: (number | undefined)[] = [];
  const renderer = new Proxy(
    {
      drawLine: (_a: unknown, _b: unknown, style?: { width?: number }) =>
        widths.push(style?.width),
    },
    { get: (t, p) => (p in t ? (t as Record<string, unknown>)[p] : () => {}) },
  ) as unknown as IRenderer;
  const brush = make(createBareHost(renderer, finder));
  brush.strokeStart(0, 0);
  for (let i = 0; i < step.x.length; i++) brush.stroke(step.x[i], 0, true, pen, step.t[i]);
  brush.strokeEnd();
  return widths;
}

const colorPen = (host: ReturnType<typeof createBareHost>) => new ColorPenBrush(host, 1);
const web = (host: ReturnType<typeof createBareHost>) => new RoundBrush(host, 1);

describe("Color Pen speed taper (grace for mouse/touch)", () => {
  it("a slow mouse drag keeps full width", () => {
    const w = widthsFor(colorPen, SLOW);
    expect(w.every((v) => v === undefined)).toBe(true); // width unset = base width
  });

  it("a fast mouse flick tapers thinner than the base width", () => {
    const w = widthsFor(colorPen, FAST);
    const set = w.filter((v): v is number => v !== undefined);
    expect(set.length).toBeGreaterThan(0);
    expect(Math.min(...set)).toBeLessThan(1);
  });

  it("does not taper for a pen (pressure owns width there)", () => {
    const w = widthsFor(colorPen, FAST, PEN);
    expect(w.every((v) => v === undefined)).toBe(true);
  });
});

describe("Web brush speed taper is off by default", () => {
  it("a fast Web flick does NOT taper (its line hides behind the web)", () => {
    const w = widthsFor(web, FAST);
    expect(w.every((v) => v === undefined)).toBe(true);
  });
});

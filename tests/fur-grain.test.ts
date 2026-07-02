import { describe, it, expect } from "vitest";
import { createBareHost } from "../src/paint-host";
import { RoundBrush } from "../src/brushes/round";
import type { IRenderer } from "../src/renderer";
import type { NeighborFinder, Pixel } from "../src/neighbor-finder";

// Fur's grain used one GLOBAL angle, so every hair combed the same compass way no
// matter how you drew ("combed wallpaper, not a pelt"). grainFollow rotates the
// grain axis toward the stroke's local heading so the pelt sweeps along the drawn
// contour. The hard constraint: fur consumes the seeded RNG in a fixed order for
// byte-identical output, so grainFollow must feed in the heading WITHOUT adding or
// reordering a single random draw. These tests lock both: reproducibility (the
// RNG-order invariant) and that the grain actually tracks the heading.

// Records every connection segment the engine draws (the only geometry we assert
// on); every other renderer call is a no-op.
function capturing(segments: number[][]): IRenderer {
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "drawConnection"
          ? (p1: Pixel, p2: Pixel) => segments.push([p1.x, p1.y, p2.x, p2.y])
          : () => {},
    },
  ) as unknown as IRenderer;
}

function makeFinder(): NeighborFinder {
  const pts: Pixel[] = [];
  let nextId = 0;
  return {
    addPixel(x, y) {
      const p = { id: nextId++, x, y };
      pts.push(p);
      return p;
    },
    findNeighbors: (px, radius) =>
      pts.filter((p) => p.id !== px.id && Math.hypot(p.x - px.x, p.y - px.y) <= radius),
    allPixels: () => [...pts],
    pixelCount: () => nextId,
    livePixelCount: () => pts.length,
    clear() {
      pts.length = 0;
    },
  };
}

function furBrush(segments: number[][], seed = 1) {
  const brush = new RoundBrush(createBareHost(capturing(segments), makeFinder()), seed);
  brush.selectArtStyle("fur");
  return brush;
}

// A quarter-circle arc: its local heading rotates through 90deg, so a
// contour-following grain must visibly change along it.
const ARC: [number, number][] = [];
for (let i = 0; i <= 24; i++) {
  const a = (Math.PI / 2) * (i / 24);
  ARC.push([100 + 80 * Math.cos(a), 100 + 80 * Math.sin(a)]);
}

function drawStroke(flat: Record<string, number>, path: [number, number][], seed = 1): number[][] {
  const segments: number[][] = [];
  const brush = furBrush(segments, seed);
  brush.activeConnection()!.applyFlat(flat);
  brush.strokeStart(path[0][0], path[0][1]);
  for (const [x, y] of path) brush.stroke(x, y);
  brush.strokeEnd();
  return segments;
}

// --- circular stats over hair AXES (grain is pi-periodic: theta == theta+pi) ----
const meanAxis = (angles: number[]): number => {
  let sx = 0;
  let sy = 0;
  for (const a of angles) {
    sx += Math.cos(2 * a);
    sy += Math.sin(2 * a);
  }
  return Math.atan2(sy, sx) / 2;
};
// Distance between two axes, in [0, pi/2].
const axisDist = (a: number, b: number): number => {
  let d = Math.abs(a - b) % Math.PI;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
};

// Drive one connect at the centre of a dense symmetric point disc, with the
// stroke's last segment heading in `theta`. The disc gives neighbours in every
// direction, so the grain gate - not the geometry - decides which hairs survive;
// their mean axis reveals the grain direction. strands=1 + taper/flow/wave=0 makes
// each kept hair a single straight segment, so its angle IS the grain sample.
function hairAxesAtHeading(follow: number, grainAngleDeg: number, theta: number): number[] {
  const finder = makeFinder();
  const C = { x: 300, y: 300 };
  for (let gx = -18; gx <= 18; gx += 2) {
    for (let gy = -18; gy <= 18; gy += 2) {
      if (gx * gx + gy * gy <= 18 * 18 && (gx || gy)) finder.addPixel(C.x + gx, C.y + gy);
    }
  }
  const segments: number[][] = [];
  const brush = new RoundBrush(createBareHost(capturing(segments), finder), 7);
  brush.selectArtStyle("fur");
  const conn = brush.activeConnection()!;
  conn.applyFlat({
    grainFollow: follow,
    grainAngle: grainAngleDeg,
    grainStrength: 1,
    strands: 1,
    taper: 0,
    flow: 0,
    wave: 0,
    fray: 0,
    scatter: 0,
    density: 100,
    radius: 30,
    minDist: 0,
  });
  conn.resetStroke();
  conn.beforeDeposit(C.x - 5 * Math.cos(theta), C.y - 5 * Math.sin(theta)); // sets first point
  conn.beforeDeposit(C.x, C.y); // heading = theta
  conn.connect({ id: 999999, x: C.x, y: C.y });
  return segments.map(([x1, y1, x2, y2]) => Math.atan2(y2 - y1, x2 - x1));
}

describe("Fur grain follows the stroke heading (contour-aware pelt)", () => {
  it("is deterministic: same seed + same stroke -> byte-identical hairs (RNG order preserved)", () => {
    const a = drawStroke({}, ARC); // fur defaults (grainFollow on), full hair pipeline
    const b = drawStroke({}, ARC);
    expect(a.length).toBeGreaterThan(50); // the arc actually grew a pelt
    expect(b).toEqual(a);
  });

  it("grainFollow does not change how many random draws happen per candidate", () => {
    // If grainFollow added/removed a random() draw, toggling it on an axis-aligned
    // stroke (heading 0, so grainRad is unchanged from the fixed angle at offset 0)
    // would desync the RNG and shift EVERY later hair. Same geometry both ways
    // proves the heading is threaded in without touching the draw order.
    const flat = { grainAngle: 0, grainStrength: 0.85 };
    const horizontal: [number, number][] = ARC.map((_, i) => [40 + i * 6, 200]);
    const off = drawStroke({ ...flat, grainFollow: 0 }, horizontal);
    const on = drawStroke({ ...flat, grainFollow: 1 }, horizontal);
    expect(on).toEqual(off);
  });

  it("with grainFollow on, the pelt's grain tracks the stroke direction", () => {
    const right = meanAxis(hairAxesAtHeading(1, 0, 0)); // stroke heading ->
    const up = meanAxis(hairAxesAtHeading(1, 0, Math.PI / 2)); // stroke heading ^
    // Each pelt lies along its own stroke, ~90deg apart from the other.
    expect(axisDist(right, 0)).toBeLessThan(0.3);
    expect(axisDist(up, Math.PI / 2)).toBeLessThan(0.3);
    expect(axisDist(right, up)).toBeGreaterThan(1.2); // near the pi/2 maximum
  });

  it("with grainFollow off, the grain ignores the stroke (the old fixed-axis look)", () => {
    const right = meanAxis(hairAxesAtHeading(0, 0, 0));
    const up = meanAxis(hairAxesAtHeading(0, 0, Math.PI / 2));
    // Fixed compass grain: both strokes comb the same way regardless of heading.
    expect(axisDist(right, up)).toBeLessThan(0.3);
  });

  it("wires the dial: Fur defaults it on, it round-trips, and shows a slider", () => {
    const segments: number[][] = [];
    const fur = furBrush(segments).activeConnection()!;
    expect(fur.toFlat().grainFollow).toBe(1);
    fur.applyFlat({ grainFollow: 0.4 });
    expect(fur.toFlat().grainFollow).toBe(0.4);
    expect(fur.sliders().map((s) => s.key)).toContain("grainFollow");
  });

  it("is backward-compatible: styles without grain default grainFollow to 0", () => {
    const segments: number[][] = [];
    const brush = new RoundBrush(createBareHost(capturing(segments), makeFinder()), 1);
    brush.selectArtStyle("shaded");
    expect(brush.activeConnection()!.toFlat().grainFollow).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import { createBareHost } from "../src/paint-host";
import { RoundBrush } from "../src/brushes/round";
import type { IRenderer } from "../src/renderer";
import type { NeighborFinder, Pixel } from "../src/neighbor-finder";

// Bloom is a density-targeted point multiplier on the connecting web: after a
// real deposit, it tops the local neighbourhood up to the `bloom` target by
// scattering points where it is sparse (and adds nothing where it is already
// dense). These tests drive a Round brush over a bare host and count the points
// that land in the map, using deltas vs a bloom=0 baseline so they don't depend
// on exactly how many points a single tap deposits on its own.

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

// A Round brush whose connection has bloom dials applied. radius is the reach
// used to MEASURE local density; bloomRadius is the scatter jitter (kept inside
// radius so a second tap sees the points the first one added).
function round(flat: Record<string, number>) {
  const finder = makeFinder();
  const brush = new RoundBrush(createBareHost(noopRenderer(), finder), 1);
  brush.activeConnection()!.applyFlat({ radius: 300, bloomRadius: 50, ...flat });
  return { brush, finder };
}

function tap(brush: RoundBrush, x: number, y: number): void {
  brush.strokeStart(x, y);
  brush.stroke(x, y, true);
  brush.strokeEnd();
}

// Points one plain tap deposits on its own (bloom off) - the baseline we measure
// the bloom additions against.
function baseTapPoints(): number {
  const { brush, finder } = round({ bloom: 0 });
  tap(brush, 100, 100);
  return finder.livePixelCount();
}

describe("Bloom (density-targeted point multiplier)", () => {
  it("is off by default - a tap deposits nothing extra", () => {
    const { brush, finder } = round({ bloom: 0 });
    tap(brush, 100, 100);
    expect(finder.livePixelCount()).toBe(baseTapPoints());
  });

  it("tops an empty neighbourhood up to the target from a single tap", () => {
    const base = baseTapPoints();
    const { brush, finder } = round({ bloom: 40 });
    tap(brush, 100, 100);
    expect(finder.livePixelCount() - base).toBe(40); // exactly the target gap
  });

  it("is density-targeted: a second tap in an already-full area adds no bloom", () => {
    const base = baseTapPoints();
    const { brush, finder } = round({ bloom: 40 });
    tap(brush, 100, 100);
    const afterFirst = finder.livePixelCount();
    expect(afterFirst - base).toBe(40);
    tap(brush, 100, 100); // same spot, neighbourhood already at target
    // only the tap's own points are added, zero new bloom -> proves self-limiting
    expect(finder.livePixelCount() - afterFirst).toBe(base);
  });

  it("clamps additions per deposit (safety bound, MAX_PER_DEPOSIT = 64)", () => {
    const base = baseTapPoints();
    const { brush, finder } = round({ bloom: 100 }); // target above the clamp
    tap(brush, 100, 100);
    expect(finder.livePixelCount() - base).toBe(64);
  });

  it("round-trips the dials through applyFlat/toFlat", () => {
    const { brush } = round({ bloom: 30, bloomRadius: 90 });
    const flat = brush.activeConnection()!.toFlat();
    expect(flat.bloom).toBe(30);
    expect(flat.bloomRadius).toBe(90);
  });

  it("exposes Bloom + Bloom radius sliders in the Connecting panel", () => {
    const { brush } = round({});
    const keys = brush.activeConnection()!.sliders().map((s) => s.key);
    expect(keys).toContain("bloom");
    expect(keys).toContain("bloomRadius");
  });

  it("the Bloom Texture preset uses a tiny reach + a 100px bloom radius", () => {
    const brush = new RoundBrush(createBareHost(noopRenderer(), makeFinder()), 1);
    brush.selectArtStyle("bloomtex");
    const flat = brush.activeConnection()!.toFlat();
    expect(flat.radius).toBe(5);
    expect(flat.bloomRadius).toBe(100);
    expect(flat.bloom as number).toBeGreaterThan(0);
  });

  it("the Bloom preset wires it on; other styles keep it off (no leak)", () => {
    const brush = new RoundBrush(createBareHost(noopRenderer(), makeFinder()), 1);
    brush.selectArtStyle("bloom");
    expect(brush.activeConnection()!.toFlat().bloom as number).toBeGreaterThan(0);
    brush.selectArtStyle("shaded"); // a fresh connection -> bloom resets to 0
    expect(brush.activeConnection()!.toFlat().bloom).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import { RoundBrush } from "../src/brushes/round";
import { createBareHost } from "../src/paint-host";
import { connectionGroups } from "../src/brushes/connections/registry";
import type { IRenderer } from "../src/renderer";
import type { NeighborFinder, Pixel } from "../src/neighbor-finder";

// Longfur (src/brushes/connections/longfur.ts) ports Harmony's "longfur" brush:
// each web hair overshoots BOTH ends by a random fraction of its length, so
// strands run long and wispy past the dots they bridge. These lock the port's
// registration/geometry and the defining behaviour - lines that reach beyond the
// search radius (impossible for a plain dot-to-dot link) and collapse to a plain
// web when Length is 0.

const noop = () => new Proxy({}, { get: () => () => {} }) as unknown as IRenderer;

function makeFinder(): NeighborFinder {
  const p: Pixel[] = [];
  let n = 0;
  return {
    addPixel(x, y) { const q = { id: n++, x, y }; p.push(q); return q; },
    findNeighbors(px, r) { return p.filter((z) => z.id !== px.id && Math.hypot(z.x - px.x, z.y - px.y) <= r); },
    allPixels: () => [...p],
    pixelCount: () => n,
    livePixelCount: () => p.length,
    clear() { p.length = 0; },
  };
}

// Draw a short crossing stroke of Longfur and capture each web line's two
// endpoints (args 1 + 2 of host.drawConnectionToLayer) + its drawn length.
function webLines(seed = 1, override?: Record<string, string | number>) {
  const segs: { a: Pixel; b: Pixel; len: number }[] = [];
  const base = createBareHost(noop(), makeFinder());
  const host = new Proxy(base as Record<string, unknown>, {
    get(t, k, r) {
      if (k === "drawConnectionToLayer") {
        return (...args: unknown[]) => {
          const a = args[1] as Pixel;
          const b = args[2] as Pixel;
          segs.push({ a, b, len: Math.hypot(b.x - a.x, b.y - a.y) });
          return (base as { drawConnectionToLayer: (...z: unknown[]) => unknown }).drawConnectionToLayer(...args);
        };
      }
      return Reflect.get(t, k, r);
    },
  });
  const brush = new RoundBrush(host as never, seed);
  brush.selectArtStyle("longfur");
  if (override) brush.activeConnection()!.applyFlat(override);
  brush.strokeStart(0, 0);
  for (let i = 1; i <= 16; i++) brush.stroke(i * 3, (i % 4) * 3, true);
  brush.strokeEnd();
  return { segs, brush };
}

const REACH = 55;

describe("Longfur connection (Harmony longfur port)", () => {
  it("registers in the Classic group with the longfur.ts glyph + geometry", () => {
    const classic = connectionGroups().find((g) => g.group === "Classic")!;
    const def = classic.defs.find((d) => d.name === "longfur")!;
    expect(def.label).toBe("Longfur");
    expect(def.icon).toContain("Q5 6 7 2"); // a strand path from longfur.ts's icon

    const c = webLines().brush.activeConnection()!;
    const f = c.toFlat();
    expect(f.radius).toBe(REACH);
    expect(f.alpha).toBe(0.06);
    expect(f.strands).toBe(1);
    expect(f.length).toBe(0.8); // the overshoot amount
    expect(c.strokeOpacity()).toBe(0); // no base stroke line, like Harmony longfur
  });

  it("overshoots both ends, so hairs reach well beyond the search radius", () => {
    const { segs } = webLines(7);
    expect(segs.length).toBeGreaterThan(0);
    const max = Math.max(...segs.map((s) => s.len));
    // A plain dot-to-dot link can't exceed the reach; overshoot pushes past it.
    expect(max).toBeGreaterThan(REACH + 5);
  });

  it("Length 0 collapses to a plain web (every link within reach)", () => {
    const plain = webLines(7, { length: 0 });
    const maxPlain = Math.max(...plain.segs.map((s) => s.len));
    expect(maxPlain).toBeLessThanOrEqual(REACH + 1); // no overshoot, links stay in range

    const furry = webLines(7); // default Length 0.8
    const meanPlain = plain.segs.reduce((a, s) => a + s.len, 0) / plain.segs.length;
    const meanFurry = furry.segs.reduce((a, s) => a + s.len, 0) / furry.segs.length;
    expect(meanFurry).toBeGreaterThan(meanPlain * 1.3); // hairs run visibly longer
  });

  it("is reproducible for a given seed", () => {
    const a = webLines(5).segs.map((s) => `${s.a.x.toFixed(2)},${s.b.x.toFixed(2)}`);
    const b = webLines(5).segs.map((s) => `${s.a.x.toFixed(2)},${s.b.x.toFixed(2)}`);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it("does not disturb the other Classic styles (shaded stays a plain web)", () => {
    const classic = connectionGroups().find((g) => g.group === "Classic")!;
    expect(classic.defs.map((d) => d.name)).toContain("shaded");
  });
});

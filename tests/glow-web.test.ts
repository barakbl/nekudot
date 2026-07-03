import { describe, it, expect } from "vitest";
import { createBareHost } from "../src/paint-host";
import { RoundBrush } from "../src/brushes/round";
import { BLEND_MODES } from "../src/brushes/connections/base";
import type { IRenderer } from "../src/renderer";
import type { NeighborFinder, Pixel } from "../src/neighbor-finder";

// Glow is a clean additive-glow web: low-alpha, single-hued strands drawn with the
// "screen" blend so overlap builds light (vs Chroma's hard metallic random-recolor).
// These lock: the blend actually reaches the renderer per line, Glow's defaults,
// the shared Blend dial (incl. the new "Add"/lighter), and that Glow does NOT
// shimmer the way Chroma does.

function capturing(calls: { composite?: string; color?: string }[]): IRenderer {
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "drawConnection"
          ? (_p1: Pixel, _p2: Pixel, style?: { composite?: string; color?: string }) =>
              calls.push({ composite: style?.composite, color: style?.color })
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

// A short dense stroke so points fall within reach and the web actually draws.
const STROKE: [number, number][] = Array.from({ length: 16 }, (_, i) => [100 + i * 6, 100 + (i % 3) * 5]);

function draw(style: string, flat?: Record<string, string | number>) {
  const calls: { composite?: string; color?: string }[] = [];
  const brush = new RoundBrush(createBareHost(capturing(calls), makeFinder()), 1);
  brush.selectArtStyle(style);
  const conn = brush.activeConnection()!;
  if (flat) conn.applyFlat(flat);
  brush.strokeStart(STROKE[0][0], STROKE[0][1]);
  for (const [x, y] of STROKE) brush.stroke(x, y);
  brush.strokeEnd();
  return { calls, conn };
}

describe("Glow web (additive) + shared Blend dial", () => {
  it("registers Glow with the screen blend and glow-tuned defaults", () => {
    const { conn } = draw("glow");
    const flat = conn.toFlat();
    expect(flat.blend).toBe("screen");
    expect(flat.radius).toBe(80); // moderate reach - a soft halo without white spokes
    expect(flat.alpha).toBe(0.06); // faint lines
    expect(flat.inset).toBe(0);
    expect(flat.fade).toBe(0.4);
  });

  it("draws every web line with the screen composite (reaches the renderer)", () => {
    const { calls } = draw("glow");
    expect(calls.length).toBeGreaterThan(5);
    expect(calls.every((c) => c.composite === "screen")).toBe(true);
  });

  it("is a clean single-hued web - no per-line shimmer (unlike Chroma)", () => {
    const glow = draw("glow").calls.map((c) => c.color);
    const chroma = draw("chroma").calls.map((c) => c.color);
    expect(new Set(glow).size).toBe(1); // one colour for the whole web
    expect(new Set(chroma).size).toBeGreaterThan(1); // Chroma randomises each line
  });

  it("exposes the shared Blend dial, including the new 'Add' (lighter) mode", () => {
    const blend = draw("glow").conn.sliders().find((s) => s.key === "blend");
    expect(blend).toBeTruthy();
    expect(blend?.kind).toBe("select");
    const opts = (blend as { options: string[] }).options;
    const labels = (blend as { optionLabels: Record<string, string> }).optionLabels;
    expect(opts).toContain("lighter");
    expect(labels.lighter).toBe("Add");
    expect(BLEND_MODES).toContain("lighter");
  });

  it("accepts 'lighter' as a blend and passes it through to the renderer", () => {
    const { conn, calls } = draw("glow", { blend: "lighter" });
    expect(conn.toFlat().blend).toBe("lighter");
    expect(calls.every((c) => c.composite === "lighter")).toBe(true);
  });

  it("rejects an unknown blend value (keeps the current one)", () => {
    const { conn } = draw("glow", { blend: "not-a-blend" });
    expect(conn.toFlat().blend).toBe("screen"); // unchanged
  });

  it("leaves Chroma on its lighten default (regression)", () => {
    expect(draw("chroma").conn.toFlat().blend).toBe("lighten");
  });
});

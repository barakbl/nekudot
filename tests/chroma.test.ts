import { describe, it, expect } from "vitest";
import { RoundBrush } from "../src/brushes/round";
import { createBareHost } from "../src/paint-host";
import { connectionGroups } from "../src/brushes/connections/registry";
import type { IRenderer, LineStyle } from "../src/renderer";
import type { NeighborFinder, Pixel } from "../src/neighbor-finder";

// Chroma (src/brushes/connections/chroma.ts) ports Harmony's "chrome" brush:
// short inset web lines recoloured a seeded-random darkened shade of the ink,
// composited with a Blend mode for a metallic sheen. These lock the port's
// geometry, the reproducible shimmer, and the persisted Blend dial - including
// that it does not regress other styles (which stay source-over).

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

// Draw a short crossing stroke of `style` and capture the LineStyle of each web
// line (they route through host.drawConnectionToLayer, not the IRenderer).
function webLines(style: string, seed = 1, override?: Record<string, string | number>) {
  const styles: LineStyle[] = [];
  const base = createBareHost(noop(), makeFinder());
  const host = new Proxy(base as Record<string, unknown>, {
    get(t, k, r) {
      if (k === "drawConnectionToLayer") {
        return (...a: unknown[]) => {
          styles.push(a[3] as LineStyle);
          return (base as { drawConnectionToLayer: (...a: unknown[]) => unknown }).drawConnectionToLayer(...a);
        };
      }
      return Reflect.get(t, k, r);
    },
  });
  const brush = new RoundBrush(host as never, seed);
  brush.selectArtStyle(style);
  if (override) brush.activeConnection()!.applyFlat(override);
  brush.strokeStart(0, 0);
  for (let i = 1; i <= 12; i++) brush.stroke(i * 2, (i % 3) * 2, true);
  brush.strokeEnd();
  return { styles, brush };
}

describe("Chroma connection (Harmony chrome port)", () => {
  it("registers in the Classic group with the chroma.ts glyph + chrome geometry", () => {
    const classic = connectionGroups().find((g) => g.group === "Classic")!;
    const def = classic.defs.find((d) => d.name === "chroma")!;
    expect(def.label).toBe("Chrome");
    expect(def.icon).toContain("M3 6 L10 10"); // the icon exported by chroma.ts

    const c = webLines("chroma").brush.activeConnection()!;
    const f = c.toFlat();
    expect(f.radius).toBe(32);
    expect(f.inset).toBe(0.2);
    expect(f.alpha).toBe(0.1);
    expect(f.fade).toBe(0);
    expect(c.strokeOpacity()).toBe(0.1);
  });

  it("recolours each web line a varied, deterministic random darkened tone", () => {
    const a = webLines("chroma", 5).styles.map((s) => s.color);
    const b = webLines("chroma", 5).styles.map((s) => s.color);
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c!))).toBe(true);
    expect(new Set(a).size).toBeGreaterThan(1); // varied tones, not one flat colour
    expect(a).toEqual(b); // reproducible for a given seed
  });

  describe("Blend dial", () => {
    it("defaults to lighten, persists in the flat, and exposes a Blend select", () => {
      const { styles, brush } = webLines("chroma");
      const c = brush.activeConnection()!;
      expect(c.toFlat().blend).toBe("lighten");
      expect(styles.every((s) => s.composite === "lighten")).toBe(true);
      const hasSelect = c
        .sliders()
        .some((s) => (s as { key?: string }).key === "blend" && (s as { kind?: string }).kind === "select");
      expect(hasSelect).toBe(true);
    });

    it("Normal (source-over) drops the composite; Darken persists + applies", () => {
      const normal = webLines("chroma", 1, { blend: "source-over" });
      expect(normal.brush.activeConnection()!.toFlat().blend).toBe("source-over");
      expect(normal.styles.every((s) => s.composite === undefined)).toBe(true);

      const dark = webLines("chroma", 1, { blend: "darken" });
      expect(dark.brush.activeConnection()!.toFlat().blend).toBe("darken");
      expect(dark.styles.every((s) => s.composite === "darken")).toBe(true);
    });

    it("ignores an unknown blend value (untrusted-preset guard)", () => {
      const c = webLines("chroma", 1, { blend: "not-a-mode" }).brush.activeConnection()!;
      expect(c.toFlat().blend).toBe("lighten"); // rejected, left at the default
    });
  });

  it("does not regress other styles: shaded stays source-over with no composite", () => {
    const { styles, brush } = webLines("shaded");
    expect(brush.activeConnection()!.toFlat().blend).toBe("source-over");
    expect(styles.length).toBeGreaterThan(0);
    expect(styles.every((s) => s.composite === undefined)).toBe(true);
  });
});

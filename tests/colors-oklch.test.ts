import { describe, it, expect } from "vitest";
import { hexToOklch, oklchToHex } from "../src/colors/oklch";

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

describe("hexToOklch", () => {
  it("maps white and black to L=1 / L=0 with ~no chroma", () => {
    const w = hexToOklch("#ffffff");
    expect(w.l).toBeCloseTo(1, 2);
    expect(w.c).toBeLessThan(0.002);
    const k = hexToOklch("#000000");
    expect(k.l).toBeCloseTo(0, 2);
    expect(k.c).toBeLessThan(0.002);
  });
  it("matches the known L + hue of sRGB red (~0.628, ~29.2°)", () => {
    const r = hexToOklch("#ff0000");
    expect(r.l).toBeCloseTo(0.628, 2);
    expect(r.h).toBeGreaterThan(28);
    expect(r.h).toBeLessThan(31);
  });
});

describe("oklchToHex round-trips in-gamut colours (within 1/255)", () => {
  for (const hex of [
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#1a1a1a",
    "#9aa0a6",
    "#f3722c",
    "#277da1",
  ]) {
    it(hex, () => {
      const [r1, g1, b1] = rgb(hex);
      const [r2, g2, b2] = rgb(oklchToHex(hexToOklch(hex)));
      expect(Math.abs(r1 - r2)).toBeLessThanOrEqual(1);
      expect(Math.abs(g1 - g2)).toBeLessThanOrEqual(1);
      expect(Math.abs(b1 - b2)).toBeLessThanOrEqual(1);
    });
  }
});

describe("oklchToHex gamut mapping", () => {
  it("clamps an out-of-gamut chroma to a valid #rrggbb", () => {
    expect(oklchToHex({ l: 0.7, c: 0.5, h: 30 })).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("keeps the hue sensible after mapping (red-ish stays red-ish)", () => {
    const [r, g, b] = rgb(oklchToHex({ l: 0.628, c: 0.4, h: 29.2 }));
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });
});

import { describe, it, expect } from "vitest";
import { mixOklch } from "../src/colors/oklch";
import { mixHex } from "../src/brushes/color-source";

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const chroma = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b); // 0 == grey
};

describe("mixOklch (perceptual gradient blend)", () => {
  it("returns the endpoints exactly", () => {
    expect(mixOklch("#123456", "#abcdef", 0)).toBe("#123456");
    expect(mixOklch("#123456", "#abcdef", 1)).toBe("#abcdef");
  });

  it("a complementary blend stays saturated instead of going grey", () => {
    // Blue -> Yellow: the sRGB midpoint is exactly grey (#808080); OKLCH keeps
    // chroma up by rotating hue, so the midpoint is clearly coloured.
    const srgbMid = mixHex("#0000ff", "#ffff00", 0.5);
    expect(chroma(srgbMid)).toBeLessThanOrEqual(2); // ~grey
    const oklchMid = mixOklch("#0000ff", "#ffff00", 0.5);
    expect(chroma(oklchMid)).toBeGreaterThan(60); // distinctly coloured
  });

  it("a grey endpoint is powerless (black -> blue darkens without odd hues)", () => {
    const mid = mixOklch("#000000", "#0000ff", 0.5);
    const [r, g, b] = rgb(mid);
    expect(b).toBeGreaterThan(r); // still blue-dominant
    expect(b).toBeGreaterThan(g);
    expect(mid).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("lightness moves monotonically from black to white", () => {
    const ls = [0.2, 0.4, 0.6, 0.8].map((t) => {
      const [r, g, b] = rgb(mixOklch("#000000", "#ffffff", t));
      return r + g + b; // greys, so sum tracks lightness
    });
    for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeGreaterThan(ls[i - 1]);
  });
});

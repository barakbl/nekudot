import { describe, it, expect } from "vitest";
import {
  mixHex,
  blend,
  paletteHex,
  gradientStops,
  gradientCss,
} from "../src/colors/gradient";

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const chroma = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b); // 0 == grey
};

describe("shared gradient primitives", () => {
  it("mixHex blends gamma-sRGB and clamps t", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#000000", "#ffffff", 2)).toBe("#ffffff"); // clamped
  });

  it("blend: OKLCH keeps a blue<->yellow midpoint coloured; sRGB greys it", () => {
    expect(chroma(blend("#0000ff", "#ffff00", 0.5, "oklch"))).toBeGreaterThan(40);
    expect(chroma(blend("#0000ff", "#ffff00", 0.5, "srgb"))).toBeLessThan(10);
  });

  it("paletteHex: linear clamps to first/last, cyclic wraps", () => {
    const stops = ["#ff0000", "#00ff00", "#0000ff"];
    expect(paletteHex(stops, 0, "srgb", false)).toBe("#ff0000");
    expect(paletteHex(stops, 1, "srgb", false)).toBe("#0000ff");
    // cyclic: t=0 is the first stop; just before the wrap it heads back toward it
    expect(paletteHex(stops, 0, "srgb", true)).toBe("#ff0000");
    expect(paletteHex(stops, 0.999, "srgb", true)).not.toBe("#0000ff");
  });

  it("gradientStops: linear sampling hits exact endpoints", () => {
    const s = gradientStops(["#ff0000", "#0000ff"], "srgb", 5);
    expect(s).toHaveLength(5);
    expect(s[0]).toBe("#ff0000");
    expect(s[s.length - 1]).toBe("#0000ff");
  });

  it("gradientCss: solid for one colour, transparent for none, stops otherwise", () => {
    expect(gradientCss(["#123456"], "oklch")).toBe("#123456");
    expect(gradientCss([], "oklch")).toBe("transparent");
    const css = gradientCss(["#000000", "#ffffff"], "srgb", 4);
    expect(css.startsWith("linear-gradient(to right, ")).toBe(true);
    expect(css.match(/#/g)).toHaveLength(4); // 4 sampled stops
  });
});

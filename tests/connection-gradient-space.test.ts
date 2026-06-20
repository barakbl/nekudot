import { describe, it, expect } from "vitest";
import {
  connectionLineColor,
  setGradientPalettes,
  setGradientSpace,
} from "../src/brushes/color-source";

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const chroma = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return Math.max(r, g, b) - Math.min(r, g, b); // 0 == grey
};

// The app-level "Smooth gradients" flag flips the connection gradient blend space.
describe("gradient blend space (setGradientSpace)", () => {
  it("OKLCH keeps a blue<->yellow midpoint coloured; sRGB makes it grey", () => {
    setGradientPalettes([{ id: "by", label: "BY", colors: ["#0000ff", "#ffff00"] }]);
    // For a 2-stop cyclic palette, t=0.25 lands on the midpoint of stop0->stop1.
    setGradientSpace("oklch");
    const ok = connectionLineColor("by", 0.25, "#000000", "#ffffff")!;
    setGradientSpace("srgb");
    const sr = connectionLineColor("by", 0.25, "#000000", "#ffffff")!;
    expect(chroma(ok)).toBeGreaterThan(40); // perceptual blend stays coloured
    expect(chroma(sr)).toBeLessThan(10); // classic sRGB blue+yellow -> grey
    setGradientSpace("oklch"); // restore the default
  });
});

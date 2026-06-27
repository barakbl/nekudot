import { describe, it, expect } from "vitest";

import {
  neutralCanvasDefaults,
  NEUTRAL_CANVAS_BG,
  NEUTRAL_CANVAS_INK,
} from "../src/onboarding/canvas-defaults";

// WCAG relative luminance + contrast ratio, so the guard is a real perceptual
// bound rather than a hardcoded-string check.
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("neutral canvas defaults (G1: kill the hostile blank)", () => {
  it("never returns the hostile white-bg + black-brush pair", () => {
    const { background, ink } = neutralCanvasDefaults();
    expect(background.toLowerCase()).not.toBe("#ffffff");
    expect(ink.toLowerCase()).not.toBe("#000000");
  });

  it("is a dark canvas with light ink", () => {
    expect(luminance(NEUTRAL_CANVAS_BG)).toBeLessThan(0.05); // dark surface
    expect(luminance(NEUTRAL_CANVAS_INK)).toBeGreaterThan(0.6); // light stroke
  });

  it("clears WCAG AAA contrast between background and ink", () => {
    // The first stroke (and its faint connecting web) must read clearly; AAA for
    // normal text is 7:1, a comfortable floor for a stroke on the canvas.
    expect(contrastRatio(NEUTRAL_CANVAS_BG, NEUTRAL_CANVAS_INK)).toBeGreaterThanOrEqual(7);
  });

  it("stays distinct from the mandala canvas so Blank is not mistaken for it", () => {
    expect(NEUTRAL_CANVAS_BG.toLowerCase()).not.toBe("#0d0e12");
  });
});

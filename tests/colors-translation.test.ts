import { describe, it, expect } from "vitest";
import { hexToOklch, oklchToHex } from "../src/colors/oklch";
import { hexToHsv, hsvToHex } from "../src/colors/hsv";

// The OKLCH and HSB picker tabs share one "working" hex colour: switching tabs
// re-seeds the newly shown editor from that hex (see setPickerMode in panel.ts).
// So a tab switch is exactly a hex -> space -> hex round-trip. These tests sweep
// a dense colour grid and verify switching preserves the colour (and is stable
// when you keep switching back and forth) across the whole sRGB gamut.

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function diff(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.max(Math.abs(r1 - r2), Math.abs(g1 - g2), Math.abs(b1 - b2));
}
const oklchRound = (hex: string) => oklchToHex(hexToOklch(hex));
const hsvRound = (hex: string) => {
  const o = hexToHsv(hex);
  return hsvToHex(o.h, o.s, o.v);
};

// A dense grid (17 steps/channel incl. 255) -> 4913 colours, plus the corners.
const STEPS: number[] = [];
for (let i = 0; i < 256; i += 16) STEPS.push(i);
if (STEPS[STEPS.length - 1] !== 255) STEPS.push(255);
const COLORS: string[] = [];
for (const r of STEPS)
  for (const g of STEPS)
    for (const b of STEPS)
      COLORS.push(`#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`);

function maxOver(fn: (hex: string) => number): number {
  let m = 0;
  for (const c of COLORS) m = Math.max(m, fn(c));
  return m;
}

describe("OKLCH <-> HSB picker translation (whole sRGB grid)", () => {
  it("OKLCH seed round-trips every colour within 1/255", () => {
    expect(maxOver((c) => diff(c, oklchRound(c)))).toBeLessThanOrEqual(1);
  });

  it("HSB seed round-trips every colour within 1/255", () => {
    expect(maxOver((c) => diff(c, hsvRound(c)))).toBeLessThanOrEqual(1);
  });

  it("switching OKLCH -> HSB -> OKLCH preserves the colour within 2/255", () => {
    expect(
      maxOver((c) => {
        const a = oklchRound(c); // popover opens on OKLCH
        const b = hsvRound(a); // switch to HSB
        const d = oklchRound(b); // switch back to OKLCH
        return diff(c, d);
      }),
    ).toBeLessThanOrEqual(2);
  });

  it("keeps converging - extra switches don't drift further (within 1/255)", () => {
    expect(
      maxOver((c) => {
        const settled = oklchRound(hsvRound(oklchRound(c)));
        const again = oklchRound(hsvRound(settled));
        return diff(settled, again);
      }),
    ).toBeLessThanOrEqual(1);
  });
});

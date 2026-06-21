import { describe, it, expect } from "vitest";
import { hexToHsv, hsvToHex } from "../src/colors/hsv";

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

describe("hsvToHex", () => {
  it("maps the primary HSV corners", () => {
    expect(hsvToHex(0, 1, 1)).toBe("#ff0000"); // red
    expect(hsvToHex(120, 1, 1)).toBe("#00ff00"); // green
    expect(hsvToHex(240, 1, 1)).toBe("#0000ff"); // blue
    expect(hsvToHex(0, 0, 1)).toBe("#ffffff"); // white (no saturation)
    expect(hsvToHex(0, 0, 0)).toBe("#000000"); // black (no value)
  });
});

describe("hexToHsv", () => {
  it("reads hue/sat/val of red and a mid-grey", () => {
    const r = hexToHsv("#ff0000");
    expect(r.h).toBeCloseTo(0, 3);
    expect(r.s).toBeCloseTo(1, 3);
    expect(r.v).toBeCloseTo(1, 3);
    const grey = hexToHsv("#808080");
    expect(grey.s).toBeCloseTo(0, 2);
    expect(grey.v).toBeCloseTo(128 / 255, 2);
  });
});

describe("round-trips hex -> hsv -> hex", () => {
  for (const hex of ["#ff0000", "#00ff00", "#0000ff", "#123456", "#9aa0a6", "#f3722c"]) {
    it(hex, () => {
      const o = hexToHsv(hex);
      const [r1, g1, b1] = rgb(hex);
      const [r2, g2, b2] = rgb(hsvToHex(o.h, o.s, o.v));
      expect(Math.abs(r1 - r2)).toBeLessThanOrEqual(1);
      expect(Math.abs(g1 - g2)).toBeLessThanOrEqual(1);
      expect(Math.abs(b1 - b2)).toBeLessThanOrEqual(1);
    });
  }
});

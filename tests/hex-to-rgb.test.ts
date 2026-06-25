import { describe, it, expect } from "vitest";
import { hexToRgb } from "../src/colors/hex";

// The one hex -> RGB parse, now shared by gradient.parseHex and the OKLCH / HSV
// converters (they had three verbatim copies of this).
describe("hexToRgb", () => {
  it("parses #rrggbb", () => {
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#ff8800")).toEqual([255, 136, 0]);
  });

  it("expands #rgb shorthand", () => {
    expect(hexToRgb("#f00")).toEqual([255, 0, 0]);
    expect(hexToRgb("#abc")).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it("accepts a bare hex (no #) and ignores 8-digit alpha", () => {
    expect(hexToRgb("00ff00")).toEqual([0, 255, 0]);
    expect(hexToRgb("#11223344")).toEqual([0x11, 0x22, 0x33]);
  });

  it("yields [0, 0, 0] for anything invalid", () => {
    expect(hexToRgb("nope")).toEqual([0, 0, 0]);
    expect(hexToRgb("")).toEqual([0, 0, 0]);
    expect(hexToRgb("#12")).toEqual([0, 0, 0]);
  });
});

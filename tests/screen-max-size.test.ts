import { describe, it, expect } from "vitest";
import { screenMaxSize } from "../src/canvas-size";

// screenMaxSize turns the (possibly fractional) visual-viewport size into the
// largest whole-pixel canvas that fits, minus the border on each side.
describe("screenMaxSize", () => {
  it("subtracts the border on both sides and returns whole pixels", () => {
    expect(screenMaxSize(800, 600, 2)).toEqual({ width: 796, height: 596 });
  });

  it("floors fractional viewport sizes (fractional devicePixelRatio / zoom)", () => {
    // 1459.199951171875 - 4 = 1455.199... -> 1455; 672.7999877929688 - 4 -> 668
    expect(screenMaxSize(1459.199951171875, 672.7999877929688, 2)).toEqual({
      width: 1455,
      height: 668,
    });
  });

  it("floors down (a max bound never overflows the viewport)", () => {
    expect(screenMaxSize(100.9, 100.9, 0)).toEqual({ width: 100, height: 100 });
  });

  it("never returns less than 1px", () => {
    expect(screenMaxSize(3, 3, 2)).toEqual({ width: 1, height: 1 });
  });
});

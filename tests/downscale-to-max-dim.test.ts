import { describe, it, expect } from "vitest";
import { downscaleToMaxDim } from "../src/export";

// A3: the shared "fit a device-pixel source to a small preview" geometry, used by
// the save thumbnail (maxDim 100) and the GIF recorder (maxDim 640, clamped).
describe("downscaleToMaxDim", () => {
  it("fits the longest side to maxDim (landscape + portrait)", () => {
    expect(downscaleToMaxDim({ width: 200, height: 100 }, 100)).toEqual({
      width: 100,
      height: 50,
      scale: 0.5,
    });
    expect(downscaleToMaxDim({ width: 100, height: 200 }, 100)).toEqual({
      width: 50,
      height: 100,
      scale: 0.5,
    });
  });

  it("upscales by default, but never with clampToOne", () => {
    // Smaller than maxDim: the default scales it up...
    expect(downscaleToMaxDim({ width: 50, height: 30 }, 100)).toMatchObject({
      width: 100,
      height: 60,
    });
    // ...clampToOne leaves it untouched (no upscale - the GIF cap).
    expect(downscaleToMaxDim({ width: 50, height: 30 }, 100, { clampToOne: true })).toEqual({
      width: 50,
      height: 30,
      scale: 1,
    });
  });

  it("rounds dimensions and never goes below 1px", () => {
    expect(downscaleToMaxDim({ width: 3, height: 2 }, 100)).toMatchObject({
      width: 100,
      height: 67, // round(2 * 100/3) = round(66.67)
    });
    expect(downscaleToMaxDim({ width: 1, height: 1 }, 100, { clampToOne: true })).toEqual({
      width: 1,
      height: 1,
      scale: 1,
    });
  });
});

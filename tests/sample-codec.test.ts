import { describe, it, expect } from "vitest";
import {
  quantizeCoord,
  dequantizeCoord,
  quantizePressure,
  dequantizePressure,
  quantizeDt,
  dequantizeDt,
} from "../src/log/sample-codec";

// P1.2: the recorder quantizes samples AT SOURCE (contract G2). These are the
// quantizers; every output must be an integer within the schema's bounds, and
// dequantize must land within one quantization step of the input.
describe("sample codec (vector-replay P1.2)", () => {
  it("coords snap to 1/8 px integers, reversible within 1/16 px", () => {
    for (const px of [0, 1, 12.3, -47.9, 480.0625, 1919.9]) {
      const q = quantizeCoord(px);
      expect(Number.isInteger(q)).toBe(true);
      expect(Math.abs(dequantizeCoord(q) - px)).toBeLessThanOrEqual(1 / 16 + 1e-9);
    }
  });

  it("pressure snaps to a 10-bit integer (0..1023) and clamps out-of-range", () => {
    for (const p of [0, 0.5, 1, 0.123]) {
      const q = quantizePressure(p);
      expect(Number.isInteger(q)).toBe(true);
      expect(q).toBeGreaterThanOrEqual(0);
      expect(q).toBeLessThanOrEqual(1023);
      expect(Math.abs(dequantizePressure(q) - p)).toBeLessThanOrEqual(1 / 1023 + 1e-9);
    }
    expect(quantizePressure(-1)).toBe(0);
    expect(quantizePressure(9)).toBe(1023);
  });

  it("dt snaps to 0.1 ms integers and never goes negative", () => {
    for (const ms of [0, 8.33, 16.67, 250]) {
      const q = quantizeDt(ms);
      expect(Number.isInteger(q)).toBe(true);
      expect(q).toBeGreaterThanOrEqual(0);
      expect(Math.abs(dequantizeDt(q) - ms)).toBeLessThanOrEqual(0.05 + 1e-9);
    }
    expect(quantizeDt(-5)).toBe(0);
  });
});

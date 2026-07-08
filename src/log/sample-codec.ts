import { COORD_UNIT, PRESSURE_MAX, DT_UNIT } from "./events";

// Quantizers the recorder applies AT SOURCE (contract G2): the live draw path and
// the log must consume the SAME values, else replay's anti-aliasing amplifies the
// last-bit drift. Coords -> 1/8 px, pressure -> 10 bits, dt -> 0.1 ms. The binary
// pack/unpack is deferred to P6.1.

const COORD_SCALE = 1 / COORD_UNIT; // 8 quantized units per px
const DT_SCALE = 1 / DT_UNIT; // 10 quantized units per ms

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

// Coordinates: signed integer count of 1/8 px units.
export function quantizeCoord(px: number): number {
  return Math.round(px * COORD_SCALE);
}
export function dequantizeCoord(q: number): number {
  return q * COORD_UNIT;
}

// Pressure: 0..1 -> a 10-bit integer (0..1023).
export function quantizePressure(p: number): number {
  return Math.round(clamp01(p) * PRESSURE_MAX);
}
export function dequantizePressure(q: number): number {
  return q / PRESSURE_MAX;
}

// Inter-sample dt (ms, non-negative) -> integer count of 0.1 ms units.
export function quantizeDt(ms: number): number {
  return Math.max(0, Math.round(ms * DT_SCALE));
}
export function dequantizeDt(q: number): number {
  return q * DT_UNIT;
}

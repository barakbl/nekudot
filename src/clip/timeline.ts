import { CAPTURE_FPS } from "./recorder";

// Pure helpers for the preview's speed + trim controls (unit-tested).

export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;

// Per-frame delay (ms) for a playback-speed multiplier: faster speed = shorter
// delay. Clamped to 20ms, below which browsers/GIF effectively ignore it.
export function delayMsForSpeed(speed: number, captureFps = CAPTURE_FPS): number {
  const base = 1000 / captureFps;
  return Math.max(20, Math.round(base / speed));
}

export function clipDurationMs(frameCount: number, delayMs: number): number {
  return frameCount * delayMs;
}

// Keep the trim handles ordered within [0, count-1] and at least 2 frames apart.
export function clampTrim(
  start: number,
  end: number,
  count: number,
): { start: number; end: number } {
  const max = Math.max(1, count - 1);
  const s = Math.min(Math.max(0, Math.round(start)), max - 1);
  const e = Math.min(Math.max(s + 1, Math.round(end)), max);
  return { start: s, end: e };
}

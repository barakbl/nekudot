import { describe, it, expect } from "vitest";
import { delayMsForSpeed, clampTrim, clipDurationMs } from "../src/clip/timeline";

describe("gif timeline helpers", () => {
  it("speed scales the frame delay (faster = shorter), clamped to 20ms", () => {
    expect(delayMsForSpeed(1, 12)).toBe(Math.round(1000 / 12)); // ~83ms
    expect(delayMsForSpeed(2, 12)).toBe(Math.round(1000 / 12 / 2)); // ~42ms
    expect(delayMsForSpeed(0.5, 12)).toBe(Math.round(1000 / 12 / 0.5)); // ~167ms
    expect(delayMsForSpeed(100, 12)).toBe(20); // clamp floor
  });

  it("clampTrim keeps handles ordered and >= 2 frames apart, within range", () => {
    expect(clampTrim(2, 8, 10)).toEqual({ start: 2, end: 8 });
    expect(clampTrim(5, 5, 10)).toEqual({ start: 5, end: 6 }); // end pushed past start
    expect(clampTrim(8, 3, 10)).toEqual({ start: 8, end: 9 }); // end below start
    expect(clampTrim(-3, 100, 10)).toEqual({ start: 0, end: 9 }); // clamped to bounds
    expect(clampTrim(9, 9, 10)).toEqual({ start: 8, end: 9 }); // start capped at max-1
  });

  it("clipDurationMs is frames * delay", () => {
    expect(clipDurationMs(10, 100)).toBe(1000);
  });
});

import { describe, it, expect } from "vitest";
import { planFrames, collapsedActivityMs, type FramePlanOptions } from "../src/clip/replay-timeline";

// P3.2: idle-gap collapse + target-duration mapping. Pure, so unit-tested over
// synthetic sessions with dwells + gaps (the house style, like timeline.test.ts).

const OPTS = (o: Partial<FramePlanOptions> = {}): FramePlanOptions => ({
  idleGapMs: 500,
  targetDurationMs: 4000,
  fps: 12,
  maxFrames: 300,
  ...o,
});

describe("collapsedActivityMs", () => {
  it("clamps each idle gap to the threshold", () => {
    // gaps: 100, 100, 9800->500, 100  => 800
    expect(collapsedActivityMs([0, 100, 200, 10_000, 10_100], 500)).toBe(800);
  });
  it("is 0 for a dwell (all same time) and for a single/empty timeline", () => {
    expect(collapsedActivityMs([5, 5, 5], 500)).toBe(0);
    expect(collapsedActivityMs([42], 500)).toBe(0);
    expect(collapsedActivityMs([], 500)).toBe(0);
  });
});

describe("planFrames", () => {
  it("handles empty + single-state timelines", () => {
    expect(planFrames([], OPTS())).toEqual([]);
    expect(planFrames([1000], OPTS())).toEqual([0]);
  });

  it("frame count = round(targetDuration*fps), capped at maxFrames", () => {
    const times = Array.from({ length: 50 }, (_, i) => i * 40);
    expect(planFrames(times, OPTS({ targetDurationMs: 4000, fps: 12 })).length).toBe(48);
    expect(planFrames(times, OPTS({ targetDurationMs: 100_000, fps: 12, maxFrames: 120 })).length).toBe(120);
  });

  it("is non-decreasing, starts at 0, ends at the last state", () => {
    const times = Array.from({ length: 30 }, (_, i) => i * 33 + (i > 15 ? 5000 : 0));
    const plan = planFrames(times, OPTS());
    expect(plan[0]).toBe(0);
    expect(plan[plan.length - 1]).toBe(times.length - 1);
    for (let i = 1; i < plan.length; i++) expect(plan[i]).toBeGreaterThanOrEqual(plan[i - 1]);
  });

  it("collapses a huge idle gap so both activity bursts get real screen time", () => {
    // burst A: 10 states over 500ms; a 30s think gap; burst B: 10 states over 500ms.
    const a = Array.from({ length: 10 }, (_, i) => i * 55); // 0..495
    const b = Array.from({ length: 10 }, (_, i) => 30_500 + i * 55); // 30500..30995
    const times = [...a, ...b];
    const plan = planFrames(times, OPTS({ idleGapMs: 500, targetDurationMs: 6000, fps: 12 }));
    const framesOnB = plan.filter((i) => i >= 10).length;
    // With collapse, burst B (the second half of activity) occupies a large share of
    // the video. Without collapse the 30s gap would swallow ~98% of the timeline and
    // B would get ~2%. Assert it's well-represented.
    expect(framesOnB / plan.length).toBeGreaterThan(0.25);
    // and a raw-time mapping would NOT: the gap dominates the un-collapsed span.
    const rawGapShare = (times[10] - times[9]) / (times[times.length - 1] - times[0]);
    expect(rawGapShare).toBeGreaterThan(0.9); // sanity: the raw gap really is huge
  });

  it("spreads evenly when there are no long gaps", () => {
    const times = Array.from({ length: 12 }, (_, i) => i * 100); // steady
    const plan = planFrames(times, OPTS({ idleGapMs: 500, targetDurationMs: 1000, fps: 12 }));
    // 12 frames over 12 states -> roughly one state per frame, monotone to the end.
    expect(plan.length).toBe(12);
    expect(new Set(plan).size).toBeGreaterThanOrEqual(10);
  });

  it("handles a dwell (repeated identical times) with an even spread", () => {
    const times = [0, 0, 0, 0, 0];
    const plan = planFrames(times, OPTS({ targetDurationMs: 1000, fps: 6 }));
    expect(plan[0]).toBe(0);
    expect(plan[plan.length - 1]).toBe(4);
    for (let i = 1; i < plan.length; i++) expect(plan[i]).toBeGreaterThanOrEqual(plan[i - 1]);
  });
});

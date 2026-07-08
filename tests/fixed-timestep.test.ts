import { describe, it, expect } from "vitest";
import { FixedTimestep } from "../src/brushes/fixed-timestep";
import { dwellDeposits } from "./_replay-harness";

// P0.5 of the vector-replay roadmap: the frame-driven brushes (Spray, Wisp) step
// their physics on a FIXED virtual timestep advanced by elapsed time, instead of
// once per requestAnimationFrame callback. That makes their build-up a function of
// how long the stroke lasted - not the display's frame rate - which both fixes the
// "120 Hz builds ~2x faster" bug and makes them replayable from recorded timestamps.

// Count the steps a time stream drives.
function steps(times: number[]): number {
  const ts = new FixedTimestep();
  ts.reset();
  let n = 0;
  for (const t of times) ts.advance(t, () => (n += 1));
  return n;
}

// A stream of timestamps `dt` apart spanning `duration` ms, starting at 1000.
function stream(duration: number, dt: number): number[] {
  const out: number[] = [];
  for (let t = 0; t <= duration + 1e-6; t += dt) out.push(1000 + t);
  return out;
}

describe("FixedTimestep", () => {
  it("the first advance only anchors the clock (no steps yet)", () => {
    const ts = new FixedTimestep();
    let n = 0;
    ts.advance(1000, () => (n += 1));
    expect(n).toBe(0); // first advance only sets the anchor
    ts.advance(1020, () => (n += 1)); // +20 ms = one tick's worth elapsed
    expect(n).toBe(1);
  });

  it("step count follows elapsed time, not sample rate (60 vs 120 Hz)", () => {
    const s60 = stream(1000, 1000 / 60);
    const s120 = stream(1000, 1000 / 120);
    const at60 = steps(s60);
    const at120 = steps(s120);
    // Same duration -> same steps regardless of rate (within one, since summing
    // different fp deltas can land on either side of a tick boundary).
    expect(Math.abs(at60 - at120)).toBeLessThanOrEqual(1);
    expect(at60).toBeGreaterThanOrEqual(59); // ~60 steps for a 1 s dwell
    expect(at60).toBeLessThanOrEqual(61);
    // The point: the 120 Hz stream has ~2x the samples but NOT ~2x the steps.
    expect(s120.length).toBeGreaterThan(at120 * 1.8);
  });

  it("bounds catch-up after a huge gap instead of stepping thousands of times", () => {
    const ts = new FixedTimestep();
    ts.advance(0, () => {}); // anchor
    let n = 0;
    ts.advance(60_000, () => (n += 1)); // a 60 s jump (backgrounded tab)
    expect(n).toBeLessThanOrEqual(60); // capped, not ~3600
  });
});

describe("Spray dwell density (P0.5a)", () => {
  it("deposits ~the same for a 60 Hz and a 120 Hz dwell of equal duration", () => {
    const at60 = dwellDeposits("Spray", { durationMs: 1000, sampleDtMs: 1000 / 60 });
    const at120 = dwellDeposits("Spray", { durationMs: 1000, sampleDtMs: 1000 / 120 });
    expect(at60).toBeGreaterThan(30); // it actually sprayed
    // Rate-independent build-up (±1 fp). The old rAF loop deposited per frame, so a
    // 120 Hz stream (~2x the samples here) built up ~2x; now it tracks duration.
    expect(Math.abs(at60 - at120)).toBeLessThanOrEqual(1);
    expect(at120).toBeLessThan(80); // ~61, NOT the ~121 a per-sample loop would give
  });
});

// A fixed-timestep accumulator for the frame-driven brushes (Spray, Wisp). They
// used to step their particle physics once per requestAnimationFrame callback, so
// a 120 Hz display built up ~2x faster than 60 Hz (a latent bug) and their output
// depended on the display's frame cadence + the wall clock - not replayable.
//
// Instead, advance a VIRTUAL clock by elapsed time and run one physics step per
// fixed TICK_MS of it. The elapsed time comes from the recorded stroke timestamps
// during a moving stroke (BrushBase.stroke's `time`) and, live, from the input
// funnel's animation pump while the pointer dwells (BrushBase.animate). Both are
// the same DOMHighResTimeStamp clock, so live and replay agree; the tick count is
// a pure function of the timestamps, so it no longer depends on the frame rate.
export const TICK_MS = 1000 / 60;

// Bound the catch-up after a big time gap (a backgrounded tab, a slow frame) so a
// single advance can't spawn thousands of steps and stall; the dropped remainder
// is imperceptible and never happens on the per-frame live pump.
const MAX_STEPS_PER_ADVANCE = 60;

export class FixedTimestep {
  private clock: number | null = null; // virtual ms; null until the first sample anchors it
  private acc = 0; // elapsed virtual ms not yet spent on a step
  // Live, the per-call cap guards against a stall when a big gap arrives at once
  // (a backgrounded tab returning). Replay legitimately gets a whole dwell as one
  // big gap on the sample after it - there the cap would DROP that time and
  // under-build the plume (a held Wisp comes back pale), and there's no live pump
  // to stall, so replay runs the full catch-up. See setReplayTiming.
  private capped = true;

  // Start a fresh stroke: the next advance() only anchors the clock (no steps).
  reset(): void {
    this.clock = null;
    this.acc = 0;
  }

  // Replay drives the whole dwell as one large advance(); run every step so the
  // build matches the live per-frame pump instead of capping + dropping.
  setCapped(on: boolean): void {
    this.capped = on;
  }

  // Advance the virtual clock to `t` (ms), invoking step() once per TICK_MS elapsed.
  advance(t: number, step: () => void): void {
    if (this.clock === null) {
      this.clock = t;
      return;
    }
    this.acc += Math.max(0, t - this.clock);
    this.clock = t;
    let n = 0;
    while (this.acc >= TICK_MS && (!this.capped || n < MAX_STEPS_PER_ADVANCE)) {
      this.acc -= TICK_MS;
      n += 1;
      step();
    }
    if (this.capped && n === MAX_STEPS_PER_ADVANCE) this.acc = 0; // drop the unbounded remainder
  }
}

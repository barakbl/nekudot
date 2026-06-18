// Position smoothing — "streamline" (Procreate) / "stabilizer" (Krita). The
// drawn point chases the raw cursor with a lag, so hand wobble gets ironed out
// and a broad nib lays down clean curves. Pure per-stroke state, so it mirrors
// PenSmoother (self-seeds on the first sample, reset() between strokes) and is
// trivially unit-testable. Opt-in: only brushes that override BrushBase
// .streamlines() route their samples through it.

export type Point = { x: number; y: number };

// Stop draining once we're this close to the final cursor point, and cap the
// catch-up so a heavy strength can't loop forever (it closes the gap exactly).
const DRAIN_EPSILON = 0.5;
const MAX_DRAIN_STEPS = 64;

// 0..100 strength → the fraction of the gap the point closes each sample. 0 → 1
// (raw: the point jumps straight to the cursor), 100 → 0.05 (heavy lag). Same
// shape as the pen "Smoothing" knob: higher = smoother and laggier.
function pullFactor(strength: number): number {
  const s = Math.min(100, Math.max(0, strength));
  return Math.max(0.05, 1 - s / 100);
}

export class Streamliner {
  // null until the first sample of a stroke; holds the smoothed (drawn) point.
  private x: number | null = null;
  private y: number | null = null;
  // The last raw cursor point — drain() catches the smoothed point up to it.
  private targetX = 0;
  private targetY = 0;

  reset(): void {
    this.x = null;
    this.y = null;
  }

  // Smooth one raw sample → the point to draw/deposit. Self-seeds to the raw
  // point on the first sample so the mark starts exactly under the pen (crisp,
  // no start lag); thereafter the point trails the cursor by pullFactor.
  push(x: number, y: number, strength: number): Point {
    this.targetX = x;
    this.targetY = y;
    if (this.x === null || this.y === null) {
      this.x = x;
      this.y = y;
      return { x, y };
    }
    const k = pullFactor(strength);
    this.x += k * (x - this.x);
    this.y += k * (y - this.y);
    return { x: this.x, y: this.y };
  }

  // At pen-up the smoothed point still lags behind the last cursor point; emit
  // the catch-up points so the inked line reaches where the pen actually lifted
  // (otherwise streamline always clips a letter's terminal short).
  *drain(strength: number): Generator<Point> {
    if (this.x === null || this.y === null) return;
    const k = pullFactor(strength);
    for (let i = 0; i < MAX_DRAIN_STEPS; i++) {
      if (Math.hypot(this.targetX - this.x, this.targetY - this.y) < DRAIN_EPSILON)
        return;
      this.x += k * (this.targetX - this.x);
      this.y += k * (this.targetY - this.y);
      yield { x: this.x, y: this.y };
    }
    // Capped (very heavy strength): close the remaining gap exactly.
    this.x = this.targetX;
    this.y = this.targetY;
    yield { x: this.x, y: this.y };
  }
}

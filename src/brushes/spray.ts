import { BrushBase, type BrushSetting } from "../base";
import { MOUSE_SAMPLE, type PenSample } from "../pen";
import type { BrushContext } from "./registry";
import { FixedTimestep } from "./fixed-timestep";

export const icon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M4 8 h6 v9 a1.5 1.5 0 0 1 -1.5 1.5 h-3 A1.5 1.5 0 0 1 4 17 Z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="13.5" cy="6" r="1"/><circle cx="17.5" cy="8.5" r="1"/><circle cx="14.5" cy="11" r="1"/><circle cx="19" cy="12.5" r="1"/><circle cx="15" cy="15" r="1"/><circle cx="20" cy="6.5" r="1"/></svg>';

export function create(c: BrushContext): SprayBrush {
  return new SprayBrush(c.host, undefined, c.store);
}

// Airbrush: scatters specks within a radius around the pointer, building density
// the longer you DWELL (a per-frame loop keeps spraying while you hold still).
// A *throttled feeder*: it drops ONE searchable point per frame into the memory
// map (not one per speck), so connecting brushes can weave over the spray without
// flooding the point cloud and evicting older points. Spray, then switch to Round
// to web over the cloud you laid.
export class SprayBrush extends BrushBase {
  private radius = 28; // spread of the spray, px
  private flow = 12; // specks per frame
  private dotSize = 4; // speck diameter, px

  private drawing = false;
  private cx = 0;
  private cy = 0;
  private clock = new FixedTimestep();
  private pressure = 1; // last stylus pressure (1 for a mouse / pen off)

  name(): string {
    return "Spray";
  }

  // Frame-driven: the funnel pumps animate() so a dwell keeps spraying.
  animates(): boolean {
    return true;
  }

  // Each speck composites individually so density builds with dwell (the airbrush
  // look) - never the one-uniform-alpha wet buffer.
  bufferedStroke(): boolean {
    return false;
  }

  // Replay hands the whole dwell over as one big step; run the full catch-up so a
  // held spray rebuilds to the same density instead of the live per-call cap.
  setReplayTiming(on: boolean): void {
    this.clock.setCapped(!on);
  }

  // Selecting Spray sets a soft-but-visible global Opacity out of the box (raise
  // the Opacity slider for a harder edge).
  getSelectOpacity(): number {
    return 0.35;
  }

  strokeStart(x: number, y: number): void {
    this.cx = x;
    this.cy = y;
    this.pressure = 1;
    this.drawing = true;
    this.clock.reset();
    this.spray(); // an immediate puff, so even a tap leaves a mark
  }

  // Movement moves the spray centre and advances the virtual clock by the sample's
  // timestamp, spraying one puff per fixed tick of elapsed time (holding still
  // keeps building via the funnel's animate() pump). Bypasses the base per-sample
  // deposit/draw. `time` is the recorded event time; on a bare call it's absent and
  // only the immediate strokeStart puff lands (fine for the static preview).
  stroke(x: number, y: number, _sample = true, pen: PenSample = MOUSE_SAMPLE, time?: number): void {
    this.cx = x;
    this.cy = y;
    this.pressure = pen.isPen ? pen.pressure : 1;
    if (time !== undefined) this.clock.advance(time, this.spray);
  }

  // Live dwell pump: the funnel calls this each frame with performance.now(), the
  // same clock the sample timestamps use, so a still hold keeps spraying at 60 Hz.
  animate(now: number): void {
    if (this.drawing) this.clock.advance(now, this.spray);
  }

  strokeEnd(): void {
    this.drawing = false;
    super.strokeEnd();
  }

  // One tick: a handful of specks across the disc, plus one deposited point. An
  // arrow so it can be handed to FixedTimestep.advance as the per-tick step.
  private spray = (): void => {
    const p = this.pressure; // 1 for a mouse / pen disabled
    const r = this.radius * (0.35 + 0.65 * p);
    const n = Math.max(1, Math.round(this.flow * p));
    const dot = this.dotSize / 2;
    for (let i = 0; i < n; i++) {
      const a = this.random() * Math.PI * 2;
      const rr = Math.sqrt(this.random()) * r; // uniform over the disc
      // Colour + alpha come from the toolbar colour + Opacity slider (undefined).
      this.renderer.fillCircle(this.cx + Math.cos(a) * rr, this.cy + Math.sin(a) * rr, dot);
    }
    // Throttled feeder: one searchable point per frame, at a random speck spot.
    const a = this.random() * Math.PI * 2;
    const rr = Math.sqrt(this.random()) * r;
    this.depositPixel(this.cx + Math.cos(a) * rr, this.cy + Math.sin(a) * rr);
  }

  getSettings(): BrushSetting[] {
    return [
      {
        kind: "number",
        key: "sprayRadius",
        label: "Radius",
        min: 4,
        max: 80,
        step: 1,
        value: this.radius,
        onChange: (v) => (this.radius = v),
      },
      {
        kind: "number",
        key: "sprayFlow",
        label: "Flow",
        min: 1,
        max: 20,
        step: 1,
        value: this.flow,
        onChange: (v) => (this.flow = v),
      },
      {
        kind: "number",
        key: "sprayDot",
        label: "Dot size",
        min: 1,
        max: 10,
        step: 1,
        value: this.dotSize,
        onChange: (v) => (this.dotSize = v),
      },
    ];
  }
}

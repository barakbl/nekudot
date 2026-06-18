import { BrushBase, type BrushSetting } from "../base";
import { MOUSE_SAMPLE, type PenSample } from "../pen";
import type { BrushContext } from "./registry";

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
  private flow = 9; // specks per frame
  private dotSize = 3; // speck diameter, px

  private active = false;
  private cx = 0;
  private cy = 0;
  private raf = 0;
  private pressure = 1; // last stylus pressure (1 for a mouse / pen off)

  name(): string {
    return "Spray";
  }

  // Each speck composites individually so density builds with dwell (the airbrush
  // look) - never the one-uniform-alpha wet buffer.
  bufferedStroke(): boolean {
    return false;
  }

  // Selecting Spray drops the global Opacity low so specks build softly out of
  // the box (raise the Opacity slider for a harder edge).
  getSelectOpacity(): number {
    return 0.2;
  }

  strokeStart(x: number, y: number): void {
    this.cx = x;
    this.cy = y;
    this.pressure = 1;
    this.spray(); // an immediate puff, so even a tap leaves a mark
    if (!this.active) {
      this.active = true;
      if (typeof requestAnimationFrame !== "undefined")
        this.raf = requestAnimationFrame(this.tick);
    }
  }

  // Movement only moves the spray centre; the rAF loop does the spraying, so
  // holding still keeps building. Bypasses the base per-sample deposit/draw.
  stroke(x: number, y: number, _sample = true, pen: PenSample = MOUSE_SAMPLE): void {
    this.cx = x;
    this.cy = y;
    this.pressure = pen.isPen ? pen.pressure : 1;
  }

  strokeEnd(): void {
    this.active = false;
    if (this.raf && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    super.strokeEnd();
  }

  private tick = (): void => {
    if (!this.active) return;
    this.spray();
    this.raf = requestAnimationFrame(this.tick);
  };

  // One frame: a handful of specks across the disc, plus one deposited point.
  private spray(): void {
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

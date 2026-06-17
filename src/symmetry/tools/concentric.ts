import { SymmetryTool, type SymSetting, type ToolContext } from "../tool";
import type { IRenderer } from "../../renderer";
import { type Transform, IDENTITY, scaleRotateAbout } from "../transforms";

export const icon =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="3.4"/><circle cx="8" cy="8" r="1"/></svg>';

// Concentric: scaled (optionally twisted) copies nested into rings.
class ConcentricTool extends SymmetryTool {
  readonly usesCentre = true;
  rings = 5;
  scalePct = 70;
  twist = 0;

  // `rings` copies about the centre, each scaled by scalePct% of the previous
  // and rotated by `twist`. k=0 (scale 1, no rotation) is the master stroke.
  transforms(ctx: ToolContext): Transform[] {
    const rings = Math.max(1, Math.floor(this.rings));
    const step = this.scalePct / 100;
    const twist = (this.twist * Math.PI) / 180;
    const out: Transform[] = [];
    let scale = 1;
    for (let k = 0; k < rings; k++) {
      out.push(scaleRotateAbout(scale, twist * k, ctx.cx, ctx.cy));
      scale *= step;
    }
    return out.length ? out : [IDENTITY];
  }

  settings(): SymSetting[] {
    return [
      {
        kind: "slider",
        key: "rings",
        label: "Rings",
        min: 2,
        max: 12,
        value: this.rings,
        onChange: (v) => (this.rings = v),
        help: "How many scaled copies radiate from the centre (including the original).",
      },
      {
        kind: "slider",
        key: "scalePct",
        label: "Scale %",
        min: 50,
        max: 150,
        value: this.scalePct,
        onChange: (v) => (this.scalePct = v),
        help: "Size of each ring vs the previous. Under 100 shrinks inward; over 100 grows outward.",
      },
      {
        kind: "slider",
        key: "twist",
        label: "Twist",
        min: -90,
        max: 90,
        value: this.twist,
        onChange: (v) => (this.twist = v),
        help: "Rotate each ring a little for a spiral mandala. 0 = pure concentric rings.",
      },
    ];
  }

  drawGuides(r: IRenderer, ctx: ToolContext): void {
    const { cx, cy, size, guide } = ctx;
    // Faint reference rings (shrinking by Scale %) hinting at the scaling.
    const rings = Math.min(5, Math.max(1, Math.floor(this.rings)));
    const step = this.scalePct / 100;
    let rad = Math.min(size.width, size.height) * 0.4;
    for (let k = 0; k < rings && rad > 2; k++) {
      r.strokeCircle(cx, cy, rad, guide);
      rad *= step;
    }
  }
}

export const create = () => new ConcentricTool();

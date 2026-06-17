import { SymmetryTool, type SymSetting, type ToolContext } from "../tool";
import type { IRenderer } from "../../renderer";
import { type Transform, IDENTITY, rotateReflect } from "../transforms";

export const icon =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.8"/><path d="M8 2.2 V13.8 M2.2 8 H13.8 M3.9 3.9 L12.1 12.1 M12.1 3.9 L3.9 12.1"/></svg>';

// Radial (kaleidoscope): N rotations about the centre, optionally each reflected.
class RadialTool extends SymmetryTool {
  readonly usesCentre = true;
  segments = 8;
  mirror = true;

  // N rotations about the centre; with mirror, each rotation is paired with a
  // reflected copy. k=0 is the identity (the master stroke).
  transforms(ctx: ToolContext): Transform[] {
    const n = Math.max(1, Math.floor(this.segments));
    const step = (2 * Math.PI) / n;
    const out: Transform[] = [];
    for (let k = 0; k < n; k++) {
      out.push(rotateReflect(k * step, false, ctx.cx, ctx.cy));
      if (this.mirror) out.push(rotateReflect(k * step, true, ctx.cx, ctx.cy));
    }
    return out.length ? out : [IDENTITY];
  }

  settings(): SymSetting[] {
    return [
      {
        kind: "slider",
        key: "segments",
        label: "Segments",
        min: 2,
        max: 24,
        value: this.segments,
        onChange: (v) => (this.segments = v),
        help: "How many wedges the kaleidoscope splits into around the centre.",
      },
      {
        kind: "toggle",
        key: "mirror",
        label: "Mirror",
        value: this.mirror,
        onChange: (v) => (this.mirror = v),
        help: "Also reflect each wedge, so the pattern is symmetric within every slice (a true kaleidoscope).",
      },
    ];
  }

  drawGuides(r: IRenderer, ctx: ToolContext): void {
    const { cx, cy, size, guide } = ctx;
    const reach = Math.hypot(size.width, size.height); // past the corners
    const n = Math.max(1, Math.floor(this.segments));
    const spokes = this.mirror ? n * 2 : n;
    const step = (2 * Math.PI) / spokes;
    for (let k = 0; k < spokes; k++) {
      const a = k * step;
      r.drawLine(
        { id: 0, x: cx, y: cy },
        { id: 0, x: cx + Math.cos(a) * reach, y: cy + Math.sin(a) * reach },
        guide,
      );
    }
  }
}

export const create = () => new RadialTool();

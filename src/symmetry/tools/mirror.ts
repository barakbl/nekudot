import { SymmetryTool, type SymSetting, type ToolContext } from "../tool";
import type { IRenderer } from "../../renderer";
import { type Transform, IDENTITY, reflectAcrossLine } from "../transforms";

export const icon =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="2" x2="8" y2="14" stroke-dasharray="2 2"/><path d="M6 5 L3 8 L6 11 Z"/><path d="M10 5 L13 8 L10 11 Z"/></svg>';
// Vertical reuses the mode glyph; horizontal is the same picture rotated 90.
const H_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="8" x2="14" y2="8" stroke-dasharray="2 2"/><path d="M5 6 L8 3 L11 6 Z"/><path d="M5 10 L8 13 L11 10 Z"/></svg>';

// Mirror: one reflection across a line through the centre, at any angle. The
// quick buttons (persist:false - the Angle slider owns the stored value) set
// 90 (vertical) or 0 (horizontal).
class MirrorTool extends SymmetryTool {
  readonly usesCentre = true;
  angle = 90;

  // The master plus one reflection across the line at `angle` through the centre.
  transforms(ctx: ToolContext): Transform[] {
    return [IDENTITY, reflectAcrossLine((this.angle * Math.PI) / 180, ctx.cx, ctx.cy)];
  }

  settings(): SymSetting[] {
    return [
      {
        kind: "segment",
        key: "axis",
        persist: false,
        options: [
          { value: "90", label: "Vertical", icon },
          { value: "0", label: "Horizontal", icon: H_ICON },
        ],
        value: this.angle === 90 ? "90" : this.angle === 0 ? "0" : "",
        onChange: (v) => (this.angle = Number(v)),
      },
      {
        kind: "slider",
        key: "angle",
        label: "Angle",
        min: 0,
        max: 180,
        value: Math.round(this.angle),
        onChange: (v) => (this.angle = v),
        help: "Tilt the mirror line. 90 = vertical, 0 = horizontal, in between = a diagonal mirror.",
      },
    ];
  }

  drawGuides(r: IRenderer, ctx: ToolContext): void {
    const { cx, cy, size, guide } = ctx;
    const t = (this.angle * Math.PI) / 180;
    const len = Math.hypot(size.width, size.height);
    const dx = Math.cos(t) * len;
    const dy = Math.sin(t) * len;
    r.drawLine({ id: 0, x: cx - dx, y: cy - dy }, { id: 0, x: cx + dx, y: cy + dy }, guide);
  }
}

export const create = () => new MirrorTool();

import { GridBrush } from "./grid";
import type { BrushSetting } from "../base";
import type { BrushContext } from "./registry";

export const icon =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">' +
  '<line x1="3" y1="13" x2="9" y2="7"/>' +
  '<line x1="8" y1="14" x2="14" y2="8"/>' +
  "</svg>";

export function create(c: BrushContext): LinesBrush {
  return new LinesBrush(c.renderer, c.finder, undefined, c.store);
}

export class LinesBrush extends GridBrush {
  private lineAngle = 45; // degrees, 0 = horizontal
  private lineSize = 12; // length in CSS pixels

  name() {
    return "Lines";
  }

  protected paintAt(x: number, y: number, alpha: number): void {
    const half = this.lineSize / 2;
    const rad = (this.lineAngle * Math.PI) / 180;
    const dx = Math.cos(rad) * half;
    const dy = Math.sin(rad) * half;
    this.renderer.drawLine(
      { id: 0, x: x - dx, y: y - dy },
      { id: 0, x: x + dx, y: y + dy },
      { alpha, cap: "round" },
    );
  }

  getSettings(): BrushSetting[] {
    return this.persistSettings([
      ...this.gridSettings(),
      {
        kind: "number",
        key: "lineAngle",
        label: "Angle",
        min: 0,
        max: 180,
        step: 1,
        value: this.lineAngle,
        onChange: (v) => {
          this.lineAngle = v;
        },
      },
      {
        kind: "number",
        key: "lineSize",
        label: "Length",
        min: 2,
        max: 80,
        step: 1,
        value: this.lineSize,
        onChange: (v) => {
          this.lineSize = v;
        },
      },
    ]);
  }
}

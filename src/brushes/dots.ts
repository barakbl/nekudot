import { GridBrush } from "./grid";
import type { BrushSetting } from "../base";
import type { BrushContext } from "./registry";

export const icon =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">' +
  '<circle cx="5" cy="5" r="1.6"/>' +
  '<circle cx="11" cy="5" r="1.6"/>' +
  '<circle cx="5" cy="11" r="1.6"/>' +
  '<circle cx="11" cy="11" r="1.6"/>' +
  "</svg>";

export function create(c: BrushContext): DotsBrush {
  return new DotsBrush(c.renderer, c.finder, undefined, c.store);
}

export class DotsBrush extends GridBrush {
  private dotRadius = 4;

  name() {
    return "Dots";
  }

  protected paintAt(x: number, y: number, alpha: number): void {
    // color=undefined → renderer uses its current strokeStyle (main color)
    this.renderer.fillCircle(x, y, this.dotRadius, undefined, alpha);
  }

  getSettings(): BrushSetting[] {
    return this.persistSettings([
      ...this.gridSettings(),
      {
        kind: "number",
        key: "dotRadius",
        label: "Dot radius",
        min: 1,
        max: 20,
        step: 1,
        value: this.dotRadius,
        onChange: (v) => {
          this.dotRadius = v;
        },
      },
    ]);
  }
}

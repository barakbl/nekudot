import { ShapesStrokeBrush, type ShapeDrawParams } from "./shapes-stroke";
import type { BrushContext } from "./registry";

export const icon = "◯";

export function create(c: BrushContext): CirclesBrush {
  return new CirclesBrush(c.host, undefined, c.store);
}

export class CirclesBrush extends ShapesStrokeBrush {
  name() {
    return "Circles";
  }

  protected drawAt(p: ShapeDrawParams): void {
    const r = p.size / 2;
    if (p.fillColor !== null) {
      this.renderer.fillCircle(p.cx, p.cy, r, p.fillColor, p.fillAlpha);
    }
    this.renderer.strokeCircle(p.cx, p.cy, r, { dash: p.dashPattern });
  }
}

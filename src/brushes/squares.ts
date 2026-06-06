import { ShapesStrokeBrush, type ShapeDrawParams } from "./shapes-stroke";
import type { BrushContext } from "./registry";

export const icon = "▭";

export function create(c: BrushContext): SquaresBrush {
  return new SquaresBrush(c.renderer, c.finder, undefined, c.store);
}

export class SquaresBrush extends ShapesStrokeBrush {
  name() {
    return "Squares";
  }

  protected drawAt(p: ShapeDrawParams): void {
    if (p.fillColor !== null) {
      this.renderer.fillRect(
        p.cx,
        p.cy,
        p.size,
        p.size,
        p.fillColor,
        p.angle,
        p.fillAlpha,
      );
    }
    this.renderer.strokeRect(
      p.cx,
      p.cy,
      p.size,
      p.size,
      { dash: p.dashPattern },
      p.angle,
    );
  }
}

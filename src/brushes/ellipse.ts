import { GridBrush } from "./grid";
import type { BrushSetting } from "../base";
import type { BrushContext } from "./registry";

export const icon =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">' +
  '<ellipse cx="8" cy="8" rx="6" ry="3.2" transform="rotate(-30 8 8)"/>' +
  "</svg>";

export function create(c: BrushContext): EllipseBrush {
  return new EllipseBrush(c.renderer, c.finder, undefined, c.store);
}

type FillMode = "none" | "main" | "secondary";

// Grid-tap brush that stamps an ellipse at every grid intersection in reach.
// `ellipse` morphs from a round dot (0) to a flat ellipse (1); `angle` rotates it.
export class EllipseBrush extends GridBrush {
  private size = 10;
  private ellipse = 0; // 0 = round, 1 = flattest
  private angleDeg = 0;
  private fillMode: FillMode = "main";

  name() {
    return "Ellipse";
  }

  protected paintAt(x: number, y: number, alpha: number): void {
    const rx = this.size;
    const ry = this.size * (1 - this.ellipse * 0.85);
    const angle = (this.angleDeg * Math.PI) / 180;
    const fill = this.resolveFillColor();
    if (fill !== null) {
      this.renderer.fillEllipse(x, y, rx, ry, angle, fill, alpha);
    } else {
      // No fill selected → outline only.
      this.renderer.strokeEllipse(x, y, rx, ry, angle, { width: 1, alpha });
    }
  }

  getSettings(): BrushSetting[] {
    return this.persistSettings([
      {
        kind: "number",
        key: "size",
        label: "Size",
        min: 2,
        max: 60,
        step: 1,
        value: this.size,
        onChange: (v) => {
          this.size = v;
        },
      },
      {
        kind: "number",
        key: "ellipse",
        label: "Ellipse",
        min: 0,
        max: 1,
        step: 0.05,
        value: this.ellipse,
        onChange: (v) => {
          this.ellipse = v;
        },
      },
      {
        kind: "number",
        key: "angle",
        label: "Angle",
        min: 0,
        max: 180,
        step: 5,
        value: this.angleDeg,
        onChange: (v) => {
          this.angleDeg = v;
        },
      },
      {
        kind: "select",
        key: "fillMode",
        label: "Fill",
        options: ["none", "main", "secondary"] as const,
        value: this.fillMode,
        onChange: (v) => {
          this.fillMode = v as FillMode;
        },
      },
      ...this.gridSettings(),
    ]);
  }

  private resolveFillColor(): string | undefined | null {
    if (this.fillMode === "none") return null;
    if (this.fillMode === "main") return undefined; // renderer uses strokeStyle
    return this.store?.get<string>("app.color.secondary") ?? "#888888";
  }
}

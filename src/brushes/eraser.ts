import { BrushBase, type BrushSetting } from "../base";
import type { Pixel } from "../neighbor-finder";
import type { BrushContext } from "./registry";

// Menu glyph for the toolbar — the classic eraser block.
export const icon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M15 4 L20 9 L11 18 H6 V13 Z"/>' +
  '<path d="M9 18 H20"/>' +
  "</svg>";

export function create(c: BrushContext): EraserBrush {
  return new EraserBrush(c.host, undefined, c.store);
}

// The Eraser: a round-capped line painted in erase mode (destination-out), so it
// wipes the layer instead of drawing. It is a plain eraser - it attaches no
// connection, so there's no web/Connecting tab and no bloom; it just clears the
// area it passes over. Selecting it flips the renderer into erase mode (see
// LayerManager.setEraseMode, driven by erases() in main.ts).
//
// What an erase stroke removes is set by the "Erase" mode (default "both"):
//   both  - wipe paint AND forget the dots under it (default; the honest eraser)
//   paint - wipe paint only, keep the dots (advanced: keep the memory scaffold)
//   dots  - forget dots only, leave the paint (a "forget brush": rub out memory
//           without touching the art)
export type EraseMode = "both" | "paint" | "dots";

export class EraserBrush extends BrushBase {
  private lastX = 0;
  private lastY = 0;
  // Persisted via the standard brush store (brush.Eraser.eraseMode).
  private eraseMode: EraseMode = "both";

  name() {
    return "Eraser";
  }

  erases(): boolean {
    return true;
  }

  strokeStart(x: number, y: number): void {
    this.lastX = x;
    this.lastY = y;
  }

  protected onStroke(x: number, y: number, _current: Pixel): void {
    // Wipe the paint (unless "dots only"). penStyle: pressure can narrow the
    // eraser / soften the wipe (alpha in destination-out = partial erase).
    if (this.eraseMode !== "dots") {
      this.renderer.drawLine(
        { id: 0, x: this.lastX, y: this.lastY },
        { id: 0, x, y },
        { cap: "round", ...this.penStyle() },
      );
    }
    // Forget the dots under the stroke (unless "paint only") - the same area the
    // wipe covers. Sweep the whole segment so a fast stroke doesn't skip dots.
    if (this.eraseMode !== "paint") {
      const r = Math.max(this.host.strokeWidth() / 2, 3);
      const dx = x - this.lastX;
      const dy = y - this.lastY;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / r));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        this.host.forgetPointsNear(this.lastX + dx * t, this.lastY + dy * t, r);
      }
    }
    this.lastX = x;
    this.lastY = y;
  }

  getSettings(): BrushSetting[] {
    return [
      {
        kind: "select",
        key: "eraseMode",
        label: "Erase",
        section: "Eraser",
        options: ["both", "paint", "dots"],
        optionLabels: { both: "Paint + dots", paint: "Paint only", dots: "Dots only" },
        value: this.eraseMode,
        onChange: (v) => {
          this.eraseMode = v as EraseMode;
        },
      },
      ...super.getSettings(),
    ];
  }

  // Erase at full strength regardless of the global stroke opacity.
  getSelectOpacity(): number {
    return 1;
  }
}

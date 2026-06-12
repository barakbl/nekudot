import { BrushBase, type BrushSetting } from "../base";
import type { Pixel } from "../neighbor-finder";
import type { BrushContext } from "./registry";

const CHISEL_ANGLE = -Math.PI / 4;

export const icon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M16 3 L21 8 L10 19 L4 19 L4 13 Z"/>' +
  '<path d="M13 6 L18 11"/>' +
  '<path d="M4 13 L10 19"/>' +
  "</svg>";

export function create(c: BrushContext): MarkerBrush {
  return new MarkerBrush(c.host, undefined, c.store);
}

export class MarkerBrush extends BrushBase {
  private lastX = 0;
  private lastY = 0;

  name() {
    return "Marker";
  }

  strokeStart(x: number, y: number): void {
    this.lastX = x;
    this.lastY = y;
  }

  protected onStroke(x: number, y: number, _current: Pixel): void {
    // No per-stroke alpha: opacity comes from the global nav slider (globalAlpha).
    this.renderer.drawChisel(
      { id: 0, x: this.lastX, y: this.lastY },
      { id: 0, x, y },
      CHISEL_ANGLE,
    );
    this.lastX = x;
    this.lastY = y;
  }

  // The marker is a plain stroke — no connecting web (it attaches no preset). It
  // still deposits points into the cloud.

  // Selecting Marker sets the global opacity to the marker's former default (75%).
  getSelectOpacity(): number {
    return 0.75;
  }

  getSettings(): BrushSetting[] {
    return this.persistSettings([]);
  }
}

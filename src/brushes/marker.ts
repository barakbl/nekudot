import { BrushBase, PEN_SECTION, type BrushSetting } from "../base";
import type { Pixel } from "../neighbor-finder";
import type { BrushContext } from "./registry";

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
  // Orientation of the chisel nib's flat edge, in degrees (-90..90; the edge is
  // a line so it wraps every 180°). Strokes drawn along this angle come out as
  // thin hairlines, strokes across it at full width — a broad-edged calligraphy
  // pen. -45° matches the marker's original fixed nib.
  private nibAngleDeg = -45;
  // Chisel nib rotates with the pen's lean direction (azimuth) like a real
  // calligraphy marker; falls back to the fixed nib angle for mouse/vertical pen.
  private chiselFollowsPen = true;

  name() {
    return "Marker";
  }

  // The broad nib amplifies hand wobble into a rippling edge, so the Marker
  // opts into path streamlining (the "Streamline" dial below).
  protected streamlines(): boolean {
    return true;
  }

  strokeStart(x: number, y: number): void {
    this.lastX = x;
    this.lastY = y;
  }

  protected onStroke(x: number, y: number, _current: Pixel): void {
    const fixed = (this.nibAngleDeg * Math.PI) / 180;
    const angle = this.chiselFollowsPen ? (this.penAzimuth() ?? fixed) : fixed;
    // Base opacity comes from the global nav slider (globalAlpha); penStyle
    // only overrides width/alpha when a pen binding modulates them.
    this.renderer.drawChisel(
      { id: 0, x: this.lastX, y: this.lastY },
      { id: 0, x, y },
      angle,
      this.penStyle(),
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
    return [
      {
        kind: "number",
        key: "nibAngle",
        label: "Nib angle",
        min: -90,
        max: 90,
        step: 5,
        value: this.nibAngleDeg,
        onChange: (v) => (this.nibAngleDeg = v),
      },
      ...this.streamlineSettings(),
      ...this.penSettings(),
      {
        kind: "boolean",
        key: "penChisel",
        label: "Chisel follows pen",
        section: PEN_SECTION,
        value: this.chiselFollowsPen,
        onChange: (v) => (this.chiselFollowsPen = v),
      },
    ];
  }
}

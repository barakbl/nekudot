import {
  BrushBase,
  DASH_PATTERNS,
  DASH_STYLES,
  DASH_ICONS,
  type BrushSetting,
  type DashStyle,
} from "../base";
import type { Pixel } from "../neighbor-finder";
import type { PaintHost } from "../paint-host";
import type { PenSample } from "../pen";
import type { Store } from "../store/base";
import type { BrushContext } from "./registry";

// Menu glyph for the toolbar - the connecting web (the brush is shown as "Web").
export const icon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="2"/>' +
  '<path d="M12 2 V22 M2 12 H22 M5 5 L19 19 M19 5 L5 19"/>' +
  '<path d="M12 5 A7 7 0 0 1 19 12 M12 5 A7 7 0 0 0 5 12"/>' +
  "</svg>";

export function create(c: BrushContext): RoundBrush {
  return new RoundBrush(c.host, undefined, c.store);
}

// Art style applied when Round is first used / on selection. The art style is
// otherwise chosen from the navbar Connecting combo (persisted under app.artStyle).
// "shaded" (the Shaded style): dense distance-faded lines, no core line.
export const DEFAULT_ART_STYLE = "shaded";

// The Round brush: a continuous round-capped line plus the connecting web. It is
// the only connecting brush — the connection art style (classic, web, arc,
// shaded, fur, lace) is picked from the navbar Connecting combo, not baked into
// the brush.
export class RoundBrush extends BrushBase {
  private lastX = 0;
  private lastY = 0;
  private strokeDash: DashStyle = "solid";
  private accumDist = 0;

  constructor(host: PaintHost, seed?: number, store?: Store) {
    super(host, seed, store);
    // Round is a connecting brush: attach the default connection (the navbar
    // combo / onSelect swaps it via selectArtStyle).
    this.initConnection(DEFAULT_ART_STYLE);
    // Speed taper is available (the toggle) but OFF by default: the Web's core
    // line hides behind the web, so tapering it shows nothing until you raise
    // line opacity. Its real home is the Color Pen.
  }

  name() {
    return "Round";
  }

  // Round draws one continuous line per stroke → buffer it so a faint stroke
  // reads as uniform alpha instead of dotted at the sample joints. A pen with
  // an opacity binding draws unbuffered — the buffer would flatten exactly the
  // per-sample alpha variation the binding produces.
  bufferedStroke(pen?: PenSample): boolean {
    if (pen?.isPen && (this.penPressureAlpha || this.penTiltAlpha)) return false;
    return true;
  }

  strokeStart(x: number, y: number): void {
    this.lastX = x;
    this.lastY = y;
    this.accumDist = 0;
  }

  protected onStroke(x: number, y: number, _current: Pixel): void {
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    this.renderer.drawLine(
      { id: 0, x: this.lastX, y: this.lastY },
      { id: 0, x, y },
      {
        cap: "round",
        dash: DASH_PATTERNS[this.strokeDash],
        dashOffset: this.accumDist,
        ...this.penStyle(), // pressure/tilt width+alpha; empty for a mouse
      },
    );
    this.accumDist += Math.hypot(dx, dy);
    this.lastX = x;
    this.lastY = y;
  }

  protected strokeDashValue(): DashStyle {
    return this.strokeDash;
  }

  // Re-apply the last-chosen art style (persisted by main.ts) so the connecting
  // web matches the navbar Connecting combo whenever Round becomes active.
  onSelect(): void {
    this.selectArtStyle(
      this.store?.get<string>("app.artStyle") ?? DEFAULT_ART_STYLE,
    );
  }

  // Stroke-line opacity for the active connection style, matching its Harmony
  // counterpart (Sketchy 0.05, Web 0.5, Shaded 0 = no line). Falls back to
  // a faint 0.1 for styles that don't pin one. Keeps the line from burying the
  // connecting web; raise Opacity in Brush settings for a bolder line.
  getSelectOpacity(): number {
    return this.connection?.strokeOpacity() ?? 0.1;
  }

  getSettings(): BrushSetting[] {
    return [
      {
        kind: "select",
        key: "strokeDash",
        label: "Dash",
        options: DASH_STYLES,
        icons: DASH_ICONS,
        value: this.strokeDash,
        onChange: (v) => {
          this.strokeDash = v as DashStyle;
        },
      },
      ...this.speedTaperSettings(),
      ...(this.connection?.sliders() ?? []),
      ...this.penSettings(),
    ];
  }
}

import {
  BrushBase,
  DASH_PATTERNS,
  DASH_STYLES,
  DASH_ICONS,
  type BrushSetting,
  type DashStyle,
} from "../base";
import { COLOR_SOURCE_LABELS, colorSourceIcons } from "./color-source";
import { MOUSE_SAMPLE, type PenSample } from "../pen";
import type { Pixel } from "../neighbor-finder";
import type { BrushContext } from "./registry";

type FillMode = "none" | "main" | "secondary";
export type ShapeKind = "squares" | "circles";

export type ShapeDrawParams = {
  cx: number;
  cy: number;
  size: number;
  angle: number;
  fillColor: string | undefined | null;
  fillAlpha: number;
  dashPattern: readonly number[];
  // Pen-modulated outline opacity, or undefined to use the persistent
  // globalAlpha (always undefined for a mouse).
  strokeAlpha?: number;
};

// Stroke speed (px/ms) at which a shape reaches its Max size. Fixed, so the
// Max-size slider only raises the ceiling without changing responsiveness.
const REF_SPEED = 1.6;
const MAX_SIZE_LIMIT = 320; // upper bound of the Max-size slider

// Menu glyph: a square + a circle.
export const icon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
  '<rect x="3" y="3" width="11" height="11" rx="1.5"/>' +
  '<circle cx="15.5" cy="15.5" r="5.5"/>' +
  "</svg>";

export function create(c: BrushContext): ShapesBrush {
  return new ShapesBrush(c.host, undefined, c.store);
}

// One "Shapes" brush that stamps speed-sized squares OR circles along the
// stroke; the shape is a per-brush setting (the two-button toggle at the top of
// its settings). Owns the speed-driven sizing, fill, dash, and settings.
export class ShapesBrush extends BrushBase {
  private placedX = 0;
  private placedY = 0;
  private placedSize = 0;
  private placedT = 0;
  private placedTInit = false;
  private curTime: number | undefined;

  protected shape: ShapeKind = "squares";
  protected fillMode: FillMode = "none";
  protected fillOpacity = 100;
  protected strokeDash: DashStyle = "solid";
  protected minSize = 8;
  protected maxSize = 160;
  // 0 = linear speed→size; higher bends it convex (big shapes from gentler moves).
  protected sensitivity = 35;

  name() {
    return "Shapes";
  }

  strokeStart(x: number, y: number): void {
    this.placedX = x;
    this.placedY = y;
    this.placedSize = 0;
    this.placedT = performance.now(); // fallback; a recorded timestamp overrides it
    this.placedTInit = false;
    this.curTime = undefined;
  }

  // Size from the recorded sample time, not the wall clock, so replay (and any
  // display refresh rate) reproduces the same sizes.
  stroke(x: number, y: number, sample = true, pen: PenSample = MOUSE_SAMPLE, time?: number): void {
    if (time !== undefined) {
      this.curTime = time;
      if (!this.placedTInit) {
        this.placedT = time;
        this.placedTInit = true;
      }
    }
    super.stroke(x, y, sample, pen, time);
  }

  protected onStroke(x: number, y: number, _current: Pixel): void {
    const dx = x - this.placedX;
    const dy = y - this.placedY;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;

    const now = this.curTime ?? performance.now();
    const dt = Math.max(1, now - this.placedT);
    const speed = dist / dt;
    // Map speed → size through a gamma curve. t is the linear (0..1) position;
    // gamma goes from 1 (linear) toward 0.4 (convex) as sensitivity rises.
    // Pen pressure/tilt scale the speed-driven size (factor 1 for a mouse).
    const t = Math.min(1, speed / REF_SPEED);
    const gamma = 1 - (this.sensitivity / 100) * 0.6;
    const newSize =
      (this.minSize + (this.maxSize - this.minSize) * Math.pow(t, gamma)) *
      this.penWidthFactor();

    const step = this.placedSize / 2 + newSize / 2;
    if (dist < step) return;

    const ux = dx / dist;
    const uy = dy / dist;
    const cx = this.placedX + ux * step;
    const cy = this.placedY + uy * step;

    const alphaFactor = this.penAlphaFactor();
    this.drawAt({
      cx,
      cy,
      size: newSize,
      angle: Math.atan2(dy, dx),
      fillColor: this.resolveFillColor(),
      fillAlpha: (this.fillOpacity / 100) * alphaFactor,
      dashPattern: DASH_PATTERNS[this.strokeDash],
      strokeAlpha:
        alphaFactor === 1 ? undefined : this.host.strokeAlpha() * alphaFactor,
    });

    this.placedX = cx;
    this.placedY = cy;
    this.placedSize = newSize;
    this.placedT = now;
  }

  private drawAt(p: ShapeDrawParams): void {
    if (this.shape === "circles") {
      const r = p.size / 2;
      if (p.fillColor !== null) {
        this.renderer.fillCircle(p.cx, p.cy, r, p.fillColor, p.fillAlpha);
      }
      this.renderer.strokeCircle(p.cx, p.cy, r, {
        dash: p.dashPattern,
        alpha: p.strokeAlpha,
      });
      return;
    }
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
      { dash: p.dashPattern, alpha: p.strokeAlpha },
      p.angle,
    );
  }

  protected strokeDashValue(): DashStyle {
    return this.strokeDash;
  }

  // Shape strokes don't weave a connecting web (they attach no preset); they
  // still deposit points into the cloud.

  getSettings(): BrushSetting[] {
    return [
      {
        kind: "select",
        key: "shape",
        label: "Shape",
        segmented: true,
        options: ["circles", "squares"] as const,
        optionLabels: { circles: "Circles", squares: "Squares" },
        value: this.shape,
        onChange: (v) => {
          this.shape = v as ShapeKind;
        },
      },
      {
        kind: "number",
        key: "sensitivity",
        label: "Sensitivity",
        min: 0,
        max: 100,
        step: 1,
        unit: "%",
        value: this.sensitivity,
        onChange: (v) => {
          this.sensitivity = v;
        },
      },
      {
        // One two-handle slider: the low handle is the min size (slow strokes),
        // the high handle is the max size (fast strokes).
        kind: "range",
        key: "size",
        label: "Shape size",
        min: 1,
        max: MAX_SIZE_LIMIT,
        step: 1,
        value: [this.minSize, this.maxSize],
        onChange: (lo, hi) => {
          this.minSize = lo;
          this.maxSize = hi;
        },
      },
      {
        kind: "select",
        key: "fillMode",
        label: "Fill",
        options: ["none", "main", "secondary"] as const,
        optionLabels: COLOR_SOURCE_LABELS,
        icons: colorSourceIcons(this.store),
        value: this.fillMode,
        onChange: (v) => {
          this.fillMode = v as FillMode;
        },
      },
      {
        kind: "number",
        key: "fillOpacity",
        label: "Fill opacity",
        min: 10,
        max: 100,
        step: 1,
        unit: "%",
        // No fill is painted when Fill is None, so hide its opacity then.
        visibleWhen: { key: "fillMode", when: (v) => v !== "none" },
        value: this.fillOpacity,
        onChange: (v) => {
          this.fillOpacity = v;
        },
      },
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
      ...this.penSettings(),
    ];
  }

  private resolveFillColor(): string | undefined | null {
    if (this.fillMode === "none") return null;
    if (this.fillMode === "main") return undefined; // renderer uses strokeStyle
    return this.frozenSecondary();
  }
}

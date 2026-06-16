import {
  BrushBase,
  DASH_PATTERNS,
  DASH_STYLES,
  DASH_ICONS,
  type BrushSetting,
  type DashStyle,
} from "../base";
import { COLOR_SOURCE_LABELS, colorSourceIcons } from "../color-source";
import type { Pixel } from "../neighbor-finder";

type FillMode = "none" | "main" | "secondary";

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

// Shared base for stroke-shape brushes (Squares, Circles). Owns the
// speed-driven sizing, fill, dash, and settings; subclasses only paint.
export abstract class ShapesStrokeBrush extends BrushBase {
  private placedX = 0;
  private placedY = 0;
  private placedSize = 0;
  private placedT = 0;

  protected fillMode: FillMode = "none";
  protected fillOpacity = 100;
  protected strokeDash: DashStyle = "solid";
  protected minSize = 8;
  protected maxSize = 160;
  // 0 = linear speed→size; higher bends it convex (big shapes from gentler moves).
  protected sensitivity = 35;

  strokeStart(x: number, y: number): void {
    this.placedX = x;
    this.placedY = y;
    this.placedSize = 0;
    this.placedT = performance.now();
  }

  protected onStroke(x: number, y: number, _current: Pixel): void {
    const dx = x - this.placedX;
    const dy = y - this.placedY;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;

    const now = performance.now();
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

  protected abstract drawAt(params: ShapeDrawParams): void;

  protected strokeDashValue(): DashStyle {
    return this.strokeDash;
  }

  // Shape strokes don't weave a connecting web (they attach no preset); they
  // still deposit points into the cloud.

  getSettings(): BrushSetting[] {
    return [
      {
        kind: "number",
        key: "sensitivity",
        label: "Sensitivity",
        min: 0,
        max: 100,
        step: 1,
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
    return this.store?.get<string>("app.color.secondary") ?? "#888888";
  }
}

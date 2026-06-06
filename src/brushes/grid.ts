import { BrushBase, type BrushSetting } from "../base";

export type GridSpec = {
  xSpacing: number;
  ySpacing: number;
};

// Abstract base for grid-tap brushes (Dots, Water drops).
// One click = one tap. The tap paints every grid intersection inside
// `reach`, with alpha falling off smoothly to zero at the radius edge.
// These brushes do not interact with the neighbors finder.
export abstract class GridBrush extends BrushBase {
  protected xSpacing = 40;
  protected ySpacing = 40;
  protected reach = 100;
  // Tap strength = max alpha bumped at the closest intersection per click
  // (0..1). Stored as a 1..100 number for the UI.
  protected tapStrengthPct = 50;
  // How sharply alpha fades toward the reach edge: 0 = flat (every
  // intersection at full strength), 100 = steep falloff.
  protected falloffPct = 100;

  private tappedForCurrentStroke = false;
  private settingsListeners = new Set<() => void>();

  subscribeSettings(fn: () => void): () => void {
    this.settingsListeners.add(fn);
    return () => this.settingsListeners.delete(fn);
  }

  getGridSpec(): GridSpec {
    return { xSpacing: this.xSpacing, ySpacing: this.ySpacing };
  }

  strokeStart(_x: number, _y: number): void {
    this.tappedForCurrentStroke = false;
  }

  // Drop the per-pixel template from BrushBase — we want one tap per
  // pointerdown and we don't push anything to the finder.
  stroke(x: number, y: number): void {
    if (this.tappedForCurrentStroke) return;
    this.tappedForCurrentStroke = true;
    this.tap(x, y);
  }

  private tap(x: number, y: number): void {
    const r = this.reach;
    const sx = this.xSpacing;
    const sy = this.ySpacing;
    if (sx <= 0 || sy <= 0 || r <= 0) return;

    const maxAlpha = this.tapStrengthPct / 100;
    // 0 → flat (exponent 0, every point at maxAlpha); 100 → steep (t^2.5).
    const power = (this.falloffPct / 100) * 2.5;

    const x0 = Math.ceil((x - r) / sx) * sx;
    const x1 = x + r;
    const y0 = Math.ceil((y - r) / sy) * sy;
    const y1 = y + r;

    for (let iy = y0; iy <= y1; iy += sy) {
      if (iy < 0) continue;
      for (let ix = x0; ix <= x1; ix += sx) {
        if (ix < 0) continue;
        const dx = ix - x;
        const dy = iy - y;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const t = 1 - d / r;
        const alpha = maxAlpha * Math.pow(t, power);
        if (alpha <= 0) continue;
        this.paintAt(ix, iy, alpha);
      }
    }
  }

  protected abstract paintAt(x: number, y: number, alpha: number): void;

  protected gridSettings(): BrushSetting[] {
    const emit = () => {
      for (const fn of this.settingsListeners) fn();
    };
    return [
      {
        kind: "number",
        key: "xSpacing",
        label: "X spacing",
        min: 10,
        max: 200,
        step: 1,
        value: this.xSpacing,
        onChange: (v) => {
          this.xSpacing = v;
          emit();
        },
      },
      {
        kind: "number",
        key: "ySpacing",
        label: "Y spacing",
        min: 10,
        max: 200,
        step: 1,
        value: this.ySpacing,
        onChange: (v) => {
          this.ySpacing = v;
          emit();
        },
      },
      {
        kind: "number",
        key: "reach",
        label: "Reach",
        min: 20,
        max: 500,
        step: 1,
        value: this.reach,
        onChange: (v) => {
          this.reach = v;
        },
      },
      {
        kind: "number",
        key: "tapStrength",
        label: "Tap strength",
        min: 1,
        max: 100,
        step: 1,
        value: this.tapStrengthPct,
        onChange: (v) => {
          this.tapStrengthPct = v;
        },
      },
      {
        kind: "number",
        key: "falloff",
        label: "Opacity falloff",
        min: 0,
        max: 100,
        step: 1,
        value: this.falloffPct,
        onChange: (v) => {
          this.falloffPct = v;
        },
      },
    ];
  }
}

import { RoundBrush } from "./round";
import type { IRenderer, LineStyle, LineConnectType } from "../renderer";
import type { Pixel } from "../neighbor-finder";
import type { BrushSetting } from "../base";
import type { GridSpec } from "./grid";
import type { BrushContext } from "./registry";

const PATTERN_SECTION = "Pattern grid";

// Four small hand-drawn marks in a 2×2 — a motif tiled across the grid.
export const icon =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M2 5 q1.5 -2.5 3 0 t3 0"/>' +
  '<path d="M2 11 q1.5 -2.5 3 0 t3 0"/>' +
  '<path d="M10 4 a2 2 0 1 0 0.01 0"/>' +
  '<path d="M12 12 a2 2 0 1 0 0.01 0"/>' +
  "</svg>";

export function create(c: BrushContext): HandfreeBrush {
  return new HandfreeBrush(c.renderer, c.finder, undefined, c.store);
}

type Target = { dx: number; dy: number; aMul: number };

// Wraps the real renderer so every line / connection the brush draws is replayed
// at a set of grid-junction offsets (a faithful copy), each faded by `aMul`.
// Only the *drawing* is tiled — the brush still deposits points and searches
// neighbours at the master coordinates, so the connecting web is computed once
// and its lines are simply copied to each junction (cheap + faithful).
class TiledRenderer implements IRenderer {
  constructor(
    private base: IRenderer,
    private targets: Target[],
    private baseOpacity: number,
  ) {}

  private rep(
    draw: (p1: Pixel, p2: Pixel, style: LineStyle, kind?: LineConnectType) => void,
    p1: Pixel,
    p2: Pixel,
    style?: LineStyle,
    kind?: LineConnectType,
  ): void {
    const a = style?.alpha ?? this.baseOpacity;
    for (const t of this.targets) {
      draw(
        { id: p1.id, x: p1.x + t.dx, y: p1.y + t.dy },
        { id: p2.id, x: p2.x + t.dx, y: p2.y + t.dy },
        { ...style, alpha: a * t.aMul },
        kind,
      );
    }
  }

  drawLine(p1: Pixel, p2: Pixel, style?: LineStyle, kind?: LineConnectType): void {
    this.rep((a, b, s, k) => this.base.drawLine(a, b, s, k), p1, p2, style, kind);
  }
  drawConnection(p1: Pixel, p2: Pixel, style?: LineStyle, kind?: LineConnectType): void {
    this.rep((a, b, s, k) => this.base.drawConnection(a, b, s, k), p1, p2, style, kind);
  }

  // Everything else just forwards to the wrapped renderer (unused mid-stroke,
  // present so this is a complete IRenderer).
  moveTo(x: number, y: number): void { this.base.moveTo(x, y); }
  lineTo(x: number, y: number): void { this.base.lineTo(x, y); }
  arc(x: number, y: number, r: number, a?: number, b?: number): void { this.base.arc(x, y, r, a, b); }
  stroke(): void { this.base.stroke(); }
  drawChisel(p1: Pixel, p2: Pixel, angle: number, style?: LineStyle): void { this.base.drawChisel(p1, p2, angle, style); }
  strokeRect(x: number, y: number, w: number, h: number, style?: LineStyle, angle?: number): void { this.base.strokeRect(x, y, w, h, style, angle); }
  strokeCircle(x: number, y: number, r: number, style?: LineStyle): void { this.base.strokeCircle(x, y, r, style); }
  fillEllipse(x: number, y: number, rx: number, ry: number, angle: number, color?: string, alpha?: number): void { this.base.fillEllipse(x, y, rx, ry, angle, color, alpha); }
  strokeEllipse(x: number, y: number, rx: number, ry: number, angle: number, style?: LineStyle): void { this.base.strokeEllipse(x, y, rx, ry, angle, style); }
  fillRect(x: number, y: number, w: number, h: number, color?: string, angle?: number, alpha?: number): void { this.base.fillRect(x, y, w, h, color, angle, alpha); }
  fillCircle(x: number, y: number, r: number, color?: string, alpha?: number): void { this.base.fillCircle(x, y, r, color, alpha); }
  clear(): void { this.base.clear(); }
  setLineWidth(w: number): void { this.base.setLineWidth(w); }
  setStrokeStyle(c: string): void { this.base.setStrokeStyle(c); }
  setGlobalAlpha(a: number): void { this.base.setGlobalAlpha(a); }
  setEraseMode(on: boolean): void { this.base.setEraseMode(on); }
  fillBackground(c: string): void { this.base.fillBackground(c); }
  drawSource(o: IRenderer, opacity?: number, scale?: number): void { this.base.drawSource(o, opacity, scale); }
  drawBitmap(b: CanvasImageSource): void { this.base.drawBitmap(b); }
  toBlob(type?: string): Promise<Blob | null> { return this.base.toBlob(type); }
}

// Handfree: a freehand round-with-connections brush whose every mark is mirrored
// across a grid. Draw a motif near one junction and it appears (faithfully
// copied) at every junction within Reach, fading out at the edge — so a dot at a
// junction becomes the Dots pattern, and richer strokes tile into wallpaper.
export class HandfreeBrush extends RoundBrush {
  private xSpacing = 40;
  private ySpacing = 40;
  private reach = 140;
  // How sharply copies fade toward the Reach edge (0 = flat, 100 = steep).
  private falloffPct = 70;
  private real: IRenderer | null = null;
  private settingsListeners = new Set<() => void>();

  name() {
    return "Handfree";
  }

  // Handfree swaps in a tiling renderer mid-stroke, so the layer-level wet buffer
  // doesn't apply cleanly — keep its existing direct-draw path.
  bufferedStroke(): boolean {
    return false;
  }

  // Used by the grid overlay (same surface as the GridBrush family).
  getGridSpec(): GridSpec {
    return { xSpacing: this.xSpacing, ySpacing: this.ySpacing };
  }
  subscribeSettings(fn: () => void): () => void {
    this.settingsListeners.add(fn);
    return () => this.settingsListeners.delete(fn);
  }

  strokeStart(x: number, y: number): void {
    // Swap in a tiling renderer for this stroke; the motif is anchored to the
    // junction nearest the start, so the whole drawing copies to each junction.
    const targets = this.computeTargets(x, y);
    const opacity = this.store?.get<number>("app.opacity") ?? 1;
    this.real = this.renderer;
    this.renderer = new TiledRenderer(this.real, targets, opacity);
    super.strokeStart(x, y);
  }

  strokeEnd(): void {
    super.strokeEnd();
    if (this.real) {
      this.renderer = this.real;
      this.real = null;
    }
  }

  private computeTargets(x: number, y: number): Target[] {
    const sx = this.xSpacing,
      sy = this.ySpacing,
      r = this.reach;
    if (sx <= 0 || sy <= 0 || r <= 0) return [{ dx: 0, dy: 0, aMul: 1 }];
    const rx = Math.round(x / sx) * sx; // anchor = nearest junction to the start
    const ry = Math.round(y / sy) * sy;
    const power = (this.falloffPct / 100) * 2.5;
    const spanX = Math.ceil(r / sx) * sx;
    const spanY = Math.ceil(r / sy) * sy;
    const out: Target[] = [];
    for (let jy = ry - spanY; jy <= ry + spanY; jy += sy) {
      for (let jx = rx - spanX; jx <= rx + spanX; jx += sx) {
        const d = Math.hypot(jx - rx, jy - ry);
        if (d > r) continue;
        const aMul = Math.pow(1 - d / r, power); // 1 at the anchor, 0 at the edge
        if (aMul <= 0) continue;
        out.push({ dx: jx - rx, dy: jy - ry, aMul });
      }
    }
    return out.length ? out : [{ dx: 0, dy: 0, aMul: 1 }];
  }

  private patternSetting(
    key: string,
    label: string,
    min: number,
    max: number,
    value: number,
    set: (v: number) => void,
    emitOverlay = false,
  ): BrushSetting {
    return {
      kind: "number",
      key,
      label,
      section: PATTERN_SECTION,
      min,
      max,
      step: 1,
      value,
      onChange: (v) => {
        set(v);
        if (emitOverlay) for (const fn of this.settingsListeners) fn();
      },
    };
  }

  getSettings(): BrushSetting[] {
    // Pattern-grid dials live in the Brush box (own section); Dash + the
    // connecting art-style dials come from RoundBrush (already persist-wrapped).
    return [
      ...this.persistSettings([
        this.patternSetting("xSpacing", "X spacing", 10, 200, this.xSpacing, (v) => (this.xSpacing = v), true),
        this.patternSetting("ySpacing", "Y spacing", 10, 200, this.ySpacing, (v) => (this.ySpacing = v), true),
        this.patternSetting("reach", "Reach", 20, 800, this.reach, (v) => (this.reach = v)),
        this.patternSetting("falloff", "Opacity falloff", 0, 100, this.falloffPct, (v) => (this.falloffPct = v)),
      ]),
      ...super.getSettings(),
    ];
  }
}

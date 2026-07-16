import {
  CanvasRenderer,
  type DeviceRect,
  type IRenderer,
  type LineConnectType,
  type LineStyle,
  type RendererInit,
} from "../renderer";
import type { Pixel } from "../neighbor-finder";
import {
  chiselBounds,
  circleBounds,
  ellipseBounds,
  imageRectBounds,
  lineBounds,
  type Rect,
  rectBounds,
} from "./dirty-bounds";

// Dirty region accumulated for one layer since the last take(). `all` is the
// fail-closed sentinel: a whole-canvas op poisons the set to "everything".
export type DirtySet = { all: boolean; rects: Rect[] };

// Past this many pending rects, collapse to their bounding rect - bounds memory
// for a pathological stroke (a long symmetric Wisp bake) while staying a superset.
const RECT_CAP = 4096;

export class DirtyTracker {
  private rects: Rect[] = [];
  private all = false;
  // Reentrant suppression: while > 0, marks are dropped so a known restore
  // repaint doesn't poison the next capture. (No consumer wires this yet.)
  private suppressed = 0;

  markRect(r: Rect): void {
    if (this.suppressed > 0 || this.all) return;
    this.rects.push(r);
    if (this.rects.length > RECT_CAP) this.coalesce();
  }

  markAll(): void {
    if (this.suppressed > 0) return;
    this.all = true;
    this.rects = [];
  }

  // Non-destructive read (to union a source set, and for tests).
  peek(): DirtySet {
    return { all: this.all, rects: this.rects.slice() };
  }

  // Read and reset - the atomic cut a capture takes at push time.
  take(): DirtySet {
    const set = { all: this.all, rects: this.rects };
    this.rects = [];
    this.all = false;
    return set;
  }

  silently<T>(fn: () => T): T {
    this.suppressed++;
    try {
      return fn();
    } finally {
      this.suppressed--;
    }
  }

  private coalesce(): void {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const r of this.rects) {
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.w > maxX) maxX = r.x + r.w;
      if (r.y + r.h > maxY) maxY = r.y + r.h;
    }
    this.rects = [{ x: minX, y: minY, w: maxX - minX, h: maxY - minY }];
  }
}

// Records each mark's dirty region into a DirtyTracker, then forwards the draw
// to the base unchanged. A SUBCLASS (not a proxy) so it still passes drawSource's
// `instanceof CanvasRenderer` check. Sits at the layer sink + wet buffer,
// downstream of the symmetry proxy, so replicas/web strands/scatter are all
// captured with zero brush knowledge. Record-only; nothing consumes it yet.
export class TrackingRenderer extends CanvasRenderer {
  readonly tracker = new DirtyTracker();
  // Mirrors the ctx's persistent line width (private in the base): only
  // setLineWidth + the constructor change it (per-call LineStyle widths are
  // save/restore-scoped). Used to bound a draw that omits an explicit style.width.
  private trackedWidth: number;

  constructor(ctx: CanvasRenderingContext2D, init: RendererInit = {}) {
    super(ctx, init);
    this.trackedWidth = init.lineWidth ?? 1;
  }

  private effectiveWidth(style?: LineStyle): number {
    return style?.width ?? this.trackedWidth;
  }

  setLineWidth(w: number): void {
    this.trackedWidth = w;
    super.setLineWidth(w);
  }

  // ---- bounded draws: mark the region, then draw unchanged -------------------

  drawLine(
    p1: Pixel,
    p2: Pixel,
    style?: LineStyle,
    kind: LineConnectType = "line",
  ): void {
    this.tracker.markRect(
      lineBounds(p1, p2, kind, this.effectiveWidth(style), style?.curve),
    );
    super.drawLine(p1, p2, style, kind);
  }

  drawConnection(
    p1: Pixel,
    p2: Pixel,
    style?: LineStyle,
    kind: LineConnectType = "line",
  ): void {
    // Base drawConnection aliases drawLine, so the overridden drawLine records
    // the bound once - this override just keeps it in the coverage fence.
    super.drawConnection(p1, p2, style, kind);
  }

  drawChisel(p1: Pixel, p2: Pixel, angle: number, style?: LineStyle): void {
    this.tracker.markRect(
      chiselBounds(p1, p2, angle, this.effectiveWidth(style)),
    );
    super.drawChisel(p1, p2, angle, style);
  }

  strokeRect(
    x: number,
    y: number,
    w: number,
    h: number,
    style?: LineStyle,
    angle?: number,
  ): void {
    this.tracker.markRect(rectBounds(x, y, w, h, angle, this.effectiveWidth(style)));
    super.strokeRect(x, y, w, h, style, angle);
  }

  fillRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color?: string,
    angle?: number,
    alpha?: number,
  ): void {
    this.tracker.markRect(rectBounds(x, y, w, h, angle, 0));
    super.fillRect(x, y, w, h, color, angle, alpha);
  }

  strokeCircle(x: number, y: number, radius: number, style?: LineStyle): void {
    this.tracker.markRect(circleBounds(x, y, radius, this.effectiveWidth(style)));
    super.strokeCircle(x, y, radius, style);
  }

  fillCircle(
    x: number,
    y: number,
    radius: number,
    color?: string,
    alpha?: number,
  ): void {
    this.tracker.markRect(circleBounds(x, y, radius, 0));
    super.fillCircle(x, y, radius, color, alpha);
  }

  strokeEllipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    angle: number,
    style?: LineStyle,
  ): void {
    this.tracker.markRect(ellipseBounds(x, y, rx, ry, this.effectiveWidth(style)));
    super.strokeEllipse(x, y, rx, ry, angle, style);
  }

  fillEllipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    angle: number,
    color?: string,
    alpha?: number,
  ): void {
    this.tracker.markRect(ellipseBounds(x, y, rx, ry, 0));
    super.fillEllipse(x, y, rx, ry, angle, color, alpha);
  }

  drawImageRect(
    img: CanvasImageSource,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    this.tracker.markRect(imageRectBounds(x, y, w, h));
    super.drawImageRect(img, x, y, w, h);
  }

  // ---- full-canvas / fail-closed --------------------------------------------

  drawSource(other: IRenderer, opacity?: number, scale?: number): void {
    // The wet-stroke commit composites another TrackingRenderer here at scale 1
    // in matching coords: union its set so faint strokes stay tightly tracked.
    // A foreign source or scaled blit can't be mapped, so mark the whole layer.
    if (other instanceof TrackingRenderer && (scale ?? 1) === 1) {
      const set = other.tracker.peek();
      if (set.all) this.tracker.markAll();
      else for (const r of set.rects) this.tracker.markRect(r);
    } else {
      this.tracker.markAll();
    }
    super.drawSource(other, opacity, scale);
  }

  drawBitmap(bitmap: CanvasImageSource): void {
    this.tracker.markAll();
    super.drawBitmap(bitmap);
  }

  fillBackground(color: string): void {
    this.tracker.markAll();
    super.fillBackground(color);
  }

  clear(): void {
    this.tracker.markAll();
    super.clear();
  }

  stroke(): void {
    // Raw path of unknown extent (no brush draws marks this way today); fail closed.
    this.tracker.markAll();
    super.stroke();
  }

  blitPatch(bmp: CanvasImageSource, dest: DeviceRect): void {
    // Restore blit; callers run it inside tracker.silently(), so this markAll is
    // suppressed there. Fail closed if it ever runs live.
    this.tracker.markAll();
    super.blitPatch(bmp, dest);
  }
}

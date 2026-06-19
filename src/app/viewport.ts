import type { CanvasSize } from "../canvas-size";

// A 2D camera over the drawing stage: pan + zoom + rotate as one matrix that
// maps canvas-local pixels -> screen (viewport-container) pixels. The stage's
// CSS transform IS this matrix (transform-origin 0 0); pointer input is mapped
// back through its inverse, so drawing stays correct under any view. This is
// also what makes an over-sized canvas usable (fit-to-screen).
export type ViewportOpts = {
  viewportEl: HTMLElement; // fixed full-window container; its top-left is the screen origin
  stageEl: HTMLElement; // the transformed drawing stage
  getCanvasSize: () => CanvasSize;
  onChange?: () => void; // after any view change (e.g. refresh the zoom % label)
};

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

// Where to place a canvas inside the viewport: a uniform scale plus the screen
// translation of the canvas's top-left corner (no rotation). Pure geometry, so
// the framing is unit-testable without a DOM / DOMMatrix.
export type Placement = { scale: number; tx: number; ty: number };

// Centre the canvas and scale it to fill the viewport, leaving `margin` px of
// padding on every side (scale clamped to [MIN_SCALE, MAX_SCALE]).
export function fitPlacement(
  viewW: number,
  viewH: number,
  canvasW: number,
  canvasH: number,
  margin: number,
): Placement {
  const raw = Math.min(
    (viewW - margin * 2) / canvasW,
    (viewH - margin * 2) / canvasH,
  );
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
  return {
    scale,
    tx: (viewW - canvasW * scale) / 2,
    ty: (viewH - canvasH * scale) / 2,
  };
}

// The "Reset view" framing: 100% and centred, or fit (margin 0) when the canvas
// is bigger than the viewport at 100% so it stays fully reachable. Depends only
// on the current viewport + canvas size, never the previous view - so opening a
// canvas of size X always frames the same way, whatever size came before.
export function resetPlacement(
  viewW: number,
  viewH: number,
  canvasW: number,
  canvasH: number,
): Placement {
  if (canvasW <= viewW && canvasH <= viewH) {
    return { scale: 1, tx: (viewW - canvasW) / 2, ty: (viewH - canvasH) / 2 };
  }
  return fitPlacement(viewW, viewH, canvasW, canvasH, 0);
}

export class Viewport {
  private m = new DOMMatrix(); // canvas -> screen
  // Last viewport size we centred/laid out against, so a window resize can shift
  // the view by half the size delta (keeping a centred canvas centred).
  private viewW = 0;
  private viewH = 0;

  constructor(private opts: ViewportOpts) {}

  // Current uniform scale and rotation read off the matrix.
  get scale(): number {
    return Math.hypot(this.m.a, this.m.b);
  }
  get rotation(): number {
    return Math.atan2(this.m.b, this.m.a);
  }

  // Screen (client) coords -> canvas-local coords. The one place pointer input
  // becomes a drawing position.
  toCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.opts.viewportEl.getBoundingClientRect();
    const p = new DOMPoint(clientX - r.left, clientY - r.top).matrixTransform(
      this.m.inverse(),
    );
    return { x: p.x, y: p.y };
  }

  private apply(): void {
    this.opts.stageEl.style.transformOrigin = "0 0";
    this.opts.stageEl.style.transform = this.m.toString();
    this.opts.onChange?.();
  }

  // Zoom by `factor` about a screen point (that point stays put). Clamped.
  zoomAt(clientX: number, clientY: number, factor: number): void {
    const target = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    const f = target / this.scale;
    if (Math.abs(f - 1) < 1e-4) return;
    const r = this.opts.viewportEl.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    const t = new DOMMatrix().translate(px, py).scale(f).translate(-px, -py);
    this.m = t.multiply(this.m);
    this.apply();
  }

  panBy(dx: number, dy: number): void {
    this.m = new DOMMatrix().translate(dx, dy).multiply(this.m);
    this.apply();
  }

  // Rotate by `rad` about a screen point.
  rotateBy(rad: number, clientX: number, clientY: number): void {
    const r = this.opts.viewportEl.getBoundingClientRect();
    const px = clientX - r.left;
    const py = clientY - r.top;
    const t = new DOMMatrix()
      .translate(px, py)
      .rotate((rad * 180) / Math.PI)
      .translate(-px, -py);
    this.m = t.multiply(this.m);
    this.apply();
  }

  // Set absolute zoom % about the viewport centre (toolbar +/- buttons).
  zoomTo(scale: number): void {
    const r = this.opts.viewportEl.getBoundingClientRect();
    this.zoomAt(r.left + r.width / 2, r.top + r.height / 2, scale / this.scale);
  }

  // Build the camera matrix from a Placement (scale about, then translate, the
  // canvas's top-left) and record the viewport size we laid out against.
  private place(viewW: number, viewH: number, p: Placement): void {
    this.viewW = viewW;
    this.viewH = viewH;
    this.m = new DOMMatrix().translate(p.tx, p.ty).scale(p.scale);
    this.apply();
  }

  // Centre the canvas and scale it to fill the viewport (no rotation).
  fit(margin = 24): void {
    const r = this.opts.viewportEl.getBoundingClientRect();
    const cs = this.opts.getCanvasSize();
    this.place(r.width, r.height, fitPlacement(r.width, r.height, cs.width, cs.height, margin));
  }

  // 100% and centred (or fit when it doesn't fit at 100%).
  reset(): void {
    const r = this.opts.viewportEl.getBoundingClientRect();
    const cs = this.opts.getCanvasSize();
    this.place(r.width, r.height, resetPlacement(r.width, r.height, cs.width, cs.height));
  }

  // Window resized: shift the view by half the size delta so a centred canvas
  // stays centred (and a panned/zoomed one keeps the same point under the
  // viewport centre, instead of drifting toward a corner), then refit if the
  // canvas now overflows. Replaces a bare fitIfOverflowing(), which left the
  // canvas pinned to its old offset whenever it still fit.
  onResize(): void {
    const r = this.opts.viewportEl.getBoundingClientRect();
    const dw = r.width - this.viewW;
    const dh = r.height - this.viewH;
    this.viewW = r.width;
    this.viewH = r.height;
    if (dw !== 0 || dh !== 0) {
      this.m = new DOMMatrix().translate(dw / 2, dh / 2).multiply(this.m);
      this.apply();
    }
    this.fitIfOverflowing();
  }

  // Issue #3: when the canvas (at the current scale) overflows the viewport -
  // e.g. after shrinking the window - fit it so it stays reachable. No-op if it
  // already fits, so a deliberate zoom-in is preserved.
  fitIfOverflowing(): void {
    const r = this.opts.viewportEl.getBoundingClientRect();
    const cs = this.opts.getCanvasSize();
    if (cs.width * this.scale > r.width || cs.height * this.scale > r.height) {
      this.fit(0);
    }
  }
}

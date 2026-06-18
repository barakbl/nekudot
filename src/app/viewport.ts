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

  // Centre the canvas and scale it to fill the viewport (no rotation).
  fit(margin = 24): void {
    const r = this.opts.viewportEl.getBoundingClientRect();
    this.viewW = r.width;
    this.viewH = r.height;
    const cs = this.opts.getCanvasSize();
    const raw = Math.min(
      (r.width - margin * 2) / cs.width,
      (r.height - margin * 2) / cs.height,
    );
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
    this.m = new DOMMatrix()
      .translate((r.width - cs.width * scale) / 2, (r.height - cs.height * scale) / 2)
      .scale(scale);
    this.apply();
  }

  // 100% and centred (or fit when it doesn't fit at 100%).
  reset(): void {
    const r = this.opts.viewportEl.getBoundingClientRect();
    this.viewW = r.width;
    this.viewH = r.height;
    const cs = this.opts.getCanvasSize();
    if (cs.width <= r.width && cs.height <= r.height) {
      this.m = new DOMMatrix().translate(
        (r.width - cs.width) / 2,
        (r.height - cs.height) / 2,
      );
      this.apply();
    } else {
      this.fit(0);
    }
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

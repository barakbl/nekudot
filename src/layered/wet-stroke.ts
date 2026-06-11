import { CanvasRenderer } from "../renderer";
import type { IRenderer, RendererInit } from "../renderer";
import type { CanvasSize } from "../canvas-size";

// Per-stroke "wet" buffer for continuous strokes. While a partly-transparent
// line is in progress, the stroke targets this opaque off-buffer (shown live
// at the stroke opacity) and end() composites it onto the layer in one pass —
// so the stroke reads as one uniform alpha instead of darker dots where each
// segment's round caps overlap at the joints. The canvas is lazily created and
// reused across strokes.
export class WetStrokeBuffer {
  private canvas: HTMLCanvasElement | null = null;
  private renderer: CanvasRenderer | null = null;
  private active = false;
  private alpha = 1;

  constructor(
    private readonly container: HTMLElement,
    private readonly dpr: number,
  ) {}

  // The renderer strokes should draw into while a buffer is open, else null.
  get target(): IRenderer | null {
    return this.active ? this.renderer : null;
  }

  // Open the buffer for a stroke. Only engages for a partly-transparent,
  // non-erasing stroke — opaque draws are already uniform, erasing paints
  // straight through. Safe no-op outside that case.
  begin(size: CanvasSize, init: RendererInit, zIndex: number): void {
    this.active = false;
    const alpha = init.globalAlpha ?? 1;
    if (init.eraseMode || alpha <= 0 || alpha >= 1) return;
    if (!this.canvas) {
      const c = document.createElement("canvas");
      c.style.position = "absolute";
      c.style.left = "0";
      c.style.top = "0";
      c.style.pointerEvents = "none";
      this.container.appendChild(c);
      this.canvas = c;
    }
    const c = this.canvas;
    c.width = Math.round(size.width * this.dpr);
    c.height = Math.round(size.height * this.dpr);
    c.style.width = `${size.width}px`;
    c.style.height = `${size.height}px`;
    c.style.zIndex = String(zIndex); // sit on the active layer
    c.style.opacity = String(alpha); // live preview at the stroke's own opacity
    const ctx = c.getContext("2d");
    if (!ctx) return;
    // Resizing the canvas reset its context; rebuild a renderer that mirrors the
    // active stroke style but paints opaque (opacity is applied once on commit).
    this.renderer = new CanvasRenderer(ctx, {
      ...init,
      dpr: this.dpr,
      globalAlpha: 1,
      eraseMode: false,
    });
    this.alpha = alpha;
    this.active = true;
  }

  // Commit the buffered stroke: composite the opaque buffer onto `layer` at
  // the stroke opacity (one pass → uniform), then clear and hide the buffer.
  end(layer: IRenderer): void {
    if (!this.active || !this.renderer || !this.canvas) {
      this.active = false;
      return;
    }
    layer.drawSource(this.renderer, this.alpha);
    const ctx = this.canvas.getContext("2d");
    ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.canvas.style.opacity = "0";
    this.active = false;
  }
}

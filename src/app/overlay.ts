import { CanvasRenderer, type IRenderer } from "../renderer";
import { sizeCanvasForDpr, type CanvasSize } from "../canvas-size";

// A pointer-transparent canvas stacked over the layer canvases for transient
// visuals (the invisible-brush glow, the symmetry guides). Owns the renderer
// rebuild a resize forces: writing canvas.width resets the ctx transform, so
// the dpr scale set in CanvasRenderer's constructor needs reapplying.
export class Overlay {
  readonly el: HTMLCanvasElement;
  private liveRenderer: IRenderer;
  private cssSize: CanvasSize;

  constructor(
    parent: HTMLElement,
    private readonly dpr: number,
    zIndex: number,
    size: CanvasSize,
    opts?: { hidden?: boolean },
  ) {
    this.el = document.createElement("canvas");
    this.el.style.position = "absolute";
    this.el.style.left = "0";
    this.el.style.top = "0";
    this.el.style.pointerEvents = "none";
    this.el.style.zIndex = String(zIndex);
    if (opts?.hidden) this.el.style.display = "none";
    // Direct assignment so TypeScript sees both fields as definitely set here.
    const { renderer, cssSize } = this.applySize(size);
    this.liveRenderer = renderer;
    this.cssSize = cssSize;
    parent.appendChild(this.el);
  }

  resize(size: CanvasSize): void {
    const { renderer, cssSize } = this.applySize(size);
    this.liveRenderer = renderer;
    this.cssSize = cssSize;
  }

  // Sets canvas dimensions and builds a fresh renderer. Called by both the
  // constructor and resize() so the logic lives in one place.
  private applySize(size: CanvasSize): { renderer: IRenderer; cssSize: CanvasSize } {
    sizeCanvasForDpr(this.el, size.width, size.height, this.dpr);
    const ctx = this.el.getContext("2d");
    if (!ctx) throw new Error("overlay: failed to get 2d context");
    return { renderer: new CanvasRenderer(ctx, { dpr: this.dpr }), cssSize: size };
  }

  // The renderer for the current canvas backing store (rebuilt on resize, so
  // don't hold on to it across resizes).
  get renderer(): IRenderer {
    return this.liveRenderer;
  }

  get size(): CanvasSize {
    return this.cssSize;
  }

  setVisible(visible: boolean): void {
    this.el.style.display = visible ? "" : "none";
  }
}

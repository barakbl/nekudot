import type { IRenderer, RendererInit } from "../renderer";
import { sizeCanvasForDpr, type CanvasSize } from "../canvas-size";
import { TrackingRenderer } from "./dirty";
import type { LayerConfig } from "./schema";

// One canvas per layer. Paint and connections both draw onto this surface.
export class Layer {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: IRenderer;

  private readonly size: CanvasSize;
  private readonly dpr: number;

  constructor(
    public config: LayerConfig,
    size: CanvasSize,
    dpr: number,
    rendererInit: RendererInit = {},
  ) {
    this.size = size;
    this.dpr = dpr;
    this.canvas = this.createCanvas();
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get 2D canvas context");
    // The single per-layer draw sink; TrackingRenderer records dirty regions and
    // forwards every draw unchanged (record-only, output identical).
    this.renderer = new TrackingRenderer(ctx, { dpr, ...rendererInit });
    this.applyZIndex();
    this.applyOpacity();
  }

  setOpacity(percent: number): void {
    this.config.opacity = percent;
    this.canvas.style.opacity = String(percent / 100);
  }

  setName(name: string): void {
    this.config.name = name;
  }

  refreshZIndices(): void {
    this.applyZIndex();
  }

  private createCanvas(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    sizeCanvasForDpr(c, this.size.width, this.size.height, this.dpr);
    c.style.position = "absolute";
    c.style.left = "0";
    c.style.top = "0";
    c.style.pointerEvents = "none";
    return c;
  }

  private applyZIndex(): void {
    // 1-based so the stacking reads 1,2,3,4 (config.index stays 0-based as the
    // array position; the manager renumbers it on every order change).
    this.canvas.style.zIndex = String(this.config.index + 1);
  }

  private applyOpacity(): void {
    this.canvas.style.opacity = String(this.config.opacity / 100);
  }
}

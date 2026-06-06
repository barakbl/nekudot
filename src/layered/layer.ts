import { CanvasRenderer, type IRenderer, type RendererInit } from "../renderer";
import type { CanvasSize } from "../canvas-size";
import type { LayerConfig, LayerType } from "./schema";

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
    this.renderer = new CanvasRenderer(ctx, { dpr, ...rendererInit });
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

  hasType(t: LayerType): boolean {
    return this.config.types.includes(t);
  }

  refreshZIndices(): void {
    this.applyZIndex();
  }

  private createCanvas(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = Math.round(this.size.width * this.dpr);
    c.height = Math.round(this.size.height * this.dpr);
    c.style.position = "absolute";
    c.style.left = "0";
    c.style.top = "0";
    c.style.width = `${this.size.width}px`;
    c.style.height = `${this.size.height}px`;
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

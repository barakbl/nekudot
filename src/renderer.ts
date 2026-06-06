import type { Pixel } from "./neighbor-finder";
import type { CanvasSize } from "./canvas-size";

export type LineStyle = {
  color?: string;
  width?: number;
  alpha?: number;
  cap?: CanvasLineCap;
  dash?: readonly number[];
  dashOffset?: number;
  // Bow of the "quadraticCurve" connect type: control-point offset as a
  // fraction of the line length, perpendicular to it. 0 = straight; larger =
  // more curl. Ignored by "line" and "arc". Defaults to 0.3 (the historic bow).
  curve?: number;
};

export const LineConnectTypes = ["line", "arc", "quadraticCurve"] as const;
export type LineConnectType = (typeof LineConnectTypes)[number];

export interface IRenderer {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(
    x: number,
    y: number,
    radius: number,
    startAngle?: number,
    endAngle?: number,
  ): void;
  stroke(): void;
  drawLine(
    p1: Pixel,
    p2: Pixel,
    style?: LineStyle,
    kind?: LineConnectType,
  ): void;
  drawConnection(
    p1: Pixel,
    p2: Pixel,
    style?: LineStyle,
    kind?: LineConnectType,
  ): void;
  drawChisel(p1: Pixel, p2: Pixel, angle: number, style?: LineStyle): void;
  strokeRect(
    x: number,
    y: number,
    w: number,
    h: number,
    style?: LineStyle,
    angle?: number,
  ): void;
  strokeCircle(x: number, y: number, radius: number, style?: LineStyle): void;
  fillEllipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    angle: number,
    color?: string,
    alpha?: number,
  ): void;
  strokeEllipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    angle: number,
    style?: LineStyle,
  ): void;
  fillRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color?: string,
    angle?: number,
    alpha?: number,
  ): void;
  fillCircle(
    x: number,
    y: number,
    radius: number,
    color?: string,
    alpha?: number,
  ): void;
  clear(): void;
  setLineWidth(w: number): void;
  setStrokeStyle(c: string): void;
  setGlobalAlpha(a: number): void;
  setEraseMode(on: boolean): void;
  fillBackground(color: string): void;
  drawSource(other: IRenderer, opacity?: number, scale?: number): void;
  drawBitmap(bitmap: CanvasImageSource): void;
  toBlob(type?: string): Promise<Blob | null>;
}

export type RendererInit = {
  dpr?: number;
  lineCap?: CanvasLineCap;
  lineJoin?: CanvasLineJoin;
  lineWidth?: number;
  strokeStyle?: string;
  globalAlpha?: number;
  eraseMode?: boolean;
};

export function createOffscreenRenderer(
  size: CanvasSize,
  dpr: number,
): IRenderer {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(size.width * dpr);
  canvas.height = Math.round(size.height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D context for offscreen renderer");
  return new CanvasRenderer(ctx, { dpr });
}

export class CanvasRenderer implements IRenderer {
  constructor(
    private ctx: CanvasRenderingContext2D,
    init: RendererInit = {},
  ) {
    if (init.dpr !== undefined) this.ctx.scale(init.dpr, init.dpr);
    this.ctx.lineCap = init.lineCap ?? "round";
    this.ctx.lineJoin = init.lineJoin ?? "round";
    if (init.lineWidth !== undefined) this.ctx.lineWidth = init.lineWidth;
    if (init.strokeStyle !== undefined) this.ctx.strokeStyle = init.strokeStyle;
    if (init.globalAlpha !== undefined) this.ctx.globalAlpha = init.globalAlpha;
    if (init.eraseMode) this.ctx.globalCompositeOperation = "destination-out";
  }

  setLineWidth(w: number): void {
    this.ctx.lineWidth = w;
  }
  setStrokeStyle(c: string): void {
    this.ctx.strokeStyle = c;
  }
  setGlobalAlpha(a: number): void {
    this.ctx.globalAlpha = a;
  }
  setEraseMode(on: boolean): void {
    this.ctx.globalCompositeOperation = on ? "destination-out" : "source-over";
  }

  fillBackground(color: string): void {
    this.ctx.save();
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.globalAlpha = 1;
    this.ctx.fillStyle = color;
    const { width, height } = this.ctx.canvas;
    // Use untransformed coords: clear then fill.
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillRect(0, 0, width, height);
    this.ctx.restore();
  }

  drawSource(other: IRenderer, opacity = 1, scale = 1): void {
    if (!(other instanceof CanvasRenderer)) {
      throw new Error("drawSource: unsupported renderer type");
    }
    this.ctx.save();
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.globalAlpha = opacity;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    const c = other.ctx.canvas;
    if (scale === 1) this.ctx.drawImage(c, 0, 0);
    else this.ctx.drawImage(c, 0, 0, c.width * scale, c.height * scale);
    this.ctx.restore();
  }

  drawBitmap(bitmap: CanvasImageSource): void {
    this.ctx.save();
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.globalAlpha = 1;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Scale source to the canvas backing store so bitmaps saved at a different
    // dpr/size still fill the layer correctly.
    this.ctx.drawImage(bitmap, 0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    this.ctx.restore();
  }

  toBlob(type = "image/png"): Promise<Blob | null> {
    return new Promise((resolve) => {
      this.ctx.canvas.toBlob((blob) => resolve(blob), type);
    });
  }

  moveTo(x: number, y: number): void {
    this.ctx.moveTo(x, y);
  }

  lineTo(x: number, y: number): void {
    this.ctx.lineTo(x, y);
  }

  arc(
    x: number,
    y: number,
    radius: number,
    startAngle = 0,
    endAngle = Math.PI * 2,
  ): void {
    this.ctx.arc(x, y, radius, startAngle, endAngle);
  }

  stroke(): void {
    this.ctx.stroke();
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
  }

  strokeRect(
    x: number,
    y: number,
    w: number,
    h: number,
    style?: LineStyle,
    angle?: number,
  ): void {
    this.ctx.save();
    if (style?.color !== undefined) this.ctx.strokeStyle = style.color;
    if (style?.width !== undefined) this.ctx.lineWidth = style.width;
    if (style?.alpha !== undefined) this.ctx.globalAlpha = style.alpha;
    if (style?.dash !== undefined) this.ctx.setLineDash(style.dash as number[]);

    if (angle !== undefined && angle !== 0) {
      this.ctx.translate(x, y);
      this.ctx.rotate(angle);
      this.ctx.strokeRect(-w / 2, -h / 2, w, h);
    } else {
      this.ctx.strokeRect(x - w / 2, y - h / 2, w, h);
    }

    this.ctx.restore();
  }

  strokeCircle(
    x: number,
    y: number,
    radius: number,
    style?: LineStyle,
  ): void {
    if (style) this.ctx.save();
    if (style?.color !== undefined) this.ctx.strokeStyle = style.color;
    if (style?.width !== undefined) this.ctx.lineWidth = style.width;
    if (style?.alpha !== undefined) this.ctx.globalAlpha = style.alpha;
    if (style?.dash !== undefined) this.ctx.setLineDash(style.dash as number[]);

    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.stroke();

    if (style) this.ctx.restore();
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
    this.ctx.save();
    this.ctx.fillStyle = color ?? (this.ctx.strokeStyle as string);
    if (alpha !== undefined) this.ctx.globalAlpha = alpha;
    this.ctx.beginPath();
    this.ctx.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  strokeEllipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    angle: number,
    style?: LineStyle,
  ): void {
    this.ctx.save();
    if (style?.color !== undefined) this.ctx.strokeStyle = style.color;
    if (style?.width !== undefined) this.ctx.lineWidth = style.width;
    if (style?.alpha !== undefined) this.ctx.globalAlpha = style.alpha;
    if (style?.dash !== undefined) this.ctx.setLineDash(style.dash as number[]);
    this.ctx.beginPath();
    this.ctx.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2);
    this.ctx.stroke();
    this.ctx.restore();
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
    this.ctx.save();
    this.ctx.fillStyle = color ?? (this.ctx.strokeStyle as string);
    if (alpha !== undefined) this.ctx.globalAlpha = alpha;
    if (angle !== undefined && angle !== 0) {
      this.ctx.translate(x, y);
      this.ctx.rotate(angle);
      this.ctx.fillRect(-w / 2, -h / 2, w, h);
    } else {
      this.ctx.fillRect(x - w / 2, y - h / 2, w, h);
    }
    this.ctx.restore();
  }

  fillCircle(
    x: number,
    y: number,
    radius: number,
    color?: string,
    alpha?: number,
  ): void {
    this.ctx.save();
    this.ctx.fillStyle = color ?? (this.ctx.strokeStyle as string);
    if (alpha !== undefined) this.ctx.globalAlpha = alpha;
    this.ctx.beginPath();
    this.ctx.arc(x, y, radius, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  drawLine(
    p1: Pixel,
    p2: Pixel,
    style?: LineStyle,
    kind: LineConnectType = "line",
  ): void {
    if (style) this.ctx.save();
    if (style?.color !== undefined) this.ctx.strokeStyle = style.color;
    if (style?.width !== undefined) this.ctx.lineWidth = style.width;
    if (style?.alpha !== undefined) this.ctx.globalAlpha = style.alpha;
    if (style?.cap !== undefined) this.ctx.lineCap = style.cap;
    if (style?.dash !== undefined) this.ctx.setLineDash(style.dash as number[]);
    if (style?.dashOffset !== undefined) this.ctx.lineDashOffset = style.dashOffset;

    this.ctx.beginPath();
    this.ctx.moveTo(p1.x, p1.y);
    this.tracePath(p1, p2, kind, style?.curve);
    this.ctx.stroke();

    if (style) this.ctx.restore();
  }

  drawConnection(
    p1: Pixel,
    p2: Pixel,
    style?: LineStyle,
    kind: LineConnectType = "line",
  ): void {
    this.drawLine(p1, p2, style, kind);
  }

  drawChisel(
    p1: Pixel,
    p2: Pixel,
    angle: number,
    style?: LineStyle,
  ): void {
    this.ctx.save();
    if (style?.alpha !== undefined) this.ctx.globalAlpha = style.alpha;
    const color = style?.color ?? (this.ctx.strokeStyle as string);
    const width = style?.width ?? this.ctx.lineWidth;
    const dx = (Math.cos(angle) * width) / 2;
    const dy = (Math.sin(angle) * width) / 2;
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.moveTo(p1.x + dx, p1.y + dy);
    this.ctx.lineTo(p2.x + dx, p2.y + dy);
    this.ctx.lineTo(p2.x - dx, p2.y - dy);
    this.ctx.lineTo(p1.x - dx, p1.y - dy);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.restore();
  }

  private tracePath(
    p1: Pixel,
    p2: Pixel,
    kind: LineConnectType,
    curve = 0.3,
  ): void {
    switch (kind) {
      case "line":
        this.ctx.lineTo(p2.x, p2.y);
        return;
      case "arc": {
        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        const r = Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2;
        const a0 = Math.atan2(p1.y - cy, p1.x - cx);
        const a1 = Math.atan2(p2.y - cy, p2.x - cx);
        this.ctx.arc(cx, cy, r, a0, a1);
        return;
      }
      case "quadraticCurve": {
        const mx = (p1.x + p2.x) / 2;
        const my = (p1.y + p2.y) / 2;
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const ctrlX = mx - dy * curve;
        const ctrlY = my + dx * curve;
        this.ctx.quadraticCurveTo(ctrlX, ctrlY, p2.x, p2.y);
        return;
      }
    }
  }
}

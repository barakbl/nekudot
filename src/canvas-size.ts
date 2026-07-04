import { z } from "zod";

export const CanvasSizeSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type CanvasSize = z.infer<typeof CanvasSizeSchema>;

export function fullScreenSize(maxW: number, maxH: number): CanvasSize {
  return { width: maxW, height: maxH };
}

export function squareOfScreen(maxW: number, maxH: number): CanvasSize {
  const s = Math.min(maxW, maxH);
  return { width: s, height: s };
}

// The largest whole-pixel canvas that fits the viewport (minus `border` per
// side). The visual viewport can report sub-pixel CSS sizes (fractional
// devicePixelRatio, or zoom), so floor - a max bound rounds down to never
// overflow.
export function screenMaxSize(
  viewW: number,
  viewH: number,
  border: number,
): CanvasSize {
  return {
    width: Math.max(1, Math.floor(viewW - border * 2)),
    height: Math.max(1, Math.floor(viewH - border * 2)),
  };
}

export function clampSize(
  size: CanvasSize,
  maxW: number,
  maxH: number,
): CanvasSize {
  return {
    width: Math.max(1, Math.min(Math.round(size.width), maxW)),
    height: Math.max(1, Math.min(Math.round(size.height), maxH)),
  };
}

export function safeLoadSize(raw: unknown): CanvasSize | null {
  const parsed = CanvasSizeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// Size a canvas for a HiDPI display: the backing store is the CSS box scaled by
// dpr (rounded to whole device pixels), while the element keeps its CSS size.
// The single home for this ritual - every displayed canvas (layers, overlays,
// wet-stroke, image paste, previews, thumbnails) sizes through here so the
// backing-store-vs-CSS-box mapping can't drift across the codebase. Note that
// writing canvas.width/height also clears the bitmap, so a caller that must
// preserve its pixels guards the call (only re-sizing when the size changed).
export function sizeCanvasForDpr(
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): void {
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
}

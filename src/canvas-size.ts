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

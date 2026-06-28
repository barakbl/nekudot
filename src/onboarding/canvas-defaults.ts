// Dark canvas + light ink: white + black makes the connecting web read as a
// faint, broken smudge.
export const NEUTRAL_CANVAS_BG = "#14151a";
export const NEUTRAL_CANVAS_INK = "#f5f5f5";

export type CanvasDefaults = { background: string; ink: string };

export function neutralCanvasDefaults(): CanvasDefaults {
  return { background: NEUTRAL_CANVAS_BG, ink: NEUTRAL_CANVAS_INK };
}

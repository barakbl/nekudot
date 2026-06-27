// Contrast-safe defaults for the neutral / blank first canvas.
//
// White background + black brush is the app's most damaging first impression:
// the connecting brush's signature web is drawn at low alpha, so on white with
// black ink it reads as a faint, broken grey smudge instead of a lush web. A
// dark canvas with light ink makes the first stroke AND its web clearly visible -
// the same reason the mandala start uses a near-black canvas.
//
// We use a dark canvas regardless of the UI theme: the drawing surface is where
// Nekudot's web shines, so it stays dark even when the chrome is Light. The shade
// is distinct from the mandala's #0d0e12 so a plain Blank start does not pass for
// the mandala.
//
// Kept as a tiny pure module so the colours have one home and the
// "never ship white-bg + black-brush" invariant can be unit-tested.

export const NEUTRAL_CANVAS_BG = "#14151a";
export const NEUTRAL_CANVAS_INK = "#f5f5f5";

export type CanvasDefaults = { background: string; ink: string };

// The background + brush colour for a neutral first canvas (Blank, and the canvas
// revealed when the Start page is dismissed).
export function neutralCanvasDefaults(): CanvasDefaults {
  return { background: NEUTRAL_CANVAS_BG, ink: NEUTRAL_CANVAS_INK };
}

import { mixOklch } from "./oklch";

// Gradient / colour-interpolation primitives, shared by the connection colour
// source (the 256-step LUT in brushes/color-source) and the palette UI previews
// (colors/panel). One implementation means a swatch preview always matches the
// rendered art, in either blend space, on every browser - no reliance on the
// browser's CSS `in oklch` support.

// How two colours blend: "oklch" (perceptual, smooth - no muddy/grey midpoints)
// or "srgb" (the classic gamma-sRGB lerp a default CSS gradient does).
export type GradientSpace = "oklch" | "srgb";

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const FALLBACK = "#000000";

export function parseHex(hex: string): [number, number, number] {
  let h = (HEX.test(hex) ? hex : FALLBACK).slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(r: number, g: number, b: number): string {
  const part = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

// Classic linear blend in gamma-encoded sRGB (what a browser's default
// linear-gradient does). t is clamped to 0..1.
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const k = Math.max(0, Math.min(1, t));
  return toHex(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k);
}

// Blend two hex colours in the chosen space.
export function blend(a: string, b: string, t: number, space: GradientSpace): string {
  return space === "oklch" ? mixOklch(a, b, t) : mixHex(a, b, t);
}

// Position t (0..1) along a multi-stop palette.
//   cyclic - wraps last->first (no seam when driven around a circle); used by
//            the connection colour source.
//   linear - clamps to the first/last stop at the ends; used by the left->right
//            UI previews.
export function paletteHex(
  stops: readonly string[],
  t: number,
  space: GradientSpace,
  cyclic = true,
): string {
  const n = stops.length;
  if (n <= 1) return stops[0] ?? FALLBACK;
  if (cyclic) {
    const x = (((t % 1) + 1) % 1) * n;
    const i = Math.floor(x) % n;
    return blend(stops[i], stops[(i + 1) % n], x - Math.floor(x), space);
  }
  const k = Math.max(0, Math.min(1, t));
  const x = k * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  return blend(stops[i], stops[i + 1], x - i, space);
}

// N evenly-spaced colour samples across a palette (positions 0..1). Linear by
// default (exact first/last endpoints), which is what a preview swatch wants.
export function gradientStops(
  colors: readonly string[],
  space: GradientSpace,
  n: number,
  cyclic = false,
): string[] {
  if (colors.length <= 1) return colors.length ? [colors[0]] : [];
  const out = new Array<string>(n);
  for (let k = 0; k < n; k++) {
    out[k] = paletteHex(colors, n === 1 ? 0 : k / (n - 1), space, cyclic);
  }
  return out;
}

// A CSS linear-gradient built from pre-blended stops, so the preview matches the
// rendered art and needs no browser OKLCH support. ~24 stops reads as perfectly
// smooth across a small swatch.
export function gradientCss(
  colors: readonly string[],
  space: GradientSpace,
  n = 24,
): string {
  if (colors.length === 0) return "transparent";
  if (colors.length === 1) return colors[0];
  return `linear-gradient(to right, ${gradientStops(colors, space, n).join(", ")})`;
}

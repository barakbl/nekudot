// OKLCH <-> sRGB hex. OKLab/OKLCH per Björn Ottosson
// (https://bottosson.github.io/posts/oklab/). Colours outside the sRGB gamut are
// brought in by reducing chroma (preserving L and H - the perceptual fix), then
// channels are clamped for tiny float overshoot. Self-contained (no dependency),
// matching the hand-rolled colour maths in brushes/color-source.ts.

export type Oklch = { l: number; c: number; h: number };

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// linear sRGB (0..1) -> OKLab
function linToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

// OKLab -> linear sRGB (0..1, possibly out of range)
function oklabToLin(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const EPS = 1e-4;
function inGamut([r, g, b]: [number, number, number]): boolean {
  return (
    r >= -EPS && r <= 1 + EPS && g >= -EPS && g <= 1 + EPS && b >= -EPS && b <= 1 + EPS
  );
}

function oklchToLin({ l, c, h }: Oklch): [number, number, number] {
  const hr = (h * Math.PI) / 180;
  return oklabToLin(l, c * Math.cos(hr), c * Math.sin(hr));
}

// OKLCH -> "#rrggbb", gamut-mapped into sRGB.
export function oklchToHex(o: Oklch): string {
  const l = Math.max(0, Math.min(1, o.l));
  let c = Math.max(0, o.c);
  const h = o.h;
  if (!inGamut(oklchToLin({ l, c, h }))) {
    // Largest chroma that still fits in gamut, by bisection.
    let lo = 0;
    let hi = c;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLin({ l, c: mid, h }))) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  const [r, g, b] = oklchToLin({ l, c, h });
  const channel = (v: number): string => {
    const s = linearToSrgb(Math.max(0, Math.min(1, v)));
    return Math.round(Math.max(0, Math.min(1, s)) * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

// Perceptual blend between two hex colours in OKLCH: lerp lightness + chroma and
// rotate hue the short way. An achromatic endpoint (chroma ~0, hue undefined) is
// "powerless" - it keeps the other endpoint's hue, so e.g. black->blue doesn't
// sweep through colours. Endpoints return exactly. This is what lets a gradient
// avoid sRGB's muddy/grey midpoints. t is clamped to 0..1.
export function mixOklch(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  if (k <= 0) return a;
  if (k >= 1) return b;
  const A = hexToOklch(a);
  const B = hexToOklch(b);
  const l = A.l + (B.l - A.l) * k;
  const c = A.c + (B.c - A.c) * k;
  const aCh = A.c > 1e-4;
  const bCh = B.c > 1e-4;
  let h: number;
  if (aCh && bCh) {
    const d = ((((B.h - A.h) % 360) + 540) % 360) - 180; // shortest arc, (-180, 180]
    h = A.h + d * k;
  } else {
    h = aCh ? A.h : B.h; // a powerless (or both-grey) endpoint -> the other's hue
  }
  return oklchToHex({ l, c, h });
}

// "#rgb"/"#rrggbb" -> OKLCH (unparseable input falls back to black).
export function hexToOklch(hex: string): Oklch {
  let s = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const int = /^[0-9a-f]{6}$/i.test(s) ? parseInt(s, 16) : 0;
  const r = srgbToLinear(((int >> 16) & 255) / 255);
  const g = srgbToLinear(((int >> 8) & 255) / 255);
  const b = srgbToLinear((int & 255) / 255);
  const [L, A, B] = linToOklab(r, g, b);
  const c = Math.sqrt(A * A + B * B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h };
}

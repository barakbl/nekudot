import type { Store } from "../store/base";
import { mixOklch } from "../colors/oklch";

// Shared bits for the "color source" selects — the connecting Color dial and
// the Squares/Circles Fill dropdown. Both choose between the toolbar's two
// colors (kept internally as "main"/"secondary"); the UI shows them as
// Primary/Secondary with a live swatch of the actual colour.

// Internal value -> display label. Values stay "main"/"secondary"/"none" so
// persisted settings and the draw logic are untouched; only the wording changes.
// The multi-stop palette sources are added dynamically (see connectionColorLabels).
export const COLOR_SOURCE_LABELS: Record<string, string> = {
  none: "None",
  main: "Primary",
  secondary: "Secondary",
  gradient: "Gradient",
  rainbow: "Rainbow",
  complement: "Complement",
};

const PRIMARY_DEFAULT = "#000000";
const SECONDARY_DEFAULT = "#888888";
// The colour input only ever produces #rrggbb, but validate before it reaches
// an SVG fill attribute anyway (the value comes from storage).
const HEX = /^#[0-9a-fA-F]{3,8}$/;

function swatch(fill: string): string {
  const c = HEX.test(fill) ? fill : PRIMARY_DEFAULT;
  return (
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
    `<rect x="1" y="1" width="14" height="14" rx="3" fill="${c}" stroke="rgba(128,128,128,0.55)" stroke-width="1"/></svg>`
  );
}

const noneSwatch =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
  '<rect x="1" y="1" width="14" height="14" rx="3" fill="none" stroke="rgba(128,128,128,0.55)" stroke-width="1"/>' +
  '<path d="M3.5 12.5 L12.5 3.5" stroke="rgba(150,150,150,0.9)" stroke-width="1.4"/></svg>';

// --- colour maths (shared by the gradient/rainbow connection colour source) ---

function parseHex(hex: string): [number, number, number] {
  let h = (HEX.test(hex) ? hex : PRIMARY_DEFAULT).slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function toHex(r: number, g: number, b: number): string {
  const part = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

// Linear blend between two hex colours; t clamped to 0..1.
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const k = Math.max(0, Math.min(1, t));
  return toHex(ar + (br - ar) * k, ag + (bg - ag) * k, ab + (bb - ab) * k);
}

// HSL (h in degrees, s/l 0..1) -> hex.
function hslToHex(deg: number, s: number, l: number): string {
  const h = ((((deg % 360) + 360) % 360) / 360) as number;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return toHex(ch(h + 1 / 3) * 255, ch(h) * 255, ch(h - 1 / 3) * 255);
}

// A vivid hue at `deg` degrees (fixed saturation/lightness) -> hex. The Rainbow
// colour source.
export function hueHex(deg: number, s = 0.8, l = 0.58): string {
  return hslToHex(deg, s, l);
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

// The hue-opposite of a colour, keeping its saturation + lightness. Used by the
// "Complement" colour source (Primary <-> its complement).
export function complementHex(hex: string): string {
  const [r, g, b] = parseHex(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  return hslToHex(h + 180, s, l);
}

// Position t (0..1) along a multi-stop palette, CYCLIC (wraps last->first) so it
// has no seam when driven around the circle by the line angle. Blends in the
// configured space (OKLCH by default - perceptually smooth midpoints).
function paletteHex(stops: readonly string[], t: number): string {
  const n = stops.length;
  if (n === 1) return stops[0];
  const x = (((t % 1) + 1) % 1) * n;
  const i = Math.floor(x) % n;
  return blend(stops[i], stops[(i + 1) % n], x - Math.floor(x));
}

// Curated multi-stop connection gradients, the defaults that ship as built-in
// gradient palettes (App tab) and seed the gradient source cache below.
const CONNECTION_GRADIENTS: { name: string; label: string; colors: readonly string[] }[] = [
  { name: "sunset", label: "Sunset", colors: ["#ff5e62", "#ff9966", "#ffd194", "#fde9b0"] },
  { name: "ocean", label: "Ocean", colors: ["#0083b0", "#00b4db", "#48cae4", "#90e0ef"] },
  { name: "neon", label: "Neon", colors: ["#00ffa3", "#00b3ff", "#7a5cff", "#ff00d4"] },
  { name: "fire", label: "Fire", colors: ["#7a0010", "#e63900", "#ff7b00", "#ffd000"] },
];

// The default connection palettes surfaced to the colour palette panel as
// read-only swatch groups. The dynamic sources (gradient/rainbow/complement) are
// angle-driven, not fixed colour lists, so they're not included.
export function connectionPalettes(): { name: string; label: string; colors: string[] }[] {
  return CONNECTION_GRADIENTS.map((g) => ({ name: g.name, label: g.label, colors: [...g.colors] }));
}

// --- gradient sources from the colour palette mechanism ---------------------
// The multi-stop palettes the connection Color dial offers are the palettes the
// user has activated as gradients (built-ins on by default + custom ones), fed in
// from the palette store via setGradientPalettes. Seeded synchronously with the
// built-in connection gradients so they're available before the async load (and
// in tests). Each id matches the palette's id in the colours mechanism.
type GradientPalette = { id: string; label: string; colors: readonly string[] };
let gradientPalettes: GradientPalette[] = CONNECTION_GRADIENTS.map((g) => ({
  id: `conn:${g.name}`,
  label: g.label,
  colors: g.colors,
}));

export function setGradientPalettes(list: readonly GradientPalette[]): void {
  gradientPalettes = list.filter((p) => p.colors.length > 0).map((p) => ({ ...p }));
  rebuildGradientLut();
}

// How gradients blend between stops: "oklch" (perceptual, smooth - the default)
// or "srgb" (the classic linear-RGB blend). App-level setting, wired from
// main.ts. Switching rebuilds the ramps.
type GradientSpace = "oklch" | "srgb";
let gradientSpace: GradientSpace = "oklch";
export function setGradientSpace(space: GradientSpace): void {
  if (space === gradientSpace) return;
  gradientSpace = space;
  rebuildGradientLut();
}
function blend(a: string, b: string, t: number): string {
  return gradientSpace === "oklch" ? mixOklch(a, b, t) : mixHex(a, b, t);
}

// Precomputed gradient ramp per palette id, so the connection draw hot path is a
// table lookup rather than a per-line blend (256 steps reads as smooth). Rebuilt
// whenever the activated palette set or the blend space changes.
const LUT_N = 256;
let gradientLut: Record<string, string[]> = {};
function buildLut(colors: readonly string[]): string[] {
  const lut = new Array<string>(LUT_N);
  for (let k = 0; k < LUT_N; k++) lut[k] = paletteHex(colors, k / LUT_N);
  return lut;
}
function rebuildGradientLut(): void {
  gradientLut = {};
  for (const p of gradientPalettes) gradientLut[p.id] = buildLut(p.colors);
}
rebuildGradientLut();

// The angle-driven, non-palette sources, in dropdown order.
const STATIC_COLOR_SOURCES = ["main", "secondary", "gradient", "rainbow", "complement"] as const;

// Legacy connection colour values (pre-palette-mechanism) -> the new palette ids,
// so saved presets/settings keep resolving to the same gradient.
const LEGACY_SOURCE: Record<string, string> = {
  sunset: "conn:sunset",
  ocean: "conn:ocean",
  neon: "conn:neon",
  fire: "conn:fire",
};

// Map a stored/incoming colour source to its canonical value (legacy name -> id).
export function normalizeColorSource(v: string): string {
  return LEGACY_SOURCE[v] ?? v;
}

// The connection Color dial options, in dropdown order: the static sources then
// every activated gradient palette.
export function connectionColorOptions(): string[] {
  return [...STATIC_COLOR_SOURCES, ...gradientPalettes.map((p) => p.id)];
}

// Labels for the dial: the static ones plus a label per activated gradient.
export function connectionColorLabels(): Record<string, string> {
  const out: Record<string, string> = { ...COLOR_SOURCE_LABELS };
  for (const p of gradientPalettes) out[p.id] = p.label;
  return out;
}

// The colour for one connection line: the source, a 0..1 driver (the line's
// angle), and the live toolbar colours. "main" -> undefined so the renderer uses
// the Primary strokeStyle.
export function connectionLineColor(
  source: string,
  t: number,
  primary: string,
  secondary: string,
): string | undefined {
  switch (source) {
    case "main":
      return undefined;
    case "secondary":
      return secondary;
    case "gradient":
      return blend(primary, secondary, t);
    case "rainbow":
      return hueHex(t * 360);
    case "complement":
      return paletteHex([primary, complementHex(primary)], t);
    default: {
      // Palette gradients read from the precomputed OKLCH ramp.
      const lut = gradientLut[normalizeColorSource(source)];
      if (!lut) return undefined;
      return lut[Math.floor((((t % 1) + 1) % 1) * LUT_N) % LUT_N];
    }
  }
}

// Build SVG <stop>s by sampling a blend at n+1 evenly-spaced points, so the swatch
// preview matches the configured blend space (OKLCH/sRGB) rather than the browser's
// default sRGB <linearGradient> interpolation.
function sampledStops(sample: (t: number) => string, n = 10): string {
  let out = "";
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    out += `<stop offset="${t.toFixed(3)}" stop-color="${sample(t)}"/>`;
  }
  return out;
}

// Non-cyclic blend through a multi-stop palette (left -> right preview).
function blendStops(stops: readonly string[], t: number): string {
  const n = stops.length;
  if (n === 1) return stops[0];
  const x = Math.max(0, Math.min(1, t)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  return blend(stops[i], stops[i + 1], x - i);
}

function svgGradient(id: string, stops: string): string {
  return (
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient></defs>` +
    `<rect x="1" y="1" width="14" height="14" rx="3" fill="url(#${id})" stroke="rgba(128,128,128,0.55)" stroke-width="1"/></svg>`
  );
}

// Multi-stop palette swatch, sampled in the active blend space. A unique gradient
// id per call avoids clashes when the icon is rendered more than once.
function paletteSwatch(stops: readonly string[]): string {
  const id = "csp" + Math.random().toString(36).slice(2, 8);
  return svgGradient(id, sampledStops((t) => blendStops(stops, t)));
}

// A two-stop gradient swatch (live Primary -> Secondary), in the active blend space.
function gradientSwatch(a: string, b: string): string {
  const id = "csg" + Math.random().toString(36).slice(2, 8);
  const A = HEX.test(a) ? a : PRIMARY_DEFAULT;
  const B = HEX.test(b) ? b : SECONDARY_DEFAULT;
  return svgGradient(id, sampledStops((t) => blend(A, B, t), 8));
}

const rainbowSwatch =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
  '<defs><linearGradient id="csr" x1="0" y1="0" x2="1" y2="0">' +
  '<stop offset="0" stop-color="#ff3b30"/><stop offset="0.33" stop-color="#ffcc00"/>' +
  '<stop offset="0.5" stop-color="#34c759"/><stop offset="0.66" stop-color="#00b8d4"/>' +
  '<stop offset="1" stop-color="#af52de"/></linearGradient></defs>' +
  '<rect x="1" y="1" width="14" height="14" rx="3" fill="url(#csr)" stroke="rgba(128,128,128,0.55)" stroke-width="1"/></svg>';

// Swatch icons reflecting the LIVE toolbar colours, keyed by source value.
// Rebuilt each render (getSettings is called fresh), so the swatch tracks the
// current Primary/Secondary colours and the selected source.
export function colorSourceIcons(store?: Store): Record<string, string> {
  const icons: Record<string, string> = {
    none: noneSwatch,
    main: swatch(store?.get<string>("app.color.main") ?? PRIMARY_DEFAULT),
    secondary: swatch(
      store?.get<string>("app.color.secondary") ?? SECONDARY_DEFAULT,
    ),
    gradient: gradientSwatch(
      store?.get<string>("app.color.main") ?? PRIMARY_DEFAULT,
      store?.get<string>("app.color.secondary") ?? SECONDARY_DEFAULT,
    ),
    rainbow: rainbowSwatch,
    complement: gradientSwatch(
      store?.get<string>("app.color.main") ?? PRIMARY_DEFAULT,
      complementHex(store?.get<string>("app.color.main") ?? PRIMARY_DEFAULT),
    ),
  };
  // A multi-stop swatch per activated gradient palette.
  for (const p of gradientPalettes) icons[p.id] = paletteSwatch(p.colors);
  return icons;
}

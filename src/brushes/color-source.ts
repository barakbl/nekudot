import type { Store } from "../store/base";

// Shared bits for the "color source" selects — the connecting Color dial and
// the Squares/Circles Fill dropdown. Both choose between the toolbar's two
// colors (kept internally as "main"/"secondary"); the UI shows them as
// Primary/Secondary with a live swatch of the actual colour.

// Internal value -> display label. Values stay "main"/"secondary"/"none" so
// persisted settings and the draw logic are untouched; only the wording changes.
export const COLOR_SOURCE_LABELS: Record<string, string> = {
  none: "None",
  main: "Primary",
  secondary: "Secondary",
  gradient: "Gradient",
  rainbow: "Rainbow",
  complement: "Complement",
  sunset: "Sunset",
  ocean: "Ocean",
  neon: "Neon",
  fire: "Fire",
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
// has no seam when driven around the circle by the line angle.
function paletteHex(stops: readonly string[], t: number): string {
  const n = stops.length;
  if (n === 1) return stops[0];
  const x = (((t % 1) + 1) % 1) * n;
  const i = Math.floor(x) % n;
  return mixHex(stops[i], stops[(i + 1) % n], x - Math.floor(x));
}

// Curated multi-stop palettes for the connection Color dial - blended by the
// line's angle, like Gradient/Rainbow. Fixed colours (they don't track the
// toolbar; use Gradient or Complement for that).
const PALETTES: Record<string, readonly string[]> = {
  sunset: ["#ff5e62", "#ff9966", "#ffd194", "#fde9b0"],
  ocean: ["#0083b0", "#00b4db", "#48cae4", "#90e0ef"],
  neon: ["#00ffa3", "#00b3ff", "#7a5cff", "#ff00d4"],
  fire: ["#7a0010", "#e63900", "#ff7b00", "#ffd000"],
};

// The connection Color dial options, in dropdown order.
export const CONNECTION_COLOR_OPTIONS = [
  "main",
  "secondary",
  "gradient",
  "rainbow",
  "complement",
  "sunset",
  "ocean",
  "neon",
  "fire",
] as const;

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
      return mixHex(primary, secondary, t);
    case "rainbow":
      return hueHex(t * 360);
    case "complement":
      return paletteHex([primary, complementHex(primary)], t);
    default: {
      const stops = PALETTES[source];
      return stops ? paletteHex(stops, t) : undefined;
    }
  }
}

// Multi-stop palette swatch. A unique gradient id per call avoids clashes when
// the icon is rendered more than once.
function paletteSwatch(stops: readonly string[]): string {
  const id = "csp" + Math.random().toString(36).slice(2, 8);
  const ss = stops
    .map((c, i) => `<stop offset="${(i / (stops.length - 1)).toFixed(3)}" stop-color="${c}"/>`)
    .join("");
  return (
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">${ss}</linearGradient></defs>` +
    `<rect x="1" y="1" width="14" height="14" rx="3" fill="url(#${id})" stroke="rgba(128,128,128,0.55)" stroke-width="1"/></svg>`
  );
}

// A two-stop gradient swatch (live Primary -> Secondary). A unique gradient id
// per call avoids clashes when the icon is rendered more than once.
function gradientSwatch(a: string, b: string): string {
  const id = "csg" + Math.random().toString(36).slice(2, 8);
  return (
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="${HEX.test(a) ? a : PRIMARY_DEFAULT}"/>` +
    `<stop offset="1" stop-color="${HEX.test(b) ? b : SECONDARY_DEFAULT}"/></linearGradient></defs>` +
    `<rect x="1" y="1" width="14" height="14" rx="3" fill="url(#${id})" stroke="rgba(128,128,128,0.55)" stroke-width="1"/></svg>`
  );
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
  return {
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
    sunset: paletteSwatch(PALETTES.sunset),
    ocean: paletteSwatch(PALETTES.ocean),
    neon: paletteSwatch(PALETTES.neon),
    fire: paletteSwatch(PALETTES.fire),
  };
}

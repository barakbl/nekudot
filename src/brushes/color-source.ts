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

// A vivid hue at `deg` degrees (HSL with fixed saturation/lightness) -> hex.
export function hueHex(deg: number, s = 0.8, l = 0.58): string {
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
  };
}

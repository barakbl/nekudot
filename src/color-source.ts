import type { Store } from "./store/base";

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
  };
}

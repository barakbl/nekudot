// Where a brush's stroke opacity is remembered. Opacity used to be one global
// value that every brush/art-style switch overwrote (from the style's pinned
// strokeAlpha), so a manual opacity was lost the moment you switched. Instead we
// scope the remembered value per (brush, art-style) for connecting brushes and
// per brush otherwise - so each tool reopens at the opacity you last set, and the
// style's strokeAlpha is only the default when nothing's saved.

export function opacityStorageKey(
  brushName: string,
  connects: boolean,
  artStyle: string,
): string {
  return connects
    ? `brush.${brushName}.opacity.${artStyle}`
    : `brush.${brushName}.opacity`;
}

// The opacity to apply when (re)selecting a brush/style: the value the user last
// set for this context if any, else the style's preferred opacity (strokeAlpha),
// else fully opaque.
export function recalledOpacity(
  saved: number | undefined,
  styleDefault: number | undefined,
): number {
  return saved ?? styleDefault ?? 1;
}

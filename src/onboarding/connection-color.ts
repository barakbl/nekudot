import type { BrushBase } from "../base";
import { connectionColorOptions } from "../brushes/color-source";

// The onboarding "Mandala" start option opens the connecting (web) brush in a
// vivid colour source so the first kaleidoscope stroke is colourful. The value
// is data-driven - it comes from the mandala option's `action.color` field in
// src/onboarding/settings.json - and defaults to Rainbow when that field is
// omitted. Kept here as a small, testable seam decoupled from the onboarding
// loader/UI (which is built separately).
export const DEFAULT_MANDALA_CONNECTION_COLOR = "rainbow";

// Resolve the configured colour source for the mandala, falling back to the
// default when the JSON omits it.
export function mandalaConnectionColor(configured?: string): string {
  return configured ?? DEFAULT_MANDALA_CONNECTION_COLOR;
}

// Apply a connecting colour source (e.g. "rainbow") to a brush's active
// connection. Validated against the known options so a typo in settings.json
// degrades to the connection's current colour instead of breaking onboarding.
// Returns true when the colour was applied. No-op (false) for a non-connecting
// brush or an unknown colour value.
export function applyConnectionColor(brush: BrushBase, color: string): boolean {
  const connection = brush.activeConnection();
  if (!connection) return false;
  if (!connectionColorOptions().includes(color)) return false;
  connection.applyFlat({ color });
  return true;
}

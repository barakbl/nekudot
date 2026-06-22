// Core data model + pure helpers for the colour palette feature. The panel
// (panel.ts), persistence (store.ts) and GPL import (gpl.ts) all build on this.
// Kept framework-free and side-effect-free so it's trivially unit-testable.

// Max colours in a single palette. A constant so it's easy to raise later.
export const MAX_SWATCHES = 120;
// How many recently-used colours to remember (the stack-based "Recent" group).
export const MAX_RECENT = 12;

export type Palette = {
  id: string; // stable id (storage key / dedupe); see makeId()
  name: string; // display name (the "name behind the scenes")
  colors: string[]; // "#rrggbb", deduped + capped at MAX_SWATCHES
  // Category tag (a categories.ts id like "CALM"); the panel filters by it.
  // Absent => treated as the default category (GENERAL).
  category?: string;
  // Marks the palette as usable as a gradient elsewhere in the app (e.g. the
  // connection Color dial). Seeded gradients default it on; the user toggles it.
  gradient?: boolean;
};

// Normalize a colour to lower-case "#rrggbb", or null if it isn't a valid hex.
// Accepts "#rgb"/"#rrggbb" with or without the leading "#".
export function normalizeHex(input: string): string | null {
  if (typeof input !== "string") return null;
  let h = input.trim().toLowerCase();
  if (h.startsWith("#")) h = h.slice(1);
  if (/^[0-9a-f]{3}$/.test(h)) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-f]{6}$/.test(h)) return null;
  return `#${h}`;
}

// Normalize, drop invalid, dedupe (case-insensitive), cap at MAX_SWATCHES.
// Order-preserving (first occurrence wins).
export function clampColors(colors: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of colors) {
    const n = normalizeHex(c);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    if (out.length >= MAX_SWATCHES) break;
  }
  return out;
}

// Push a colour to the front of the recents stack: most-recent-first, deduped,
// capped at MAX_RECENT. Invalid input returns the list unchanged.
export function pushRecent(list: readonly string[], hex: string): string[] {
  const n = normalizeHex(hex);
  if (!n) return [...list];
  const rest = list.filter((c) => normalizeHex(c) !== n);
  return [n, ...rest].slice(0, MAX_RECENT);
}

// A unique id for a custom palette. crypto.randomUUID where available, with a
// timestamp+random fallback for older runtimes.
export function makeId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

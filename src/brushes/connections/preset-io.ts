import { z } from "zod";
import type { ConnectionSpec } from "./base";
import { isConnectionFile, normalizeCustomSpecs } from "./registry";
import { triggerDownload, timestamp } from "../../export";

// Import/export of Custom connection presets as a portable ".preset" file:
//   { "version": 1, "presets": [ <ConnectionSpec>, … ] }
// Import is validated with zod and is all-or-nothing — a malformed file (bad
// shape or a preset whose class module doesn't exist) imports nothing.
//
// Trust boundary: these files are made to be shared, so every spec passes
// through normalizeCustomSpecs — the `icon` field is parsed only to infer
// `base` on legacy files (exact match against built-in icons) and is then
// dropped; it must never reach the menus, which render icons via innerHTML.
// `base` is cosmetic (picks the glyph), so an unknown one is dropped rather
// than rejecting the file; `file` decides behaviour, so it stays hard-checked.

const PRESET_FILE_VERSION = 1;

// Hard caps so a hostile/corrupt file (especially the shared settings bundle
// that embeds this payload) can't persist enough presets to wedge the boot
// render, or smuggle multi-MB strings. Far above any real set: a user has a
// handful of presets with short names.
const MAX_PRESETS = 1000;
const MAX_STR = 200;

const FlatSchema = z.record(
  z.string().max(MAX_STR),
  z.union([z.string().max(MAX_STR), z.number(), z.boolean()]),
);

// Mirrors ConnectionSpec. `file` must resolve to a real connection class module
// (checked via .refine) so an import can't point at an arbitrary file.
const SpecSchema = z.object({
  name: z.string().min(1).max(MAX_STR),
  label: z.string().max(MAX_STR).optional(),
  info: z.string().max(MAX_STR).optional(),
  // legacy; only feeds base-inference (exact match), never kept. Capped generously
  // so a built-in's SVG glyph still matches, but a giant blob can't sit in memory.
  icon: z.string().max(8192).optional(),
  base: z.string().max(MAX_STR).optional(),
  strokeAlpha: z.number().optional(),
  defaults: FlatSchema.optional(),
  file: z
    .string()
    .max(MAX_STR)
    .refine(isConnectionFile, { message: "unknown base style (file)" }),
});

const PresetFileSchema = z.object({
  version: z.number(),
  presets: z.array(SpecSchema).min(1).max(MAX_PRESETS),
});

export type ParseResult =
  | { ok: true; presets: ConnectionSpec[] }
  | { ok: false; error: string };

// Validate an already-parsed preset payload (no JSON.parse). Lets a wrapping
// file - the settings bundle - embed a preset payload and reuse this exact
// validation (the `file` refine + the icon-stripping normalize) instead of
// re-implementing it.
export function parsePresetData(json: unknown): ParseResult {
  const parsed = PresetFileSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.join(".");
    return {
      ok: false,
      error: `Not a valid preset file${where ? ` (${where}: ${first.message})` : ""}.`,
    };
  }
  return {
    ok: true,
    presets: normalizeCustomSpecs(parsed.data.presets as ConnectionSpec[]),
  };
}

// Parse + validate a .preset file's text. Returns the presets or a message.
export function parsePresetFile(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
  return parsePresetData(json);
}

// Salvage the persisted custom-preset array (IndexedDB). Per-row validation —
// a bad row is dropped, not the whole set (unlike file import, which is
// all-or-nothing) — then the same normalization as import, so icon markup
// already sitting in storage is neutered on the next load.
export function sanitizeStoredSpecs(value: unknown): ConnectionSpec[] {
  if (!Array.isArray(value)) return [];
  const valid: ConnectionSpec[] = [];
  for (const row of value) {
    const r = SpecSchema.safeParse(row);
    if (r.success) valid.push(r.data as ConnectionSpec);
  }
  return normalizeCustomSpecs(valid);
}

// The versioned .preset payload object. Shared by serializePresets and the
// settings bundle, which embeds it (so parsePresetData reads it back unchanged).
export function presetsToObject(presets: ConnectionSpec[]): {
  version: number;
  presets: ConnectionSpec[];
} {
  return { version: PRESET_FILE_VERSION, presets };
}

// Serialize presets to the versioned .preset JSON text.
export function serializePresets(presets: ConnectionSpec[]): string {
  return JSON.stringify(presetsToObject(presets), null, 2);
}

// Download the given presets as a .preset file.
export function downloadPresets(presets: ConnectionSpec[]): void {
  const blob = new Blob([serializePresets(presets)], { type: "application/json" });
  triggerDownload(blob, `nekudot_presets_${timestamp()}.preset`);
}

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

const FlatSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);

// Mirrors ConnectionSpec. `file` must resolve to a real connection class module
// (checked via .refine) so an import can't point at an arbitrary file.
const SpecSchema = z.object({
  name: z.string().min(1),
  label: z.string().optional(),
  info: z.string().optional(),
  icon: z.string().optional(), // legacy; only feeds base-inference, never kept
  base: z.string().optional(),
  strokeAlpha: z.number().optional(),
  defaults: FlatSchema.optional(),
  file: z.string().refine(isConnectionFile, { message: "unknown base style (file)" }),
});

const PresetFileSchema = z.object({
  version: z.number(),
  presets: z.array(SpecSchema).min(1),
});

export type ParseResult =
  | { ok: true; presets: ConnectionSpec[] }
  | { ok: false; error: string };

// Parse + validate a .preset file's text. Returns the presets or a message.
export function parsePresetFile(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
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

// Serialize presets to the versioned .preset JSON text.
export function serializePresets(presets: ConnectionSpec[]): string {
  return JSON.stringify({ version: PRESET_FILE_VERSION, presets }, null, 2);
}

// Download the given presets as a .preset file.
export function downloadPresets(presets: ConnectionSpec[]): void {
  const blob = new Blob([serializePresets(presets)], { type: "application/json" });
  triggerDownload(blob, `nekudot_presets_${timestamp()}.preset`);
}

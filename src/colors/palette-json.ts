import { z } from "zod";
import { hexToOklch, oklchToHex } from "./oklch";
import { clampColors, makeId, normalizeHex, type Palette } from "./palette";
import { normalizeCategory } from "./categories";

// Backup format for export/import: palettes with colours stored in OKLCH
// (perceptual + space-agnostic), so the file is human-editable and matches the
// app's blend space. Round to keep it compact + readable. Pure + framework-free
// so it's trivially unit-testable; the panel handles the file IO around it.

// Hard caps so an imported (possibly hostile or corrupt) file can't exhaust
// memory or wedge the UI. They sit far above any real backup: the app caps a
// palette at MAX_SWATCHES (120) colours and never ships thousands of palettes,
// so a genuine export is never rejected - only pathological input is.
// Shared by the panel as a pre-read file.size cap (bytes ≈ chars for JSON text).
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024; // ~8 MB; real backups are < 1 MB
const MAX_PALETTES = 2000;
const MAX_COLORS_PER_PALETTE = 4096; // >> MAX_SWATCHES; clampColors trims to 120
const MAX_NAME_LEN = 200;
const MAX_ID_LEN = 200;
const MAX_CATEGORY_LEN = 64;

// l/c/h must be finite (z.number() already rejects NaN; .finite() rejects ±∞) so
// no colour can become "#NaNNaNNaN"; oklchToHex clamps the ranges themselves.
const num = z.number().finite();
const OklchSchema = z.object({ l: num, c: num, h: num });
const PaletteJsonSchema = z.object({
  id: z.string().max(MAX_ID_LEN).optional(),
  name: z.string().max(MAX_NAME_LEN),
  category: z.string().max(MAX_CATEGORY_LEN).optional(),
  gradient: z.boolean().optional(),
  colors: z.array(OklchSchema).max(MAX_COLORS_PER_PALETTE),
});
const FileSchema = z.object({
  version: z.number(),
  format: z.literal("oklch").optional(),
  palettes: z.array(PaletteJsonSchema).max(MAX_PALETTES),
});

const round = (n: number, p = 1000) => Math.round(n * p) / p;

export function palettesToOklchJson(palettes: readonly Palette[]): string {
  const data = {
    version: 1,
    format: "oklch" as const,
    palettes: palettes.map((p) => ({
      id: p.id,
      name: p.name,
      category: normalizeCategory(p.category),
      gradient: !!p.gradient,
      colors: p.colors.map((hex) => {
        const o = hexToOklch(normalizeHex(hex) ?? "#000000");
        return { l: round(o.l), c: round(o.c), h: Math.round(o.h) };
      }),
    })),
  };
  return JSON.stringify(data, null, 2);
}

// Parse a backup file into palettes. Returns [] on malformed input; per-palette
// skip-on-error. Colours convert OKLCH -> hex; ids are kept (for merge-by-id) or
// generated when absent.
export function palettesFromOklchJson(text: string): Palette[] {
  // Bail before parsing if the payload is implausibly large (cheap DoS guard).
  if (typeof text !== "string" || text.length > MAX_BACKUP_BYTES) return [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const parsed = FileSchema.safeParse(data);
  if (!parsed.success) return [];
  const out: Palette[] = [];
  for (const p of parsed.data.palettes) {
    const colors = clampColors(p.colors.map((o) => oklchToHex(o)));
    if (!colors.length) continue;
    out.push({
      id: p.id || makeId(),
      name: p.name || "Imported",
      category: normalizeCategory(p.category),
      gradient: !!p.gradient,
      colors,
    });
  }
  return out;
}

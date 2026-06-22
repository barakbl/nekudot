import { z } from "zod";
import { hexToOklch, oklchToHex } from "./oklch";
import { clampColors, makeId, normalizeHex, type Palette } from "./palette";
import { normalizeCategory } from "./categories";

// Backup format for export/import: palettes with colours stored in OKLCH
// (perceptual + space-agnostic), so the file is human-editable and matches the
// app's blend space. Round to keep it compact + readable. Pure + framework-free
// so it's trivially unit-testable; the panel handles the file IO around it.

const OklchSchema = z.object({ l: z.number(), c: z.number(), h: z.number() });
const PaletteJsonSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  category: z.string().optional(),
  gradient: z.boolean().optional(),
  colors: z.array(OklchSchema),
});
const FileSchema = z.object({
  version: z.number(),
  format: z.literal("oklch").optional(),
  palettes: z.array(PaletteJsonSchema),
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

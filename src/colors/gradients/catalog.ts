// The bundled gradient/palette catalog: the .gpl files in this folder plus their
// metadata in settings.json (mood, whether to seed on onboarding, whether they're
// gradient sources). Replaces the old hard-coded sunset/ocean/neon/fire arrays -
// the panel seeds these on first run and lists them in the Import modal.
//
// Each .gpl is inlined at build time (?raw) so the single-file app stays
// self-contained, the same way onboarding bundles its sample artworks.
import { z } from "zod";
import rawSettings from "./settings.json";
import { parseGpl } from "../gpl";
import { normalizeMood } from "../moods";
import type { Palette } from "../palette";

const FILES = import.meta.glob("./*.gpl", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const EntrySchema = z.object({
  file: z.string().min(1),
  mood: z.string(),
  onboarding: z.boolean().default(false),
  gradient: z.boolean().default(true),
  // Optional explicit palette id; defaults to "conn:<basename>" (keeps the old
  // connection gradient ids so saved line-colour selections still resolve).
  id: z.string().optional(),
});

export type CatalogItem = {
  id: string;
  onboarding: boolean;
  palette: Palette; // ready to store: id + name (from the .gpl) + mood + gradient
};

function basename(file: string): string {
  return file.replace(/\.gpl$/i, "");
}

// Parse settings.json + the matching .gpl files into ready-to-store palettes.
// Skips entries whose file is missing or whose .gpl yields no colours.
export function gradientCatalog(): CatalogItem[] {
  const out: CatalogItem[] = [];
  for (const row of rawSettings as unknown[]) {
    const parsed = EntrySchema.safeParse(row);
    if (!parsed.success) continue;
    const e = parsed.data;
    const text = FILES["./" + e.file];
    if (!text) continue;
    const pal = parseGpl(text);
    if (!pal) continue;
    const id = e.id ?? `conn:${basename(e.file)}`;
    out.push({
      id,
      onboarding: e.onboarding,
      palette: { ...pal, id, mood: normalizeMood(e.mood), gradient: e.gradient },
    });
  }
  return out;
}

// The palettes to seed automatically on first run / after a reset.
export function onboardingPalettes(): Palette[] {
  return gradientCatalog()
    .filter((i) => i.onboarding)
    .map((i) => i.palette);
}

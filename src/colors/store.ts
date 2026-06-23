import { z } from "zod";
import { IndexedDbStore } from "../store/indexeddb";
import { clampColors, MAX_RECENT, type Palette } from "./palette";
import { normalizeCategory } from "./categories";
import { onboardingPalettes } from "./gradients/catalog";

// User palettes + the recents stack, persisted in their own IndexedDB so they
// never collide with the paint/connection stores. Sanitize-on-load (drop bad
// rows, keep the rest) since stored rows are untrusted (older code, hand-edited).
//
// There's no longer a built-in/custom split: the default gradients are *seeded*
// into this store on first run (see ensureSeeded) and then behave like any user
// palette. `gradient: true` palettes are also the connection Color dial's sources.
const db = new IndexedDbStore("nekudot-colors", "palettes");
const CUSTOM_KEY = "custom";
const RECENT_KEY = "recent";
const LAST_USED_KEY = "last-used"; // id of the palette last picked from
const SEEDED_KEY = "seeded"; // set once the bundled gradients have been seeded
const LEGACY_BUILTIN_GRADIENTS_KEY = "builtin-gradients"; // removed; cleared on reset

const PaletteSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  colors: z.array(z.string()), // individual colours validated by clampColors
  category: z.string().optional(),
  mood: z.string().optional(), // legacy: pre-rename field, read as a fallback
  gradient: z.boolean().optional(),
});

function rowToPalette(r: z.infer<typeof PaletteSchema>): Palette {
  return {
    id: r.id,
    name: r.name,
    colors: clampColors(r.colors),
    category: normalizeCategory(r.category ?? r.mood), // fall back to legacy "mood"
    gradient: r.gradient ?? false,
  };
}

// Raw read (no seeding) - the seeding path uses this to avoid recursing.
async function readPalettes(): Promise<Palette[]> {
  const raw = await db.get<unknown>(CUSTOM_KEY);
  if (!Array.isArray(raw)) return [];
  const out: Palette[] = [];
  for (const row of raw) {
    const r = PaletteSchema.safeParse(row);
    if (r.success) out.push(rowToPalette(r.data));
  }
  return out;
}

async function writePalettes(palettes: readonly Palette[]): Promise<void> {
  const rows = palettes.map((p) => ({
    id: p.id,
    name: p.name,
    colors: p.colors,
    category: normalizeCategory(p.category),
    gradient: !!p.gradient,
  }));
  await db.put(CUSTOM_KEY, rows);
}

// Seed the bundled onboarding gradients exactly once: first run, after a reset
// (clearColorsStore wipes the flag), or a one-time migration for existing users.
// Idempotent + memoized so concurrent callers (panel load + connection feed)
// trigger a single seed. Existing palettes are kept; only missing seed ids are
// added.
let seedPromise: Promise<void> | null = null;
export function ensureSeeded(): Promise<void> {
  // On failure, clear the cached promise so a later call retries - otherwise a
  // single transient IDB error would leave gradients un-seeded for the whole
  // session (the memoized promise would stay resolved).
  if (!seedPromise) {
    seedPromise = doSeed().catch((e) => {
      console.warn("seed gradients failed", e);
      seedPromise = null;
    });
  }
  return seedPromise;
}
async function doSeed(): Promise<void> {
  if (await db.get<unknown>(SEEDED_KEY)) return;
  const existing = await readPalettes();
  const have = new Set(existing.map((p) => p.id));
  const seeds = onboardingPalettes().filter((p) => !have.has(p.id));
  if (seeds.length) await writePalettes([...seeds, ...existing]);
  await db.put(SEEDED_KEY, true);
}

export async function loadCustomPalettes(): Promise<Palette[]> {
  try {
    await ensureSeeded();
    return await readPalettes();
  } catch (e) {
    console.warn("loadCustomPalettes failed", e);
    return [];
  }
}

export async function saveCustomPalettes(palettes: readonly Palette[]): Promise<void> {
  try {
    await writePalettes(palettes);
  } catch (e) {
    console.warn("saveCustomPalettes failed", e);
  }
}

// Every palette marked as a gradient - the connection Color dial's sources.
export async function loadGradientPalettes(): Promise<Palette[]> {
  try {
    await ensureSeeded();
    return (await readPalettes()).filter((p) => p.gradient);
  } catch (e) {
    console.warn("loadGradientPalettes failed", e);
    return [];
  }
}

// The palette the user most recently picked a colour from, so the panel can float
// it to the top for quick re-access. Just an id; the panel ignores it if no
// palette matches (deleted, etc.).
export async function loadLastUsedPalette(): Promise<string | null> {
  try {
    const raw = await db.get<unknown>(LAST_USED_KEY);
    return typeof raw === "string" && raw ? raw : null;
  } catch (e) {
    console.warn("loadLastUsedPalette failed", e);
    return null;
  }
}

export async function saveLastUsedPalette(id: string): Promise<void> {
  try {
    await db.put(LAST_USED_KEY, id);
  } catch (e) {
    console.warn("saveLastUsedPalette failed", e);
  }
}

export async function loadRecent(): Promise<string[]> {
  try {
    const raw = await db.get<unknown>(RECENT_KEY);
    if (!Array.isArray(raw)) return [];
    return clampColors(raw.filter((x): x is string => typeof x === "string")).slice(0, MAX_RECENT);
  } catch (e) {
    console.warn("loadRecent failed", e);
    return [];
  }
}

export async function saveRecent(colors: readonly string[]): Promise<void> {
  try {
    await db.put(RECENT_KEY, [...colors]);
  } catch (e) {
    console.warn("saveRecent failed", e);
  }
}

// Wipe every colours key so "Reset to default" re-onboards the gradients from
// scratch (this store lives outside localStorage, which runReset clears).
export async function clearColorsStore(): Promise<void> {
  try {
    await Promise.all([
      db.delete(CUSTOM_KEY),
      db.delete(RECENT_KEY),
      db.delete(LAST_USED_KEY),
      db.delete(SEEDED_KEY),
      db.delete(LEGACY_BUILTIN_GRADIENTS_KEY),
    ]);
    seedPromise = null;
  } catch (e) {
    console.warn("clearColorsStore failed", e);
  }
}

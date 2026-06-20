import { z } from "zod";
import { IndexedDbStore } from "../store/indexeddb";
import { builtinPalettes, clampColors, MAX_RECENT, type Palette } from "./palette";

// User-saved custom palettes + the recents stack, persisted in their own
// IndexedDB so they never collide with the paint/connection stores. Mirrors the
// custom-connection-presets pattern (sanitize-on-load: drop bad rows, keep the
// rest), since stored rows are untrusted (older code, hand-edited, etc.).
const db = new IndexedDbStore("nekudot-colors", "palettes");
const CUSTOM_KEY = "custom";
const RECENT_KEY = "recent";
const BUILTIN_GRADIENTS_KEY = "builtin-gradients"; // { [paletteId]: boolean }
const LAST_USED_KEY = "last-used"; // id of the custom palette last picked from

const PaletteSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  colors: z.array(z.string()), // individual colours validated by clampColors
  gradient: z.boolean().optional(),
});

export async function loadCustomPalettes(): Promise<Palette[]> {
  try {
    const raw = await db.get<unknown>(CUSTOM_KEY);
    if (!Array.isArray(raw)) return [];
    const out: Palette[] = [];
    for (const row of raw) {
      const r = PaletteSchema.safeParse(row);
      if (r.success)
        out.push({
          id: r.data.id,
          name: r.data.name,
          colors: clampColors(r.data.colors),
          gradient: r.data.gradient ?? false,
        });
    }
    return out;
  } catch (e) {
    console.warn("loadCustomPalettes failed", e);
    return [];
  }
}

export async function saveCustomPalettes(palettes: readonly Palette[]): Promise<void> {
  try {
    // Strip the `builtin` flag / any extras: only persist user palettes' shape.
    const rows = palettes.map((p) => ({
      id: p.id,
      name: p.name,
      colors: p.colors,
      gradient: !!p.gradient,
    }));
    await db.put(CUSTOM_KEY, rows);
  } catch (e) {
    console.warn("saveCustomPalettes failed", e);
  }
}

// The on/off gradient state for the (regenerated) built-in palettes, keyed by id.
// Absent keys default to true (built-ins are gradients by default).
export async function loadBuiltinGradients(): Promise<Record<string, boolean>> {
  try {
    const raw = await db.get<unknown>(BUILTIN_GRADIENTS_KEY);
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>))
      if (typeof v === "boolean") out[k] = v;
    return out;
  } catch (e) {
    console.warn("loadBuiltinGradients failed", e);
    return {};
  }
}

export async function saveBuiltinGradients(map: Record<string, boolean>): Promise<void> {
  try {
    await db.put(BUILTIN_GRADIENTS_KEY, { ...map });
  } catch (e) {
    console.warn("saveBuiltinGradients failed", e);
  }
}

// Every palette currently marked as a gradient - built-ins (default on, minus any
// toggled off) plus custom palettes with gradient enabled. For consumers
// elsewhere in the app that want to draw with these as gradient sources.
export async function loadGradientPalettes(): Promise<Palette[]> {
  const [customs, overrides] = await Promise.all([
    loadCustomPalettes(),
    loadBuiltinGradients(),
  ]);
  const builtinOn = builtinPalettes().filter((p) => overrides[p.id] ?? true);
  const customOn = customs.filter((p) => p.gradient);
  return [...builtinOn, ...customOn];
}

// The custom palette the user most recently picked a colour from, so the panel
// can float it to the top of the Custom list for quick re-access. Just an id;
// the panel ignores it if no custom palette matches (deleted, etc.).
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

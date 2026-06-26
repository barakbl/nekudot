import { z } from "zod";
import type { ConnectionSpec } from "./brushes/connections/base";
import { parsePresetData, presetsToObject } from "./brushes/connections/preset-io";
import type { Palette } from "./colors/palette";
import {
  palettesFromOklchData,
  palettesToOklchObject,
} from "./colors/palette-json";
import type { Store } from "./store/base";

// The "global settings" backup file: one portable bundle of the user's local
// setup - the Application-settings-panel toggles, their custom connection
// presets, and every saved colour palette. Distinct from the `.nekudot` artwork
// file (a drawing) and the `.preset` file (presets only); this is the whole
// workspace config. Pure + framework-free so it's trivially unit-testable; the
// controller (src/app/settings-io.ts) handles the file IO + stores around it.
//
// Trust boundary: a settings file is made to be shared, so import is hostile
// input. The presets and palettes sections are validated by the SAME parsers
// their own file formats use (parsePresetData / palettesFromOklchData) - so the
// preset `file`-refine + icon-stripping and the palette caps/colour clamping all
// carry over here for free, rather than being re-implemented and drifting.

export const SETTINGS_FILE_VERSION = 1 as const;
export const SETTINGS_FILE_KIND = "nekudot-settings" as const;
export const SETTINGS_FILE_SUFFIX = ".nekudotapp";

// Reject an implausibly large file before reading it into memory (cheap DoS
// guard). Far above any real bundle: presets + palettes are a few KB each.
export const MAX_SETTINGS_BYTES = 8 * 1024 * 1024; // ~8 MB

export const ThemeSchema = z.enum(["auto", "light", "dark"]);

// The Application-settings-panel options the bundle round-trips. All optional:
// import applies only the fields present and a missing one falls back to the
// app default (see settings-io.applyAppSettings). Ephemeral diagnostic
// overrides and per-brush/canvas/colour state are deliberately NOT here -
// "App settings" means the things in the App settings menu.
export const AppSettingsSchema = z.object({
  theme: ThemeSchema.optional(),
  smoothGradients: z.boolean().optional(),
  penEnabled: z.boolean().optional(),
  pixelLog: z.boolean().optional(),
  diagnostics: z.boolean().optional(),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

// The localStorage keys + defaults the Application settings panel owns. The one
// home for the app-setting <-> storage-key mapping; main.ts reads/writes these
// same keys inline on boot, so this list must stay in step with it (the keys and
// the defaults below mirror main.ts's `store.get(...) ?? default`).
const APP_KEYS = {
  theme: "app.theme",
  smoothGradients: "app.gradient.oklch",
  penEnabled: "app.penEnabled",
  pixelLog: "app.pixelLog",
  diagnostics: "app.diag",
} as const;

// Read the EFFECTIVE app settings (stored value or the boot default) so the
// exported file is a complete snapshot, not a sparse one. That way an import is
// a deterministic copy: every toggle ends up matching the file, and there's no
// "the source never touched X, so X silently reverts on the target".
export function readAppSettings(store: Store): AppSettings {
  const theme = store.get<unknown>(APP_KEYS.theme);
  const bool = (key: string, dflt: boolean): boolean => {
    const v = store.get<unknown>(key);
    return typeof v === "boolean" ? v : dflt;
  };
  return {
    theme:
      theme === "auto" || theme === "light" || theme === "dark" ? theme : "auto",
    smoothGradients: bool(APP_KEYS.smoothGradients, true),
    penEnabled: bool(APP_KEYS.penEnabled, true),
    pixelLog: bool(APP_KEYS.pixelLog, false),
    diagnostics: bool(APP_KEYS.diagnostics, false),
  };
}

// Write the bundle's app section back: each known key is set when present and
// removed (not set to undefined - see store/base.ts) when absent, so the result
// matches the file exactly. A removed key falls back to its boot default. The
// caller reloads afterwards, so the live side-effects re-run from boot.
export function applyAppSettings(store: Store, app: AppSettings): void {
  const set = <T>(key: string, val: T | undefined) =>
    val === undefined ? store.remove(key) : store.set(key, val);
  set(APP_KEYS.theme, app.theme);
  set(APP_KEYS.smoothGradients, app.smoothGradients);
  set(APP_KEYS.penEnabled, app.penEnabled);
  set(APP_KEYS.pixelLog, app.pixelLog);
  set(APP_KEYS.diagnostics, app.diagnostics);
}

// The outer envelope. presets/palettes are left as unknown here and handed to
// their own validators below, so this schema only owns the wrapper fields.
const BundleSchema = z.object({
  kind: z.literal(SETTINGS_FILE_KIND),
  version: z.number(),
  savedAt: z.string().optional(),
  app: AppSettingsSchema.optional(),
  presets: z.unknown().optional(),
  palettes: z.unknown().optional(),
});

// A parsed/validated bundle. A section is `undefined` when the file omitted it,
// so the importer can leave that category untouched (vs. an empty replace).
export type SettingsBundle = {
  app?: AppSettings;
  presets?: ConnectionSpec[];
  palettes?: Palette[];
};

export type SettingsParseResult =
  | { ok: true; bundle: SettingsBundle }
  | { ok: false; error: string };

// What goes into the file. Empty sections are omitted (not written as empty
// objects) so a partial file imports as "leave that category alone", and so the
// embedded preset payload never trips its own min(1) presets rule. A normal
// export from readAppSettings always carries a full `app` snapshot.
export function serializeSettingsBundle(
  data: { app: AppSettings; presets: ConnectionSpec[]; palettes: readonly Palette[] },
  savedAt: string,
): string {
  const out: Record<string, unknown> = {
    kind: SETTINGS_FILE_KIND,
    version: SETTINGS_FILE_VERSION,
    savedAt,
  };
  if (Object.keys(data.app).length) out.app = data.app;
  if (data.presets.length) out.presets = presetsToObject(data.presets);
  if (data.palettes.length) out.palettes = palettesToOklchObject(data.palettes);
  return JSON.stringify(out, null, 2);
}

// Parse + validate a settings file's text. All-or-nothing on the envelope and
// on the presets section (matching .preset import); palettes are best-effort
// per-row (matching the palette backup). A present-but-empty section resolves
// to `undefined` so it's treated as "not included".
export function parseSettingsBundle(text: string): SettingsParseResult {
  if (typeof text !== "string" || text.length > MAX_SETTINGS_BYTES)
    return { ok: false, error: "That file is too large to be a settings file." };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }

  const parsed = BundleSchema.safeParse(json);
  if (!parsed.success)
    return { ok: false, error: "That isn't a Nekudot settings file." };
  const data = parsed.data;

  // A file from a newer app may carry a shape this version can't apply safely;
  // refuse rather than silently mis-importing it. Older versions stay readable.
  if (data.version > SETTINGS_FILE_VERSION)
    return {
      ok: false,
      error: "This settings file was made by a newer version of Nekudot.",
    };

  const bundle: SettingsBundle = {};
  if (data.app) bundle.app = data.app;

  if (data.presets !== undefined) {
    const res = parsePresetData(data.presets);
    if (!res.ok)
      return { ok: false, error: `Couldn't read the presets in that file: ${res.error}` };
    if (res.presets.length) bundle.presets = res.presets;
  }

  if (data.palettes !== undefined) {
    const palettes = palettesFromOklchData(data.palettes);
    if (palettes.length) bundle.palettes = palettes;
  }

  return { ok: true, bundle };
}

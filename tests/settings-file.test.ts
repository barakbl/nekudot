import { describe, it, expect } from "vitest";
import {
  serializeSettingsBundle,
  parseSettingsBundle,
  readAppSettings,
  applyAppSettings,
  MAX_SETTINGS_BYTES,
  SETTINGS_FILE_KIND,
  SETTINGS_FILE_VERSION,
  type AppSettings,
} from "../src/settings-file";
import { Store } from "../src/store/base";
import type { ConnectionSpec } from "../src/brushes/connections/base";
import type { Palette } from "../src/colors/palette";

// A DOM-free in-memory Store so the app-settings mapping is testable without
// localStorage. Mirrors LocalStorageStore's get/set/remove contract.
class FakeStore extends Store {
  map = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.map.has(key) ? (this.map.get(key) as T) : undefined;
  }
  set<T>(key: string, value: T): void {
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
}

// The .nekudotapp bundle wraps three already-trusted-or-validated formats: the
// App-settings toggles, the .preset payload, and the OKLCH palette backup. These
// tests pin the wrapper's own rules (kind/version, size guard, present-vs-absent
// sections) and confirm the embedded validators still bite (a bogus preset
// `file` rejects the file; icon markup is stripped).

const APP: AppSettings = {
  theme: "dark",
  smoothGradients: true,
  penEnabled: false,
  pixelLog: false,
  diagnostics: true,
};
const PRESETS: ConnectionSpec[] = [
  { name: "my style", file: "classic.ts", base: "shaded", strokeAlpha: 0.4 },
];
const PALETTES: Palette[] = [
  { id: "p1", name: "Sunny", colors: ["#ff0000", "#00cc44"], gradient: true },
];

const ok = (text: string) => {
  const res = parseSettingsBundle(text);
  if (!res.ok) throw new Error(`expected ok, got: ${res.error}`);
  return res.bundle;
};

describe("settings bundle round-trip", () => {
  it("round-trips app settings, presets and palettes", () => {
    const text = serializeSettingsBundle(
      { app: APP, presets: PRESETS, palettes: PALETTES },
      "2026-06-27T00:00:00.000Z",
    );
    const b = ok(text);
    expect(b.app).toEqual(APP);

    expect(b.presets).toHaveLength(1);
    expect(b.presets?.[0].name).toBe("my style");
    expect(b.presets?.[0].file).toBe("classic.ts");
    expect(b.presets?.[0].base).toBe("shaded");

    expect(b.palettes).toHaveLength(1);
    expect(b.palettes?.[0].id).toBe("p1");
    expect(b.palettes?.[0].name).toBe("Sunny");
    expect(b.palettes?.[0].gradient).toBe(true);
    // Colours survive the OKLCH hop as valid hex (values are near, not exact).
    expect(b.palettes?.[0].colors).toHaveLength(2);
    for (const c of b.palettes?.[0].colors ?? [])
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("omits empty sections, and absent sections parse as undefined", () => {
    const text = serializeSettingsBundle(
      { app: { theme: "light" }, presets: [], palettes: [] },
      "x",
    );
    expect(text).not.toContain("presets");
    expect(text).not.toContain("palettes");
    const b = ok(text);
    expect(b.app).toEqual({ theme: "light" });
    expect(b.presets).toBeUndefined();
    expect(b.palettes).toBeUndefined();
  });
});

describe("settings bundle validation", () => {
  it("rejects non-JSON", () => {
    const res = parseSettingsBundle("not json {");
    expect(res.ok).toBe(false);
  });

  it("rejects a file that isn't a settings bundle (wrong kind)", () => {
    const res = parseSettingsBundle(JSON.stringify({ kind: "something", version: 1 }));
    expect(res.ok).toBe(false);
  });

  it("rejects an implausibly large file before parsing", () => {
    const res = parseSettingsBundle("a".repeat(MAX_SETTINGS_BYTES + 1));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/too large/i);
  });

  it("rejects a file from a newer schema version", () => {
    const text = JSON.stringify({
      kind: SETTINGS_FILE_KIND,
      version: SETTINGS_FILE_VERSION + 1,
      app: { theme: "dark" },
    });
    const res = parseSettingsBundle(text);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/newer version/i);
  });

  it("omits an empty app section, which then parses as absent", () => {
    const text = serializeSettingsBundle({ app: {}, presets: [], palettes: [] }, "x");
    expect(text).not.toContain("app");
    const b = ok(text);
    expect(b.app).toBeUndefined();
  });
});

describe("settings bundle trust boundary", () => {
  it("rejects the whole file when a preset names an unknown module (all-or-nothing)", () => {
    const text = JSON.stringify({
      kind: SETTINGS_FILE_KIND,
      version: 1,
      presets: { version: 1, presets: [{ name: "evil", file: "no-such.ts" }] },
    });
    const res = parseSettingsBundle(text);
    expect(res.ok).toBe(false);
  });

  it("strips icon markup from imported presets (stored-XSS guard)", () => {
    const text = JSON.stringify({
      kind: SETTINGS_FILE_KIND,
      version: 1,
      presets: {
        version: 1,
        presets: [
          { name: "x", file: "classic.ts", icon: `<img src=x onerror="alert(1)">` },
        ],
      },
    });
    const b = ok(text);
    expect(b.presets?.[0].icon).toBeUndefined();
  });

  it("skips empty-colour palette rows but keeps the rest", () => {
    const text = JSON.stringify({
      kind: SETTINGS_FILE_KIND,
      version: 1,
      palettes: {
        version: 1,
        format: "oklch",
        palettes: [
          { name: "good", colors: [{ l: 0.6, c: 0.1, h: 30 }] },
          { name: "empty", colors: [] }, // no colours -> skipped on convert
        ],
      },
    });
    const b = ok(text);
    expect(b.palettes).toHaveLength(1);
    expect(b.palettes?.[0].name).toBe("good");
  });

  it("treats a schema-invalid palettes section as absent (best-effort)", () => {
    const text = JSON.stringify({
      kind: SETTINGS_FILE_KIND,
      version: 1,
      palettes: {
        version: 1,
        format: "oklch",
        palettes: [{ name: "bad", colors: [{ l: "nope", c: 0.1, h: 30 }] }],
      },
    });
    const b = ok(text); // the bundle still loads...
    expect(b.palettes).toBeUndefined(); // ...just with no palettes
  });
});

describe("app settings <-> store mapping", () => {
  it("reads the effective settings (boot defaults when unset)", () => {
    expect(readAppSettings(new FakeStore())).toEqual({
      theme: "auto",
      smoothGradients: true,
      penEnabled: true,
      pixelLog: false,
      diagnostics: false,
    });
  });

  it("reads stored values, including false booleans", () => {
    const store = new FakeStore();
    store.set("app.theme", "dark");
    store.set("app.penEnabled", false); // not the default
    store.set("app.gradient.oklch", false);
    const app = readAppSettings(store);
    expect(app.theme).toBe("dark");
    expect(app.penEnabled).toBe(false);
    expect(app.smoothGradients).toBe(false);
  });

  it("falls back to auto for an invalid stored theme", () => {
    const store = new FakeStore();
    store.set("app.theme", "chartreuse");
    expect(readAppSettings(store).theme).toBe("auto");
  });

  it("applies present keys (incl. false) and removes absent ones", () => {
    const store = new FakeStore();
    store.set("app.penEnabled", false); // pre-existing customisation
    store.set("app.diag", true);
    applyAppSettings(store, { theme: "light", pixelLog: false });
    // present -> written under the exact keys main.ts reads on boot
    expect(store.get("app.theme")).toBe("light");
    expect(store.get("app.pixelLog")).toBe(false);
    // absent -> removed, so boot falls back to the default
    expect(store.map.has("app.penEnabled")).toBe(false);
    expect(store.map.has("app.diag")).toBe(false);
    expect(store.map.has("app.gradient.oklch")).toBe(false);
  });

  it("round-trips a full snapshot through read -> apply -> read", () => {
    const src = new FakeStore();
    src.set("app.theme", "dark");
    src.set("app.gradient.oklch", false);
    src.set("app.penEnabled", false);
    src.set("app.pixelLog", true);
    src.set("app.diag", true);
    const snapshot = readAppSettings(src);

    const dest = new FakeStore();
    applyAppSettings(dest, snapshot);
    expect(readAppSettings(dest)).toEqual(snapshot);
  });
});

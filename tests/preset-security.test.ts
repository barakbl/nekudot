import { describe, it, expect, beforeEach } from "vitest";
import {
  parsePresetFile,
  sanitizeStoredSpecs,
  serializePresets,
} from "../src/brushes/connections/preset-io";
import {
  setCustomPresets,
  connectionGroups,
  createConnection,
} from "../src/brushes/connections/registry";
import type { ConnectionSpec, ConnectionDeps } from "../src/brushes/connections/base";
import type { PaintHost } from "../src/paint-host";

// Preset files are made to be shared, and the menu renders icons via
// innerHTML — so an icon string in a .preset file (or already sitting in the
// persisted IDB array) is a stored-XSS vector. These tests pin the rule:
// markup never crosses the boundary; custom presets get their glyph only via
// `base` (a validated built-in style name).

const XSS = `<img src=x onerror="alert(1)">`;

const presetFile = (spec: Record<string, unknown>) =>
  JSON.stringify({
    version: 1,
    presets: [{ name: "imported", file: "classic.ts", ...spec }],
  });

// The glyph a built-in style shows in the combo (trusted, bundled markup).
const builtinIconOf = (name: string): string => {
  for (const g of connectionGroups()) {
    const def = g.defs.find((d) => d.name === name);
    if (def) return def.icon;
  }
  throw new Error(`built-in not found: ${name}`);
};

// What the Custom group will actually render for the current presets.
const renderedCustomIcon = (): string => {
  const custom = connectionGroups().find((g) => g.group === "Custom")!;
  return custom.defs[0]?.icon ?? "";
};

beforeEach(() => setCustomPresets([]));

describe("preset import (.preset file)", () => {
  it("drops icon markup from imported presets", () => {
    const res = parsePresetFile(presetFile({ icon: XSS }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.presets[0].icon).toBeUndefined();
    expect(res.presets[0].base).toBeUndefined();
    setCustomPresets(res.presets);
    expect(renderedCustomIcon()).not.toContain("onerror");
  });

  it("keeps a valid base and renders the parent's glyph", () => {
    const res = parsePresetFile(presetFile({ base: "shaded" }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.presets[0].base).toBe("shaded");
    setCustomPresets(res.presets);
    expect(renderedCustomIcon()).toBe(builtinIconOf("shaded"));
  });

  it("infers base from a legacy file whose icon is an exact built-in copy", () => {
    const res = parsePresetFile(presetFile({ icon: builtinIconOf("shaded") }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.presets[0].base).toBe("shaded");
    expect(res.presets[0].icon).toBeUndefined();
  });

  it("drops an unknown base (cosmetic) but still rejects an unknown file (behaviour)", () => {
    const cosmetic = parsePresetFile(presetFile({ base: "no-such-style" }));
    expect(cosmetic.ok).toBe(true);
    if (cosmetic.ok) expect(cosmetic.presets[0].base).toBeUndefined();

    const behaviour = parsePresetFile(presetFile({ file: "no-such.ts" }));
    expect(behaviour.ok).toBe(false);
  });
});

describe("persisted presets (IndexedDB array)", () => {
  it("neuters icon markup already in storage and drops junk rows", () => {
    const specs = sanitizeStoredSpecs([
      { name: "poisoned", file: "classic.ts", icon: XSS },
      { name: "legacy", file: "classic.ts", icon: builtinIconOf("web") },
      { garbage: true },
      42,
    ]);
    expect(specs.map((s) => s.name)).toEqual(["poisoned", "legacy"]);
    expect(specs[0].icon).toBeUndefined();
    expect(specs[0].base).toBeUndefined();
    expect(specs[1].base).toBe("web"); // existing users keep their glyph
    expect(sanitizeStoredSpecs("not an array")).toEqual([]);
  });
});

describe("registry as last line of defence", () => {
  it("normalizes specs handed straight to setCustomPresets", () => {
    setCustomPresets([
      { name: "raw", file: "classic.ts", icon: XSS } as ConnectionSpec,
    ]);
    expect(renderedCustomIcon()).not.toContain("onerror");
  });
});

describe("saving presets", () => {
  const host = new Proxy({}, { get: () => () => 0 }) as unknown as PaintHost;
  const deps: ConnectionDeps = { host: () => host, random: () => 0.5 };

  it("records the built-in parent as base (no icon), one hop even when re-saved", () => {
    const conn = createConnection("shaded", deps);
    const saved = conn.toCustomSpec("My Shade", 0.4);
    expect(saved.base).toBe("shaded");
    expect(saved.icon).toBeUndefined();

    // Re-save a preset based on the custom one: base stays the built-in.
    setCustomPresets([saved]);
    const conn2 = createConnection("My Shade", deps);
    const resaved = conn2.toCustomSpec("My Shade copy", 0.4);
    expect(resaved.base).toBe("shaded");
    expect(resaved.info).toBe(saved.info); // still names the original style
  });

  it("export → import round-trips base without any icon field", () => {
    const conn = createConnection("shaded", deps);
    const saved = conn.toCustomSpec("My Shade", 0.4);
    const text = serializePresets([saved]);
    expect(text).not.toContain("<svg");
    const res = parsePresetFile(text);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.presets[0].base).toBe("shaded");
  });
});

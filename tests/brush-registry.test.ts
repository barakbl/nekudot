import { describe, it, expect } from "vitest";
import { BRUSH_DEFS, brushNames, isKnownBrush } from "../src/brushes/registry";
import { PixelLogEntrySchema } from "../src/pixel-log";

describe("brush registry", () => {
  it("has unique names and shortcuts", () => {
    const names = brushNames();
    expect(new Set(names).size).toBe(names.length);
    const shortcuts = BRUSH_DEFS.map((d) => d.shortcut).filter(Boolean);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });

  it("isKnownBrush matches the registry", () => {
    for (const n of brushNames()) expect(isKnownBrush(n)).toBe(true);
    expect(isKnownBrush("Not A Brush")).toBe(false);
    expect(isKnownBrush("")).toBe(false);
  });
});

describe("pixel-log brush_type validation (registry-backed)", () => {
  const entry = (brush_type: string) => ({
    brush_type,
    dash: "solid" as const,
    width: 2,
    x: 1,
    y: 2,
    layer_id: "L1",
    pixel_map_id: "M1",
  });

  it("accepts every registered brush", () => {
    for (const n of brushNames()) {
      expect(PixelLogEntrySchema.safeParse(entry(n)).success).toBe(true);
    }
  });

  it("rejects an unknown brush (so injected/legacy rows are dropped)", () => {
    expect(PixelLogEntrySchema.safeParse(entry("Ghost Brush")).success).toBe(false);
    expect(PixelLogEntrySchema.safeParse(entry("")).success).toBe(false);
  });
});

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

  it("lists each menu group in shortcut order (drives the toolbar menu order)", () => {
    // BRUSH_DEFS order IS the menu order (consecutive same-group entries are
    // wrapped into a sub-group), so within every group shortcuts must ascend; a
    // brush with no shortcut (the Eraser) sorts last.
    const groups = new Map<string, number[]>();
    for (const d of BRUSH_DEFS) {
      const g = d.menuGroup ?? "(top)";
      const rank = d.shortcut ? parseInt(d.shortcut, 10) : Infinity;
      (groups.get(g) ?? groups.set(g, []).get(g)!).push(rank);
    }
    for (const [, ranks] of groups) {
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
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

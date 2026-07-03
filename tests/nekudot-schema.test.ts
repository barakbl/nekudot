import { describe, it, expect } from "vitest";
import { NeighborsMapPixelsSchema, MAX_MAP_COORD } from "../src/nekudot-schema";

// A neighbors-map file is a list of dots; a corrupt one must not slip absurd
// coordinates into the point cloud. z.number() already rejects NaN/Infinity
// (a JSON "1e999" parses to Infinity), and the magnitude bound catches
// finite-but-nonsense values.
describe("NeighborsMapPixelsSchema", () => {
  it("accepts finite dots, with or without a colour", () => {
    const r = NeighborsMapPixelsSchema.safeParse([
      { x: 1, y: 2 },
      { x: -5, y: 0, color: "#abc" },
    ]);
    expect(r.success).toBe(true);
  });

  it("rejects non-finite coordinates (NaN / Infinity, incl. a JSON 1e999)", () => {
    const bad = [{ x: NaN, y: 0 }, { x: 0, y: Infinity }, JSON.parse('{"x":1e999,"y":0}')];
    for (const p of bad) {
      expect(NeighborsMapPixelsSchema.safeParse([p]).success).toBe(false);
    }
  });

  it("rejects finite-but-absurd coordinates beyond the sane bound", () => {
    expect(NeighborsMapPixelsSchema.safeParse([{ x: MAX_MAP_COORD + 1, y: 0 }]).success).toBe(false);
    expect(NeighborsMapPixelsSchema.safeParse([{ x: 0, y: -MAX_MAP_COORD - 1 }]).success).toBe(false);
  });

  it("rejects an over-long colour string", () => {
    expect(
      NeighborsMapPixelsSchema.safeParse([{ x: 0, y: 0, color: "x".repeat(65) }]).success,
    ).toBe(false);
  });
});

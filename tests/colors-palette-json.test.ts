import { describe, it, expect } from "vitest";
import { palettesToOklchJson, palettesFromOklchJson } from "../src/colors/palette-json";
import type { Palette } from "../src/colors/palette";

const sample: Palette[] = [
  { id: "p1", name: "Sunset", category: "HOT", gradient: true, colors: ["#ff5e62", "#ffd194"] },
  { id: "p2", name: "Plain", category: "GENERAL", gradient: false, colors: ["#ffffff", "#000000"] },
];

describe("palette OKLCH JSON export/import", () => {
  it("serializes to an oklch-tagged JSON with l/c/h colours", () => {
    const json = JSON.parse(palettesToOklchJson(sample));
    expect(json.format).toBe("oklch");
    expect(json.palettes).toHaveLength(2);
    expect(json.palettes[0]).toMatchObject({ id: "p1", name: "Sunset", category: "HOT", gradient: true });
    expect(json.palettes[0].colors[0]).toEqual(
      expect.objectContaining({ l: expect.any(Number), c: expect.any(Number), h: expect.any(Number) }),
    );
  });

  it("round-trips structure + near-identical colours", () => {
    const back = palettesFromOklchJson(palettesToOklchJson(sample));
    expect(back.map((p) => ({ id: p.id, name: p.name, category: p.category, gradient: p.gradient }))).toEqual([
      { id: "p1", name: "Sunset", category: "HOT", gradient: true },
      { id: "p2", name: "Plain", category: "GENERAL", gradient: false },
    ]);
    for (const p of back) for (const c of p.colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    expect(back[0].colors).toHaveLength(2);
    // Pure black/white survive the OKLCH round-trip exactly.
    expect(back[1].colors).toEqual(["#ffffff", "#000000"]);
  });

  it("coerces an unknown category to GENERAL and generates a missing id", () => {
    const json = JSON.stringify({
      version: 1,
      palettes: [{ name: "X", category: "BOGUS", colors: [{ l: 0.5, c: 0.1, h: 30 }] }],
    });
    const [p] = palettesFromOklchJson(json);
    expect(p.category).toBe("GENERAL");
    expect(p.id).toBeTruthy();
  });

  it("returns [] for malformed input", () => {
    expect(palettesFromOklchJson("not json")).toEqual([]);
    expect(palettesFromOklchJson(JSON.stringify({ nope: 1 }))).toEqual([]);
  });

  it("rejects non-finite colour components (no #NaNNaNNaN)", () => {
    for (const bad of [NaN, Infinity, -Infinity, "0.5"]) {
      const json = JSON.stringify({
        version: 1,
        palettes: [{ name: "X", colors: [{ l: bad, c: 0.1, h: 30 }] }],
      });
      expect(palettesFromOklchJson(json)).toEqual([]);
    }
  });

  it("rejects oversized payloads, arrays and strings", () => {
    // Over the input-size guard.
    expect(palettesFromOklchJson(" ".repeat(8 * 1024 * 1024 + 1))).toEqual([]);
    // Too many palettes / colours / over-long name -> whole file rejected.
    const many = (n: number) => Array.from({ length: n }, () => ({ l: 0.5, c: 0.1, h: 30 }));
    expect(
      palettesFromOklchJson(
        JSON.stringify({ version: 1, palettes: [{ name: "X", colors: many(4097) }] }),
      ),
    ).toEqual([]);
    expect(
      palettesFromOklchJson(
        JSON.stringify({ version: 1, palettes: [{ name: "x".repeat(201), colors: many(1) }] }),
      ),
    ).toEqual([]);
  });

  it("does not pollute Object.prototype via __proto__ keys", () => {
    const json = `{"version":1,"palettes":[{"name":"X","colors":[{"l":0.5,"c":0.1,"h":30}],"__proto__":{"polluted":true}}]}`;
    palettesFromOklchJson(json);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

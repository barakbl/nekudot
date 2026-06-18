import { describe, it, expect } from "vitest";
import { ConnectionBase } from "../src/brushes/connections/base";
import { mixHex, hueHex } from "../src/brushes/color-source";
import type { Pixel } from "../src/neighbor-finder";

// The gradient / palette connection colour source: per-line colour from the
// line's angle (0..1 around the circle). main -> undefined (Primary strokeStyle);
// secondary -> the secondary hex; gradient -> lerp(Primary, Secondary); rainbow
// -> hue.

const store = {
  get: (k: string) => (k === "app.color.main" ? "#000000" : "#ffffff"),
  set() {},
};

// Four neighbours around (50,50): right / up / left / down -> 0, 90, 180, 270
// degrees (the colour is driven by each line's angle).
const NEIGHBOURS: Pixel[] = [
  { id: 1, x: 80, y: 50 },
  { id: 2, x: 50, y: 90 },
  { id: 3, x: 20, y: 50 },
  { id: 4, x: 50, y: 30 },
];

function colorsFor(flat: Record<string, string | number | boolean>): (string | undefined)[] {
  const drawn: (string | undefined)[] = [];
  const host = {
    findNeighbors: () => NEIGHBOURS,
    findNeighborsInMap: () => NEIGHBOURS,
    pixelCount: () => 100,
    mapSize: () => 100,
    activeConnectionLayerId: () => "L1",
    drawConnectionToLayer: (
      _id: string,
      _p1: Pixel,
      _p2: Pixel,
      style: { color?: string },
    ) => drawn.push(style.color),
  } as never;
  const c = new ConnectionBase({ host: () => host, store, random: () => 0.5 } as never, {
    name: "t",
    file: "classic.ts",
    defaults: {},
  });
  c.applyFlat({ density: 100, radius: 120, alpha: 1, strands: 1, fade: 0, minDist: 0, ...flat });
  c.connect({ id: 0, x: 50, y: 50 });
  return drawn;
}
const distinct = (xs: (string | undefined)[]) => new Set(xs).size;

describe("color maths", () => {
  it("mixHex blends linearly and clamps", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mixHex("#000000", "#ffffff", 2)).toBe("#ffffff"); // clamped
  });
  it("hueHex gives distinct valid hexes around the wheel", () => {
    for (const d of [0, 120, 240]) expect(hueHex(d)).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set([hueHex(0), hueHex(120), hueHex(240)]).size).toBe(3);
  });
});

describe("connection colour source", () => {
  it("main -> undefined (renderer uses the Primary strokeStyle)", () => {
    const c = colorsFor({ color: "main" });
    expect(c.length).toBe(4);
    expect(c.every((x) => x === undefined)).toBe(true);
  });

  it("secondary -> the secondary hex on every line", () => {
    expect(colorsFor({ color: "secondary" })).toEqual(["#ffffff", "#ffffff", "#ffffff", "#ffffff"]);
  });

  it("gradient -> distinct Primary..Secondary blends by angle", () => {
    const c = colorsFor({ color: "gradient" });
    expect(distinct(c)).toBe(4); // four lines, four angles
    expect(c.every((x) => /^#[0-9a-f]{6}$/.test(x ?? ""))).toBe(true);
  });

  it("rainbow -> distinct hues by angle", () => {
    const c = colorsFor({ color: "rainbow" });
    expect(distinct(c)).toBe(4);
  });
});

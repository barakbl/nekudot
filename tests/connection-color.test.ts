import { describe, it, expect } from "vitest";
import { ConnectionBase } from "../src/brushes/connections/base";
import { headingToT, wrap01 } from "../src/brushes/color-source";
import {
  mixHex,
  hueHex,
  connectionLineColor,
  setGradientPalettes,
} from "../src/brushes/color-source";
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

  it("gradient -> cyclic Primary..Secondary blends by angle (seamless)", () => {
    const c = colorsFor({ color: "gradient" });
    // The gradient source is cyclic, so it mirrors around the wrap. The four
    // fixed angles (t = 0.25/0.5/0.75/1.0) give the two midpoints (0.25 and 0.75
    // coincide), Secondary (0.5) and Primary (1.0) -> 3 distinct.
    expect(distinct(c)).toBeGreaterThanOrEqual(3);
    expect(c.every((x) => /^#[0-9a-f]{6}$/.test(x ?? ""))).toBe(true);
  });

  it("rainbow -> distinct hues by angle", () => {
    const c = colorsFor({ color: "rainbow" });
    expect(distinct(c)).toBe(4);
  });
});

// "From mark": each web line inherits the colour stored on the points it bridges
// (e.g. Color Pen anchors), instead of computing one from the line angle.
describe("'From mark' connection colour source", () => {
  const COLORED: Pixel[] = [
    { id: 1, x: 80, y: 50, color: "#ff0000" },
    { id: 2, x: 50, y: 90, color: "#00ff00" },
    { id: 3, x: 20, y: 50, color: "#0000ff" },
    { id: 4, x: 50, y: 30 }, // no stored colour
  ];
  function pointsColors(current: Pixel): (string | undefined)[] {
    const drawn: (string | undefined)[] = [];
    const host = {
      findNeighbors: () => COLORED,
      findNeighborsInMap: () => COLORED,
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
    c.applyFlat({ density: 100, radius: 120, alpha: 1, strands: 1, fade: 0, minDist: 0, color: "points" });
    c.connect(current);
    return drawn;
  }

  it("an uncoloured stroke point takes each neighbour's stored colour (undefined when it has none)", () => {
    expect(pointsColors({ id: 0, x: 50, y: 50 })).toEqual([
      "#ff0000",
      "#00ff00",
      "#0000ff",
      undefined,
    ]);
  });

  it("two coloured endpoints blend at the midpoint", () => {
    // current is black; each coloured neighbour mixes 50/50 with it, the
    // uncoloured one falls back to current's colour.
    expect(pointsColors({ id: 0, x: 50, y: 50, color: "#000000" })).toEqual([
      "#800000",
      "#008000",
      "#000080",
      "#000000",
    ]);
  });
});

// The colour-direction wheel: "Colour follows hand" (colorTravel) drives the
// gradient by the stroke's heading instead of each line's angle, and colorAngle
// rotates the map.
describe("connection colour-direction wheel", () => {
  function drawTravel(
    flat: Record<string, string | number | boolean>,
    from: [number, number],
    to: [number, number],
  ): (string | undefined)[] {
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
    c.beforeDeposit(...from); // establishes the previous sample
    c.beforeDeposit(...to); // sets the travel heading
    c.connect({ id: 0, x: to[0], y: to[1] });
    return drawn;
  }

  it("colorTravel colours every line by the hand heading (one hue), not the angle", () => {
    // Hand moving right -> all four lines share the rightward hue.
    const travel = drawTravel({ color: "rainbow", colorTravel: true }, [40, 50], [50, 50]);
    expect(travel.length).toBe(4);
    expect(new Set(travel).size).toBe(1);
    // Default (by line angle) still spreads across the wheel.
    const byAngle = drawTravel({ color: "rainbow", colorTravel: false }, [40, 50], [50, 50]);
    expect(new Set(byAngle).size).toBe(4);
  });

  it("colorAngle rotates the map (180deg shifts the travel hue)", () => {
    const a = drawTravel({ color: "rainbow", colorTravel: true, colorAngle: 0 }, [40, 50], [50, 50])[0];
    const b = drawTravel({ color: "rainbow", colorTravel: true, colorAngle: 180 }, [40, 50], [50, 50])[0];
    expect(a).not.toBe(b);
  });

  it("relative-to-start gives the same colour whichever way the gesture faces", () => {
    // First moving segment anchors the hue, so a one-segment stroke is the start
    // colour regardless of compass direction.
    const right = drawTravel({ color: "rainbow", colorTravel: true, colorRelative: true }, [40, 50], [50, 50])[0];
    const down = drawTravel({ color: "rainbow", colorTravel: true, colorRelative: true }, [50, 40], [50, 50])[0];
    expect(right).toBe(down);
    // Absolute (default): the two facings give different hues.
    const rightAbs = drawTravel({ color: "rainbow", colorTravel: true, colorRelative: false }, [40, 50], [50, 50])[0];
    const downAbs = drawTravel({ color: "rainbow", colorTravel: true, colorRelative: false }, [50, 40], [50, 50])[0];
    expect(rightAbs).not.toBe(downAbs);
  });
});

// headingToT is the shared direction -> palette-position map (Range then Rotate)
// used by both the Color Pen and the web, so the disc preview matches the draw.
describe("headingToT (Range + Rotate mapping)", () => {
  it("wrap01 folds into [0,1)", () => {
    expect(wrap01(0.25)).toBeCloseTo(0.25);
    expect(wrap01(1.25)).toBeCloseTo(0.25);
    expect(wrap01(-0.1)).toBeCloseTo(0.9);
  });
  it("range=1, angle=0 is identity", () => {
    expect(headingToT(0.5, 1, 0)).toBeCloseTo(0.5);
    expect(headingToT(0.25, 1, 0)).toBeCloseTo(0.25);
  });
  it("range<1 compresses the palette span around 0", () => {
    expect(headingToT(0.5, 0.5, 0)).toBeCloseTo(0.25);
    expect(headingToT(1.0, 0.25, 0)).toBeCloseTo(0.25);
  });
  it("angle rotates and wraps", () => {
    expect(headingToT(0.5, 1, 180)).toBeCloseTo(0); // 0.5 + 0.5 -> wraps to 0
    expect(headingToT(0.25, 1, 90)).toBeCloseTo(0.5); // 0.25 + 0.25
  });
});

// Links (k-nearest): cap each point to its N nearest in-range neighbours.
function linkedTo(links: number): { x: number; y: number }[] {
  const drawn: { x: number; y: number }[] = [];
  const host = {
    findNeighbors: () => NEIGHBOURS,
    findNeighborsInMap: () => NEIGHBOURS,
    pixelCount: () => 100,
    mapSize: () => 100,
    activeConnectionLayerId: () => "L1",
    drawConnectionToLayer: (_id: string, _p1: Pixel, p2: Pixel) => drawn.push({ x: p2.x, y: p2.y }),
  } as never;
  const c = new ConnectionBase({ host: () => host, store, random: () => 0.5 } as never, {
    name: "t",
    file: "classic.ts",
    defaults: {},
  });
  c.applyFlat({ density: 100, radius: 120, alpha: 1, strands: 1, fade: 0, minDist: 0, color: "main", links });
  c.connect({ id: 0, x: 50, y: 50 });
  return drawn;
}

describe("connectionLineColor (palettes + complement)", () => {
  const hex = /^#[0-9a-f]{6}$/;
  it("main -> undefined; secondary -> the secondary hex", () => {
    expect(connectionLineColor("main", 0.3, "#111111", "#eeeeee")).toBeUndefined();
    expect(connectionLineColor("secondary", 0.3, "#111111", "#eeeeee")).toBe("#eeeeee");
  });
  it("a curated palette gives distinct valid colours across the circle", () => {
    // Gradients arrive via the palette mechanism; legacy "sunset" -> conn:sunset.
    setGradientPalettes([
      { id: "conn:sunset", label: "Sunset", colors: ["#ff5e62", "#ff9966", "#ffd194", "#fde9b0"] },
    ]);
    const cs = [0, 0.25, 0.5, 0.75].map((t) => connectionLineColor("sunset", t, "#000000", "#ffffff"));
    expect(cs.every((c) => hex.test(c ?? ""))).toBe(true);
    expect(new Set(cs).size).toBeGreaterThan(2);
  });
  it("complement runs Primary <-> its opposite hue", () => {
    expect(connectionLineColor("complement", 0, "#ff0000", "#000000")).toBe("#ff0000"); // t=0 -> Primary
    const opp = connectionLineColor("complement", 0.5, "#ff0000", "#000000");
    expect(hex.test(opp ?? "")).toBe(true);
    expect(opp).not.toBe("#ff0000"); // the opposite hue
  });
  it("an unknown source falls back to the Primary strokeStyle (undefined)", () => {
    expect(connectionLineColor("bogus", 0.3, "#111111", "#eeeeee")).toBeUndefined();
  });
});

describe("connection Links (k-nearest)", () => {
  it("0 connects to every in-range neighbour", () => {
    expect(linkedTo(0).length).toBe(4); // distances 30/40/30/20
  });
  it("caps to the N nearest, dropping the far ones", () => {
    expect(linkedTo(1)).toEqual([{ x: 50, y: 30 }]); // the nearest (dist 20)
    const two = linkedTo(2);
    expect(two.length).toBe(2);
    expect(two).toContainEqual({ x: 50, y: 30 }); // nearest kept
    expect(two).not.toContainEqual({ x: 50, y: 90 }); // farthest (40) dropped
  });
});

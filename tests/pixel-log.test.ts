import { describe, it, expect } from "vitest";
import { PixelLog } from "../src/pixel-log";
import { brushNames } from "../src/brushes/registry";

const BRUSH = brushNames()[0];
const row = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    brush_type: BRUSH,
    dash: "solid",
    width: 2,
    x: 10,
    y: 20,
    layer_id: "L1",
    pixel_map_id: "M1",
    ...over,
  });

describe("PixelLog.loadRawJSONL — validates untrusted .nekudot input", () => {
  it("keeps valid rows and drops every kind of bad one", async () => {
    const log = new PixelLog();
    const text = [
      row(), // ok
      row({ x: -5, y: 5 }), // ok (negative within bounds)
      "{ not json", // unparseable
      row({ brush_type: "Ghost Brush" }), // unknown brush
      row({ x: 1e9 }), // coordinate out of range
      row({ width: -1 }), // negative width
      row({ dash: "zigzag" }), // bad enum
      JSON.stringify({ brush_type: BRUSH }), // missing fields
      "", // blank line
    ].join("\n");
    await log.loadRawJSONL(text);
    expect(log.count).toBe(2);
  });

  it("drops everything from a garbage blob", async () => {
    const log = new PixelLog();
    await log.loadRawJSONL("garbage\n{}\n[1,2,3]\n42");
    expect(log.count).toBe(0);
  });

  it("round-trips valid rows through toJSONL", async () => {
    const log = new PixelLog();
    await log.loadRawJSONL([row(), row({ x: 1, y: 2 })].join("\n"));
    const out = log.toJSONL().trim().split("\n");
    expect(out.length).toBe(2);
    expect(JSON.parse(out[0]).brush_type).toBe(BRUSH);
  });
});

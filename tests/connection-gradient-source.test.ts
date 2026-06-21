import { describe, it, expect } from "vitest";
import {
  connectionColorLabels,
  connectionColorOptions,
  connectionLineColor,
  normalizeColorSource,
  setGradientPalettes,
} from "../src/brushes/color-source";

const hex = /^#[0-9a-f]{6}$/;

// The connection Color dial's gradients come entirely from the palette mechanism
// (setGradientPalettes) - they're no longer hard-coded here; the defaults are
// seeded into the palette store and fed in by main.ts. So this module starts with
// only the static sources until a feed arrives.
describe("connection gradient sources (driven by the palette mechanism)", () => {
  it("defaults to just the static sources (no gradients until fed)", () => {
    const opts = connectionColorOptions();
    expect(opts).toEqual(["main", "secondary", "gradient", "rainbow", "complement"]);
  });

  it("maps legacy names to ids and resolves them once fed", () => {
    expect(normalizeColorSource("sunset")).toBe("conn:sunset");
    setGradientPalettes([
      { id: "conn:sunset", label: "Sunset", colors: ["#ff5e62", "#ffd194"] },
    ]);
    expect(connectionLineColor("sunset", 0.3, "#000000", "#ffffff")).toMatch(hex);
  });

  it("feeding activated palettes drives the options, labels and line colour", () => {
    setGradientPalettes([{ id: "p1", label: "Mine", colors: ["#ff0000", "#00ff00", "#0000ff"] }]);
    const opts = connectionColorOptions();
    expect(opts).toContain("p1");
    expect(opts).not.toContain("conn:sunset"); // replaced by the activated set
    expect(opts.slice(0, 5)).toEqual(["main", "secondary", "gradient", "rainbow", "complement"]);
    expect(connectionColorLabels().p1).toBe("Mine");
    expect(connectionLineColor("p1", 0.5, "#000000", "#ffffff")).toMatch(hex);
  });

  it("drops empty palettes", () => {
    setGradientPalettes([
      { id: "empty", label: "E", colors: [] },
      { id: "ok", label: "OK", colors: ["#123456"] },
    ]);
    const opts = connectionColorOptions();
    expect(opts).toContain("ok");
    expect(opts).not.toContain("empty");
  });
});

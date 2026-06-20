import { describe, it, expect } from "vitest";
import {
  connectionColorLabels,
  connectionColorOptions,
  connectionLineColor,
  normalizeColorSource,
  setGradientPalettes,
} from "../src/brushes/color-source";

const hex = /^#[0-9a-f]{6}$/;

// The connection Color dial's gradients now come from the palette mechanism
// (setGradientPalettes), not a hard-coded list. The module seeds itself with the
// built-in connection gradients so this runs in order: defaults first, then a
// feed replaces them.
describe("connection gradient sources (driven by the palette mechanism)", () => {
  it("defaults to the static sources + the built-in connection gradients", () => {
    const opts = connectionColorOptions();
    expect(opts.slice(0, 5)).toEqual(["main", "secondary", "gradient", "rainbow", "complement"]);
    expect(opts).toEqual(
      expect.arrayContaining(["conn:sunset", "conn:ocean", "conn:neon", "conn:fire"]),
    );
  });

  it("maps legacy names to ids and still resolves them", () => {
    expect(normalizeColorSource("sunset")).toBe("conn:sunset");
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

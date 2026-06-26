import { describe, it, expect, beforeEach, afterEach } from "vitest";

// A5: the live 256-step connection LUT and the cyclic two-colour sources
// (brushes/color-source) re-derive their colours from colors/gradient.paletteHex
// via hand-rolled LUT-index quantisation - nothing enforced that they stay a
// faithful cache of it. These lock the LIVE path (the LUT, its floor index math,
// the blend-space wiring, and the cyclic two-colour sources) to that one source.
// The panel preview swatches are deliberately linear (cyclic=false) and are NOT
// asserted equal here.
import {
  setGradientPalettes,
  setGradientSpace,
  connectionLineColor,
} from "../src/brushes/color-source";
import { paletteHex, type GradientSpace } from "../src/colors/gradient";

const PALETTE = {
  id: "test:fidelity",
  label: "Fidelity",
  colors: ["#1a0500", "#7a1500", "#d4451a", "#ff8c1a", "#ffe34d"],
};
const PRIMARY = "#3366cc";
const SECONDARY = "#cc6633";

describe("connection LUT fidelity (A5)", () => {
  beforeEach(() => {
    setGradientSpace("oklch");
    setGradientPalettes([PALETTE]);
  });
  afterEach(() => {
    setGradientPalettes([]);
    setGradientSpace("oklch");
  });

  for (const space of ["oklch", "srgb"] as GradientSpace[]) {
    it(`palette LUT reproduces paletteHex at every one of the 256 steps (${space})`, () => {
      setGradientSpace(space);
      for (let k = 0; k < 256; k++) {
        const t = k / 256;
        expect(connectionLineColor(PALETTE.id, t, PRIMARY, SECONDARY)).toBe(
          paletteHex(PALETTE.colors, t, space, true),
        );
      }
    });
  }

  it("palette source is seamless at the angle wrap (t=1 == t=0)", () => {
    expect(connectionLineColor(PALETTE.id, 1, PRIMARY, SECONDARY)).toBe(
      connectionLineColor(PALETTE.id, 0, PRIMARY, SECONDARY),
    );
  });

  it("an off-grid driver t reads the floor-quantised LUT step (pins the index math)", () => {
    // A driver t between sample points maps to floor(t*256): the LUT is a
    // left-step lookup, not interpolated or rounded. A floor->round/ceil
    // regression would land on the next step and fail this.
    const t = 3.6 / 256; // between steps 3 and 4
    const step = Math.floor((((t % 1) + 1) % 1) * 256) % 256;
    expect(step).toBe(3);
    // Steps 3 and 4 differ here, so floor vs round is observable.
    expect(paletteHex(PALETTE.colors, 3 / 256, "oklch", true)).not.toBe(
      paletteHex(PALETTE.colors, 4 / 256, "oklch", true),
    );
    expect(connectionLineColor(PALETTE.id, t, PRIMARY, SECONDARY)).toBe(
      paletteHex(PALETTE.colors, step / 256, "oklch", true),
    );
  });

  it("switching blend space rebuilds the LUT (oklch keeps blue+yellow coloured, srgb greys it)", () => {
    setGradientPalettes([{ id: "test:by", label: "BY", colors: ["#0000ff", "#ffff00"] }]);
    const t = 0.25; // midpoint of stop0 -> stop1 for a 2-stop cyclic palette
    // (beforeEach left the space on oklch; setGradientPalettes above built the LUT)
    const ok = connectionLineColor("test:by", t, PRIMARY, SECONDARY)!;
    expect(ok).toBe(paletteHex(["#0000ff", "#ffff00"], t, "oklch", true));
    setGradientSpace("srgb");
    const sr = connectionLineColor("test:by", t, PRIMARY, SECONDARY)!;
    expect(sr).toBe(paletteHex(["#0000ff", "#ffff00"], t, "srgb", true));
    expect(sr).not.toBe(ok);
  });

  it("the two-colour gradient source is cyclic/seamless (matches paletteHex)", () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(connectionLineColor("gradient", t, PRIMARY, SECONDARY)).toBe(
        paletteHex([PRIMARY, SECONDARY], t, "oklch", true),
      );
    }
    // Seamless: the wrap (t=1) returns to the t=0 colour - no hard flip.
    expect(connectionLineColor("gradient", 1, PRIMARY, SECONDARY)).toBe(
      connectionLineColor("gradient", 0, PRIMARY, SECONDARY),
    );
  });
});

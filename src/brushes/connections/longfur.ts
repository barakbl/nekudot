// Port of the longfur brush of Harmony by mr.doob (Ricardo Cabello) -
// https://github.com/mrdoob/harmony (GPL-3-or-later).
import { ConnectionBase } from "./base";
import type { ConnectingFlat } from "../../connecting-types";
import type { LineStyle } from "../../renderer";
import type { Pixel } from "../../neighbor-finder";
import type { BrushSetting } from "../../base";

// Longfur: a port of mr.doob's Harmony "longfur" brush. Like fur it draws a hair
// to each nearby dot, but every hair OVERSHOOTS both ends by a random fraction of
// its own length (Harmony's symmetric `size = -Math.random()`) and frays its far
// tip a couple of px - so the strands run long and wispy past the dots they
// bridge instead of ending taut between them. Faint (0.05) over a wide reach, so
// the overlapping strands pile into a soft long-furred pelt as you draw back over
// your own points. Reach 55 ≈ Harmony's d < 4000 link distance; the Length dial
// is the overshoot amount (0 = a plain web of straight links).
export const icon =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M2 14 Q5 6 7 2 M5 14 Q7 7 10 3 M8 14 Q10 8 13 4 M11 14 Q12.5 9 14 6"/></svg>';

export default class LongFurConnection extends ConnectionBase {
  protected defaults(): ConnectingFlat {
    return {
      alpha: 0.06,
      color: "main",
      connect: "line",
      dash: "solid",
      density: 65,
      radius: 55,
      minDist: 0,
      inset: 0,
      // Far links fade out (approximates Harmony's rand > d/4000 distance odds).
      fade: 0.5,
      strands: 1,
      spread: 6,
      scatter: 0,
      taper: 0,
      flow: 0,
      fray: 0,
      length: 0.8, // overshoot amount - the signature Length dial (0 = plain web)
      wave: 0,
      dynamics: 0,
      curl: 0,
      grainStrength: 0,
      grainAngle: 0,
      grainCross: false,
    };
  }

  // Keep the signature Length (overshoot) dial on the open shelf.
  defaultOpenKeys(): readonly string[] {
    return [...super.defaultOpenKeys(), "length"];
  }

  // "Length" reuses the base's `length` field (its only consumer here is the
  // overshoot below - the fanned `grow` path never runs at Weight 1).
  protected extraSliders(): BrushSetting[] {
    return [this.numStyle("length", "Length", 0, 1.5, 0.05)];
  }

  // Every hair overshoots both ends by `length` × a per-hair random fraction of
  // its length (Harmony's symmetric size = -Math.random()) and frays its far tip
  // by a couple of px, so a taut dot-to-dot link becomes a long wispy strand.
  // Length 0 is a plain web. Works at any Weight: the base routes both the single
  // line and each fanned hair through drawConnection.
  protected drawConnection(p1: Pixel, p2: Pixel, style: LineStyle): void {
    const grow = this.connectLength;
    if (grow <= 0) {
      super.drawConnection(p1, p2, style);
      return;
    }
    const hx = p2.x - p1.x;
    const hy = p2.y - p1.y;
    const s = grow * this.random(); // how far each end overshoots (fraction of length)
    const jx = grow * (this.random() * 2 - 1); // frayed far tip
    const jy = grow * (this.random() * 2 - 1);
    super.drawConnection(
      { ...p1, x: p1.x - hx * s, y: p1.y - hy * s },
      { ...p2, x: p2.x + hx * s + jx, y: p2.y + hy * s + jy },
      style,
    );
  }
}

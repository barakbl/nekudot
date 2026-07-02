import { ConnectionBase } from "./base";
import type { ConnectingFlat } from "../../connecting-types";
import type { LineStyle } from "../../renderer";
import type { BrushSetting } from "../../base";

// Combed pelt: dense soft guard hairs that lie along the grain, taper to nothing
// at the tip, sweep the same way (combed) with a little wave for life, overshoot
// the dot cloud (length) and end at staggered lengths (fray) so the silhouette
// breaks into flowing strands instead of forming a blunt band.
export const icon =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M3 13 Q4 7 5 4 M6 13 Q7 7 8 4 M9 13 Q10 7 11 4 M12 13 Q12.5 8 13 5"/></svg>';

export default class FurConnection extends ConnectionBase {
  protected defaults(): ConnectingFlat {
    return {
      alpha: 0.13,
      color: "main",
      connect: "line",
      dash: "solid",
      density: 62,
      radius: 26,
      minDist: 4,
      inset: 0,
      fade: 0.2,
      strands: 7,
      spread: 11,
      scatter: 0.18,
      taper: 0.9,
      flow: 0.6,
      fray: 0.7,
      length: 2.1,
      wave: 0.3,
      dynamics: 0.3,
      curl: 0,
      grainStrength: 0.85,
      // grainFollow reinterprets grainAngle as an offset from the stroke heading
      // (not an absolute angle); 0 lays hairs along the contour, a tilt sweeps them.
      grainAngle: 20,
      grainCross: false,
      grainFollow: 1, // sweep the pelt along the stroke, not one global way
    };
  }

  // Weight + Spread (the fan controls) are universal — see ConnectionBase. Fur
  // adds the hair-shaping dials that only its drawHair gives effect to.
  protected extraSliders(): BrushSetting[] {
    return [
      this.numStyle("scatter", "Scatter", 0, 1, 0.05),
      this.numStyle("taper", "Taper", 0, 1, 0.05),
      this.numStyle("flow", "Flow", 0, 1, 0.05),
      this.numStyle("fray", "Fray", 0, 1, 0.05),
      this.numStyle("length", "Length", 1, 3, 0.05),
      this.numStyle("wave", "Wave", 0, 1, 0.05),
      this.numStyle("dynamics", "Slow = richer", 0, 1, 0.05),
      this.numStyle("grainFollow", "Follow stroke", 0, 1, 0.05),
    ];
  }

  // One hair, shaped: taper fades its alpha root→tip, flow sweeps the whole band
  // one way (combed), wave kinks it; otherwise the straight 1px fast path. Moved
  // verbatim from the old BrushBase.drawHair (same RNG draw → identical pixels).
  protected drawHair(
    rx: number,
    ry: number,
    tx: number,
    ty: number,
    px: number,
    py: number,
    style: LineStyle,
    taper: number,
    flow: number,
    wave: number,
    phase: number,
  ): void {
    if (taper <= 0 && flow <= 0 && wave <= 0) {
      this.drawConnection({ id: 0, x: rx, y: ry }, { id: 0, x: tx, y: ty }, style);
      return;
    }
    const hx = tx - rx;
    const hy = ty - ry;
    const hlen = Math.hypot(hx, hy) || 1;
    const base = style.alpha ?? 1;
    const sweep = flow * hlen * (0.6 + 0.8 * this.random());
    const waveAmp = wave * hlen * 0.5;
    const SEG = wave > 0 ? 9 : 5;
    let prevX = rx;
    let prevY = ry;
    for (let k = 1; k <= SEG; k++) {
      const f = k / SEG;
      const off =
        sweep * Math.sin(f * Math.PI * 0.5) + // monotonic lean → swept tips
        waveAmp * f * Math.sin(f * Math.PI * 1.4 + phase); // kink anchored at root
      const nx = rx + hx * f + px * off;
      const ny = ry + hy * f + py * off;
      const alpha = base * (1 - taper * (k - 0.5) / SEG);
      this.drawConnection(
        { id: 0, x: prevX, y: prevY },
        { id: 0, x: nx, y: ny },
        { ...style, alpha },
      );
      prevX = nx;
      prevY = ny;
    }
  }
}

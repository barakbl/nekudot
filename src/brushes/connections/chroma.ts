// Port of the chrome brush of Harmony by mr.doob (Ricardo Cabello) -
// https://github.com/mrdoob/harmony (GPL-3-or-later).
import { ConnectionBase } from "./base";
import type { ConnectingFlat } from "../../connecting-types";
import type { LineStyle } from "../../renderer";
import type { Pixel } from "../../neighbor-finder";
import type { BrushSetting } from "../../base";
import { parseHex, toHex } from "../../colors/gradient";

// Chroma: a port of mrdoob's Harmony "chrome" brush. Short, inset crossing lines
// whose colour is a RANDOM darkened shade of the ink - Harmony drew each link as
// rgba(random*R, random*G, random*B) - which gives chrome its shimmery, metallic
// mottle. The lines composite with a blend so overlaps build a sheen. Harmony
// used the old "darker" op on a white canvas; on Nekudot's dark-first canvas the
// visible analogue is "lighten", so that is the Blend dial's default (darken /
// multiply reproduce the literal light-canvas look). Geometry mirrors chrome:
// reach 32 (its d<1000 threshold), a 20% line inset, flat 0.1 alpha, no fade.
export const icon =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M3 6 L10 10 M5 11 L12 4 M4 9 L11 8 M8 3 L7 13"/></svg>';

export default class ChromaConnection extends ConnectionBase {
  protected defaults(): ConnectingFlat {
    return {
      alpha: 0.1,
      color: "main",
      connect: "line",
      dash: "solid",
      density: 80,
      radius: 32,
      minDist: 0,
      inset: 0.2,
      fade: 0,
      strands: 1,
      spread: 6,
      scatter: 0,
      taper: 0,
      flow: 0,
      fray: 0,
      length: 1,
      wave: 0,
      dynamics: 0,
      curl: 0,
      grainStrength: 0,
      grainAngle: 0,
      grainCross: false,
      blend: "lighten",
    };
  }

  // Keep Blend on the open shelf (Chroma defaults it off the "Normal" neutral).
  defaultOpenKeys(): readonly string[] {
    return [...super.defaultOpenKeys(), "blend"];
  }

  // Chroma's own dial: the composite blend for the web lines (shared with Glow).
  protected extraSliders(): BrushSetting[] {
    return [this.blendSlider()];
  }

  // Recolour every web line a random darkened shade of its own colour (Primary,
  // or whatever the Colour dial resolves) - three channel randoms, like Harmony's
  // rgba(random*R, random*G, random*B). The randoms come from the seeded RNG so
  // the shimmer is reproducible; the blend comes from the base (connectBlend).
  protected drawConnection(p1: Pixel, p2: Pixel, style: LineStyle): void {
    super.drawConnection(p1, p2, { ...style, color: this.shimmer(style.color) });
  }

  private shimmer(base: string | undefined): string {
    const hex = base ?? this.mainColorRaw() ?? "#ffffff";
    const [r, g, b] = parseHex(hex);
    return toHex(r * this.random(), g * this.random(), b * this.random());
  }
}

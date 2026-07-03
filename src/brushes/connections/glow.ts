import { ConnectionBase } from "./base";
import type { ConnectingFlat } from "../../connecting-types";
import type { BrushSetting } from "../../base";

// Glow: long, faint, single-hued strands that pile into a luminous halo on the
// dark canvas. The look is additive buildup, not a fat line - low per-line alpha
// + the "screen" blend accumulate light where the web overlaps (dense near the
// stroke, dimming out along `fade`) without the hard white-clip of true add
// ("Add"/lighter, still one tap away on the Blend dial). No per-line recolour, so
// it reads as clean colored light - the opposite of Chroma's hard metallic mottle.
export const icon =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" aria-hidden="true">' +
  '<circle cx="8" cy="8" r="2.4"/>' +
  '<path d="M8 1 V3.2 M8 12.8 V15 M1 8 H3.2 M12.8 8 H15 M3.05 3.05 L4.6 4.6 M11.4 11.4 L12.95 12.95 M12.95 3.05 L11.4 4.6 M4.6 11.4 L3.05 12.95"/></svg>';

export default class GlowConnection extends ConnectionBase {
  protected defaults(): ConnectingFlat {
    return {
      alpha: 0.06, // low: the softness is faint lines + screen buildup, not opacity
      color: "main",
      connect: "line",
      dash: "solid",
      density: 55, // moderate, not maxed - keeps the mandala hub from blowing out
      radius: 80, // enough to weave a soft halo between strokes; longer piles the
      // additive overlaps into bright white spokes on a dense mandala (tuned down
      // from the long reach that over-brightened at mandala density)
      minDist: 0,
      inset: 0,
      fade: 0.4, // distance-dim far links -> the light concentrates near the stroke
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
      blend: "screen",
    };
  }

  // Keep Blend on the open shelf (Glow defaults it off the "Normal" neutral).
  defaultOpenKeys(): readonly string[] {
    return [...super.defaultOpenKeys(), "blend"];
  }

  // Glow's dial: the composite blend for the web lines (shared with Chroma).
  protected extraSliders(): BrushSetting[] {
    return [this.blendSlider()];
  }
}

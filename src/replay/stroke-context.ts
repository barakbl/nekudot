import type { BrushBase } from "../base";
import type { StrokeContext } from "../log/events";
import { dequantizePressure } from "../log/sample-codec";
import { MOUSE_SAMPLE, type PenSample } from "../pen";
import type { Store } from "../store/base";

// Reconstruct a brush's per-stroke state from a recorded StrokeContext (vector-
// replay P2.1) - the exact inverse of the live funnel's latches: P0.2 per-stroke
// seed, P0.4 colour/settings freeze, and BrushBase.strokeSnapshot. This applies
// only what the BRUSH owns (art-style class, connection dials, frozen colours,
// seed). The funnel-owned fields (size/alpha/erase/layer/symmetry) live on the
// LayerManager, so the ReplayWorld applies those - see engine.ts.

export function hydrateBrush(brush: BrushBase, ctx: StrokeContext, store: Store): void {
  // Frozen toolbar colours ride through the store: there is no direct setter -
  // captureStrokeContext (called by the engine right after this) reads
  // app.color.main/secondary and freezes them, exactly as live pointerdown does
  // (base.ts captureStrokeContext).
  store.set("app.color.main", ctx.color.main);
  store.set("app.color.secondary", ctx.color.secondary);
  // Art style: swap to the recorded style's CLASS first (Fur/Chroma/... weave
  // differently per class), then apply the exact recorded dials over it. Use the
  // preset swap, NOT selectArtStyle, so we never read the current user's saved
  // dials from the store. A pre-P2.1 log (no style) keeps the brush's default
  // style; a non-connecting brush has no connection, so both calls are inert.
  if (ctx.style) brush.applyArtStylePreset(ctx.style);
  brush.activeConnection()?.applyFlat(ctx.settings);
  // The brush's OWN dials (Wisp Colour source, Spray density, ...). Without these a
  // replayed Wisp/Spray uses its defaults - e.g. a gradient Wisp comes back solid
  // Primary. Absent in pre-fix logs, so the brush keeps its defaults then.
  if (ctx.brushSettings) brush.applyBrushSettings(ctx.brushSettings);
  // Per-stroke RNG seed (P0.2) - recorded, never re-randomized.
  brush.setSeed(ctx.seed);
}

// Rebuild a PenSample from the log. Only `pressure` survives recording (isPen /
// tilt / azimuth are dropped), so a pen-mode stroke replays as an upright pen at
// the recorded pressure and a non-pen session as MOUSE_SAMPLE. Tilt/azimuth
// modulation and mouse-vs-pen ambiguity under pen mode are known replay gaps
// (documented for P2.2 - they need a richer sample schema).
export function synthPen(penEnabled: boolean, pressure: number): PenSample {
  if (!penEnabled) return MOUSE_SAMPLE;
  return { isPen: true, pressure, tilt: 0, azimuth: 0, hasTilt: false };
}

export function synthPenQuantized(penEnabled: boolean, quantizedPressure: number): PenSample {
  return synthPen(penEnabled, dequantizePressure(quantizedPressure));
}

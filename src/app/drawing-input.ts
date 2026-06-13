import type { BrushBase } from "../base";
import type { LayerManager } from "../layered/manager";
import type { SymmetryController } from "../symmetry/controller";
import { readPenSample, MOUSE_SAMPLE } from "../pen";

// Pointer wiring for the stage: start/feed/end brush strokes. Freezes the
// symmetry transforms per stroke, opens the wet-stroke buffer around
// continuous lines (see LayerManager.beginStroke) so a faint stroke
// composites at one uniform alpha, and reads the pen sample (pressure/tilt)
// off every pointer event — coalesced sub-samples each carry their own.
export function bindDrawingInput(opts: {
  stage: HTMLElement;
  brush: () => BrushBase; // read per event — the active brush can change
  symmetry: SymmetryController;
  layerManager: LayerManager;
  // Pen support gate (the More-menu toggle). When off, every sample is read as
  // a neutral mouse sample, so a stylus draws with no pressure/tilt modulation.
  penEnabled: () => boolean;
  onStrokeEnd: (brush: BrushBase) => void; // previews/persist/undo, in main
}): { commitActiveStroke: () => void } {
  const { stage, symmetry, layerManager } = opts;
  let drawingId: number | null = null;
  const sampleOf = (e: PointerEvent) =>
    opts.penEnabled() ? readPenSample(e) : MOUSE_SAMPLE;
  // Whether THIS stroke opened the wet buffer — latched at pointerdown so the
  // end matches the start even if settings change mid-stroke.
  let buffered = false;

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    drawingId = e.pointerId;
    const brush = opts.brush();
    const pen = sampleOf(e);
    // Freeze the symmetry transforms for this stroke (Tile anchored to the start,
    // Radial/Mirror centred on the canvas) before any mark is drawn.
    symmetry.beginStroke(e.offsetX, e.offsetY, layerManager.currentSize);
    // Buffer the continuous line (Round) so a faint stroke composites as one
    // uniform alpha instead of dotting at the sample joints. Must start before the
    // first segment is drawn. Skipped under symmetry so each copy keeps its own
    // fade (the buffer would flatten them to one alpha), and skipped when the
    // pen modulates opacity (see BrushBase.bufferedStroke).
    buffered = brush.bufferedStroke(pen) && !symmetry.active();
    if (buffered) layerManager.beginStroke();
    brush.strokeStart(e.offsetX, e.offsetY);
    brush.stroke(e.offsetX, e.offsetY, true, pen);
  });

  stage.addEventListener("pointermove", (e) => {
    if (e.pointerId !== drawingId) return;
    const brush = opts.brush();
    const evs = e.getCoalescedEvents();
    const list = evs.length ? evs : [e];
    // Connecting brushes weave the web once per frame (the last coalesced sample),
    // matching Harmony's per-move model. Feeding every coalesced sub-sample to the
    // web made it build up ~quadratically with the pointer's report rate (fast
    // pens/trackpads emit many sub-samples per frame). The visible mark still
    // draws through every sub-sample, so the line stays smooth; non-connecting
    // brushes deposit every sample as before.
    const frameCadence = brush.supportsConnecting();
    for (let i = 0; i < list.length; i++) {
      const ev = list[i];
      brush.stroke(
        ev.offsetX,
        ev.offsetY,
        !frameCadence || i === list.length - 1,
        sampleOf(ev),
      );
    }
  });

  const finish = () => {
    drawingId = null;
    const brush = opts.brush();
    brush.strokeEnd();
    // Commit the buffered line onto the active layer (one uniform-alpha composite)
    // before previews/persist read the layer. (Matches the pointerdown latch.)
    if (buffered) layerManager.endStroke();
    buffered = false;
    opts.onStrokeEnd(brush);
  };

  const end = (e: PointerEvent) => {
    if (e.pointerId !== drawingId) return;
    finish();
  };

  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);

  // For the page-hide path (wired in main): commit an in-progress stroke
  // through the normal end pipeline. Browsers don't reliably fire
  // pointercancel when the tab hides or closes mid-drag, and an uncommitted
  // stroke exists only on canvas — it would die with the tab. A later
  // pointerup/cancel for the committed stroke is ignored (drawingId is gone),
  // same as any stray pointer event.
  return {
    commitActiveStroke: () => {
      if (drawingId !== null) finish();
    },
  };
}

import type { BrushBase } from "../base";
import type { LayerManager } from "../layered/manager";
import type { SymmetryController } from "../symmetry/controller";

// Pointer wiring for the stage: start/feed/end brush strokes. Freezes the
// symmetry transforms per stroke and opens the wet-stroke buffer around
// continuous lines (see LayerManager.beginStroke) so a faint stroke
// composites at one uniform alpha.
export function bindDrawingInput(opts: {
  stage: HTMLElement;
  brush: () => BrushBase; // read per event — the active brush can change
  symmetry: SymmetryController;
  layerManager: LayerManager;
  onStrokeEnd: (brush: BrushBase) => void; // previews/persist/undo, in main
}): { commitActiveStroke: () => void } {
  const { stage, symmetry, layerManager } = opts;
  let drawingId: number | null = null;

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    drawingId = e.pointerId;
    const brush = opts.brush();
    // Freeze the symmetry transforms for this stroke (Tile anchored to the start,
    // Radial/Mirror centred on the canvas) before any mark is drawn.
    symmetry.beginStroke(e.offsetX, e.offsetY, layerManager.currentSize);
    // Buffer the continuous line (Round) so a faint stroke composites as one
    // uniform alpha instead of dotting at the sample joints. Must start before the
    // first segment is drawn. Skipped under symmetry so each copy keeps its own
    // fade (the buffer would flatten them to one alpha).
    if (brush.bufferedStroke() && !symmetry.active()) layerManager.beginStroke();
    brush.strokeStart(e.offsetX, e.offsetY);
    brush.stroke(e.offsetX, e.offsetY);
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
      brush.stroke(ev.offsetX, ev.offsetY, !frameCadence || i === list.length - 1);
    }
  });

  const finish = () => {
    drawingId = null;
    const brush = opts.brush();
    brush.strokeEnd();
    // Commit the buffered line onto the active layer (one uniform-alpha composite)
    // before previews/persist read the layer. (Matches the pointerdown guard.)
    if (brush.bufferedStroke() && !symmetry.active()) layerManager.endStroke();
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

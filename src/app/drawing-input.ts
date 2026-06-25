import type { BrushBase } from "../base";
import type { LayerManager } from "../layered/manager";
import type { SymmetryController } from "../symmetry/controller";
import type { Viewport } from "./viewport";
import { readPenSample, MOUSE_SAMPLE } from "../pen";
import { dlog, isDiagnostics } from "../diagnostics";

// Pointer wiring for the stage: start/feed/end brush strokes. Freezes the
// symmetry transforms per stroke, opens the wet-stroke buffer around
// continuous lines (see LayerManager.beginStroke) so a faint stroke
// composites at one uniform alpha, and reads the pen sample (pressure/tilt)
// off every pointer event — coalesced sub-samples each carry their own.

// PointerEvent.getCoalescedEvents() only shipped in Safari 18; on older Safari
// (e.g. iOS 17) the method is undefined and calling it throws - which aborted
// every pointermove and left strokes invisible. Feature-detect it and fall back
// to the event itself (the same fallback already used for an empty list).
export function coalescedEvents(e: PointerEvent): PointerEvent[] {
  if (typeof e.getCoalescedEvents !== "function") return [e];
  const evs = e.getCoalescedEvents();
  return evs.length ? evs : [e];
}

export function bindDrawingInput(opts: {
  stage: HTMLElement;
  viewport: Viewport; // maps screen (client) coords -> canvas coords (pan/zoom/rotate)
  brush: () => BrushBase; // read per event — the active brush can change
  symmetry: SymmetryController;
  layerManager: LayerManager;
  // Pen support gate (the More-menu toggle). When off, every sample is read as
  // a neutral mouse sample, so a stylus draws with no pressure/tilt modulation.
  penEnabled: () => boolean;
  // True while a multi-touch camera gesture (pan/zoom/rotate) owns the input -
  // touch pointers must not draw then. See app/touch-gestures.
  gestureActive?: () => boolean;
  // Gate: when this returns false, pointerdown is ignored so no stroke starts.
  // Used to hold input until the boot paint-restore finishes - otherwise an
  // early stroke is overwritten by applyPaintData mid-flight (bug #1). Default
  // (unset) is always-ready.
  ready?: () => boolean;
  onStrokeStart?: () => void; // fired when a stroke begins (e.g. arm GIF capture)
  onStrokeEnd: (brush: BrushBase) => void; // previews/persist/undo, in main
}): { commitActiveStroke: () => void; cancelActiveStroke: () => void } {
  const { stage, viewport, symmetry, layerManager } = opts;
  let drawingId: number | null = null;
  const sampleOf = (e: PointerEvent) =>
    opts.penEnabled() ? readPenSample(e) : MOUSE_SAMPLE;
  // Screen (client) coords -> canvas-local coords, through the camera inverse.
  // Replaces e.offsetX/offsetY, which is wrong once the stage is CSS-transformed.
  const at = (e: { clientX: number; clientY: number }) =>
    viewport.toCanvas(e.clientX, e.clientY);
  // Whether THIS stroke opened the wet buffer — latched at start so the end
  // matches the start even if settings change mid-stroke.
  let buffered = false;
  // Whether the first mark has actually been laid. On touch the start is
  // DEFERRED (see pointerdown) until the stroke is confirmed, so the move / end
  // / commit paths lay it lazily and a camera gesture can drop it untouched.
  let started = false;
  let beginPoint: { x: number; y: number } | null = null; // for the diagnostics probe
  let pending: { x: number; y: number; pen: ReturnType<typeof sampleOf> } | null =
    null;

  // Lay the stroke's first mark: freeze symmetry, open the wet buffer, draw the
  // first dab, then signal (e.g. arm GIF capture). Only call when not started.
  const beginStroke = (
    p: { x: number; y: number },
    pen: ReturnType<typeof sampleOf>,
  ) => {
    const brush = opts.brush();
    started = true;
    beginPoint = { x: p.x, y: p.y };
    // Freeze the symmetry transforms for this stroke (Tile anchored to the start,
    // Radial/Mirror centred on the canvas) before any mark is drawn.
    symmetry.beginStroke(p.x, p.y, layerManager.currentSize);
    // Buffer the continuous line (Round) so a faint stroke composites as one
    // uniform alpha instead of dotting at the sample joints. Skipped under
    // symmetry so each copy keeps its own fade (the buffer would flatten them to
    // one alpha), and skipped when the pen modulates opacity (BrushBase.bufferedStroke).
    buffered = brush.bufferedStroke(pen) && !symmetry.active();
    if (buffered) layerManager.beginStroke();
    if (isDiagnostics()) {
      const bg = layerManager.getBackground();
      dlog("stroke", "begin", {
        brush: brush.name(),
        pointer: pen.isPen ? "pen" : "mouse/touch",
        pressure: Math.round(pen.pressure * 100) / 100,
        buffered, // true => the live "wet" overlay canvas is in use
        alpha: layerManager.strokeAlpha(),
        bg: bg.transparent ? "transparent" : bg.color,
        symmetry: symmetry.active(),
        at: `${Math.round(p.x)},${Math.round(p.y)}`,
      });
    }
    brush.strokeStart(p.x, p.y);
    brush.stroke(p.x, p.y, true, pen);
    // Signal AFTER the first mark so an armed GIF recorder's first frame has it.
    opts.onStrokeStart?.();
  };
  // Promote a deferred touch stroke to a live one (no-op if already live / none).
  const ensureStarted = () => {
    if (pending && !started) {
      beginStroke(pending, pending.pen);
      pending = null;
    }
  };

  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    // Boot restore still in flight - drop the pointer so a stroke can't start
    // and be wiped by the incoming applyPaintData (bug #1).
    if (opts.ready?.() === false) return;
    // Ignore extra pointers while a stroke is live (e.g. a 2nd finger landing -
    // that's a camera gesture, not a new stroke) and any touch while the camera
    // gesture owns the input. Guards both event orders (pointerdown vs touchstart).
    if (drawingId !== null) return;
    if (e.pointerType === "touch" && opts.gestureActive?.()) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    drawingId = e.pointerId;
    started = false;
    pending = null;
    const pen = sampleOf(e);
    const p = at(e);
    // Touch: DEFER the first mark until the stroke is confirmed - by the first
    // move, or by the release of a single-finger tap. If a 2nd finger lands
    // first (a pan/zoom/rotate gesture, or a 2-/3-finger undo/redo tap), the
    // gesture drops this deferred stroke so it leaves no mark and no deposited
    // point - which is what makes those multi-finger taps work. Mouse and pen
    // are unambiguous, so they draw at once.
    if (e.pointerType === "touch") {
      pending = { x: p.x, y: p.y, pen };
    } else {
      beginStroke(p, pen);
    }
  });

  stage.addEventListener("pointermove", (e) => {
    if (e.pointerId !== drawingId) return;
    ensureStarted(); // the first movement confirms a deferred touch stroke
    const brush = opts.brush();
    const list = coalescedEvents(e);
    // Connecting brushes weave the web once per frame (the last coalesced sample),
    // matching Harmony's per-move model. Feeding every coalesced sub-sample to the
    // web made it build up ~quadratically with the pointer's report rate (fast
    // pens/trackpads emit many sub-samples per frame). The visible mark still
    // draws through every sub-sample, so the line stays smooth; non-connecting
    // brushes deposit every sample as before.
    const frameCadence = brush.supportsConnecting();
    for (let i = 0; i < list.length; i++) {
      const ev = list[i];
      const q = at(ev);
      brush.stroke(
        q.x,
        q.y,
        !frameCadence || i === list.length - 1,
        sampleOf(ev),
      );
    }
  });

  const finish = () => {
    drawingId = null;
    pending = null;
    if (!started) return; // nothing was ever drawn (e.g. a dropped deferred tap)
    const brush = opts.brush();
    brush.strokeEnd();
    // Commit the buffered line onto the active layer (one uniform-alpha composite)
    // before previews/persist read the layer. (Matches the start latch.)
    if (buffered) layerManager.endStroke();
    // Diagnostics: read back the committed layer at the stroke's start point.
    // regionMaxAlpha > 0 means pixels DID land (so an invisible stroke is a
    // display/compositing problem, not a draw failure); 0 means nothing drew.
    if (isDiagnostics() && beginPoint) {
      const r = layerManager.active.renderer as {
        debugProbe?: (x: number, y: number) => Record<string, unknown>;
      };
      if (r.debugProbe) dlog("canvas", "post-stroke", r.debugProbe(beginPoint.x, beginPoint.y));
    }
    buffered = false;
    started = false;
    opts.onStrokeEnd(brush);
  };

  const end = (e: PointerEvent) => {
    if (e.pointerId !== drawingId) return;
    ensureStarted(); // a single-finger tap lays its one dab on release
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
      if (drawingId === null) return;
      ensureStarted(); // a deferred tap commits its dab too (don't lose it)
      finish();
    },
    // A multi-touch camera gesture is taking over. A stroke that already began
    // (the finger moved before the 2nd touch) is committed so it stays undoable;
    // a still-deferred tap is dropped clean - no mark, no deposit, no history
    // entry - so a 2-finger undo / 3-finger redo tap targets the real artwork.
    cancelActiveStroke: () => {
      if (drawingId === null) return;
      if (started) finish();
      else {
        drawingId = null;
        pending = null;
      }
    },
  };
}

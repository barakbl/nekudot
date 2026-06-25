import { describe, it, expect, beforeEach } from "vitest";
import { bindDrawingInput, coalescedEvents } from "../src/app/drawing-input";
import type { BrushBase } from "../src/base";
import type { LayerManager } from "../src/layered/manager";
import type { SymmetryController } from "../src/symmetry/controller";
import type { Viewport } from "../src/app/viewport";

// Identity camera: screen coords are canvas coords (no pan/zoom/rotate). The
// real Viewport's matrix math is covered by the headless smoke test.
const idViewport = {
  toCanvas: (x: number, y: number) => ({ x, y }),
} as unknown as Viewport;

// Minimal stage stub: records listeners, lets the test fire pointer events.
function makeStage() {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  return {
    addEventListener(type: string, fn: (e: unknown) => void) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(fn);
    },
    setPointerCapture() {},
    fire(type: string, e: Record<string, unknown>) {
      for (const fn of listeners.get(type) ?? []) fn({ preventDefault() {}, ...e });
    },
  };
}

describe("drawing input: commitActiveStroke (hide/close durability)", () => {
  let stage: ReturnType<typeof makeStage>;
  let ends: number;
  let strokeEnds: number;
  let input: { commitActiveStroke: () => void };

  beforeEach(() => {
    stage = makeStage();
    ends = 0;
    strokeEnds = 0;
    const brush = {
      strokeStart() {},
      stroke() {},
      strokeEnd: () => void strokeEnds++,
      bufferedStroke: () => false,
      supportsConnecting: () => false,
    } as unknown as BrushBase;
    input = bindDrawingInput({
      stage: stage as unknown as HTMLElement,
      viewport: idViewport,
      brush: () => brush,
      symmetry: { beginStroke() {}, active: () => false } as unknown as SymmetryController,
      layerManager: { currentSize: { width: 100, height: 100 } } as unknown as LayerManager,
      penEnabled: () => true,
      onStrokeEnd: () => void ends++,
    });
  });

  it("commits an in-progress stroke exactly once; the later pointerup is ignored", () => {
    stage.fire("pointerdown", { button: 0, pointerId: 1, offsetX: 5, offsetY: 5 });
    input.commitActiveStroke();
    expect(ends).toBe(1);
    expect(strokeEnds).toBe(1);
    // The pointer is released after the tab came back — already committed.
    stage.fire("pointerup", { pointerId: 1 });
    expect(ends).toBe(1);
  });

  it("is a no-op when no stroke is active (every tab switch fires it)", () => {
    input.commitActiveStroke();
    expect(ends).toBe(0);
    // ...including right after a normally-completed stroke.
    stage.fire("pointerdown", { button: 0, pointerId: 1, offsetX: 5, offsetY: 5 });
    stage.fire("pointerup", { pointerId: 1 });
    expect(ends).toBe(1);
    input.commitActiveStroke();
    expect(ends).toBe(1);
  });

  it("leaves the normal pointerup/pointercancel path unchanged", () => {
    stage.fire("pointerdown", { button: 0, pointerId: 1, offsetX: 5, offsetY: 5 });
    stage.fire("pointercancel", { pointerId: 1 });
    expect(ends).toBe(1);
    expect(strokeEnds).toBe(1);
  });
});

describe("drawing input: penEnabled gate", () => {
  // Capture the pen sample each stroke() receives, for a pen pointer event.
  const setup = (penEnabled: boolean) => {
    const stage = makeStage();
    const samples: { isPen: boolean; pressure: number }[] = [];
    const brush = {
      strokeStart() {},
      stroke: (_x: number, _y: number, _s: boolean, pen: { isPen: boolean; pressure: number }) =>
        void samples.push(pen),
      strokeEnd() {},
      bufferedStroke: () => false,
      supportsConnecting: () => false,
    } as unknown as BrushBase;
    bindDrawingInput({
      stage: stage as unknown as HTMLElement,
      viewport: idViewport,
      brush: () => brush,
      symmetry: { beginStroke() {}, active: () => false } as unknown as SymmetryController,
      layerManager: { currentSize: { width: 100, height: 100 } } as unknown as LayerManager,
      penEnabled: () => penEnabled,
      onStrokeEnd() {},
    });
    return { stage, samples };
  };

  it("passes real pen pressure through when enabled", () => {
    const { stage, samples } = setup(true);
    stage.fire("pointerdown", {
      button: 0, pointerId: 1, offsetX: 5, offsetY: 5, pointerType: "pen", pressure: 0.5,
    });
    expect(samples[0].isPen).toBe(true);
    expect(samples[0].pressure).toBeCloseTo(0.5);
  });

  it("feeds a neutral mouse sample for a pen event when disabled", () => {
    const { stage, samples } = setup(false);
    stage.fire("pointerdown", {
      button: 0, pointerId: 1, offsetX: 5, offsetY: 5, pointerType: "pen", pressure: 0.5,
    });
    expect(samples[0].isPen).toBe(false);
    expect(samples[0].pressure).toBe(1); // MOUSE_SAMPLE — no modulation
  });
});

describe("drawing input: deferred touch start + camera gesture guards", () => {
  // Count stroke starts/ends. On touch the start is deferred until the stroke is
  // confirmed (a move, or a tap release), so a 2nd finger can drop it untouched.
  const setup = (gestureActive: () => boolean) => {
    const stage = makeStage();
    let starts = 0;
    let ends = 0;
    const brush = {
      strokeStart: () => void starts++,
      stroke() {},
      strokeEnd() {},
      bufferedStroke: () => false,
      supportsConnecting: () => false,
    } as unknown as BrushBase;
    const input = bindDrawingInput({
      stage: stage as unknown as HTMLElement,
      viewport: idViewport,
      brush: () => brush,
      symmetry: { beginStroke() {}, active: () => false } as unknown as SymmetryController,
      layerManager: { currentSize: { width: 100, height: 100 } } as unknown as LayerManager,
      penEnabled: () => false,
      gestureActive,
      onStrokeEnd: () => void ends++,
    });
    return { stage, input, starts: () => starts, ends: () => ends };
  };
  const move = (id: number) => ({ pointerId: id, getCoalescedEvents: () => [] });

  it("ignores a 2nd finger while a (confirmed) stroke is live", () => {
    const { stage, starts } = setup(() => false);
    stage.fire("pointerdown", { button: 0, pointerId: 1, pointerType: "touch" });
    stage.fire("pointermove", move(1)); // confirms finger 1's stroke
    stage.fire("pointerdown", { button: 0, pointerId: 2, pointerType: "touch" });
    expect(starts()).toBe(1); // only the first finger drew
  });

  it("ignores a touch pointerdown while a camera gesture owns the input", () => {
    const { stage, starts } = setup(() => true);
    stage.fire("pointerdown", { button: 0, pointerId: 1, pointerType: "touch" });
    stage.fire("pointermove", move(1));
    expect(starts()).toBe(0);
  });

  it("still draws with a mouse during a gesture flag (touch-only guard)", () => {
    const { stage, starts } = setup(() => true);
    stage.fire("pointerdown", { button: 0, pointerId: 1, pointerType: "mouse" });
    expect(starts()).toBe(1); // mouse is unambiguous — draws immediately
  });

  it("lays one dab for a single-finger tap (down + up, no move)", () => {
    const { stage, starts, ends } = setup(() => false);
    stage.fire("pointerdown", { button: 0, pointerId: 1, pointerType: "touch" });
    stage.fire("pointerup", { pointerId: 1 });
    expect(starts()).toBe(1);
    expect(ends()).toBe(1);
  });

  it("drops a deferred tap on cancel — no mark, no stroke-end (the 2-finger undo fix)", () => {
    const { stage, input, starts, ends } = setup(() => false);
    stage.fire("pointerdown", { button: 0, pointerId: 1, pointerType: "touch" });
    input.cancelActiveStroke(); // a 2nd finger lands before any move
    stage.fire("pointerup", { pointerId: 1 }); // finger lifts after the cancel
    expect(starts()).toBe(0); // nothing drawn
    expect(ends()).toBe(0); // no undo entry — so a 2-finger-tap undo hits real art
  });

  it("commits a deferred stroke that already moved when a gesture starts", () => {
    const { stage, input, starts, ends } = setup(() => false);
    stage.fire("pointerdown", { button: 0, pointerId: 1, pointerType: "touch" });
    stage.fire("pointermove", move(1)); // confirmed
    input.cancelActiveStroke(); // 2nd finger now → commit, not drop
    expect(starts()).toBe(1);
    expect(ends()).toBe(1);
  });
});

describe("drawing input: ready gate (boot paint-restore)", () => {
  const setup = (ready: () => boolean) => {
    const stage = makeStage();
    let ends = 0;
    const brush = {
      strokeStart() {},
      stroke() {},
      strokeEnd() {},
      bufferedStroke: () => false,
      supportsConnecting: () => false,
    } as unknown as BrushBase;
    bindDrawingInput({
      stage: stage as unknown as HTMLElement,
      viewport: idViewport,
      brush: () => brush,
      symmetry: { beginStroke() {}, active: () => false } as unknown as SymmetryController,
      layerManager: { currentSize: { width: 100, height: 100 } } as unknown as LayerManager,
      penEnabled: () => true,
      ready,
      onStrokeEnd: () => void ends++,
    });
    return { stage, ends: () => ends };
  };

  it("ignores pointerdown while not ready, so a stroke can't start mid-restore", () => {
    const { stage, ends } = setup(() => false);
    stage.fire("pointerdown", { button: 0, pointerId: 1, offsetX: 5, offsetY: 5 });
    stage.fire("pointerup", { pointerId: 1 });
    expect(ends()).toBe(0); // gated — nothing drew
  });

  it("draws once ready flips true (restore settled)", () => {
    let restored = false;
    const { stage, ends } = setup(() => restored);
    stage.fire("pointerdown", { button: 0, pointerId: 1, offsetX: 5, offsetY: 5 });
    stage.fire("pointerup", { pointerId: 1 });
    expect(ends()).toBe(0); // still gated
    restored = true;
    stage.fire("pointerdown", { button: 0, pointerId: 2, offsetX: 5, offsetY: 5 });
    stage.fire("pointerup", { pointerId: 2 });
    expect(ends()).toBe(1); // now it draws
  });
});

// Regression: an artist on iPad (iOS 17 Safari) saw no lines because
// PointerEvent.getCoalescedEvents() - which only shipped in Safari 18 - was
// called unguarded, throwing on every pointermove and aborting the draw.
describe("coalescedEvents (Safari 17 fallback)", () => {
  const ev = (over: Partial<PointerEvent> = {}) => ({ ...over }) as unknown as PointerEvent;

  it("falls back to the event itself when getCoalescedEvents is missing", () => {
    const e = ev(); // no getCoalescedEvents method (iOS 17 Safari)
    expect(coalescedEvents(e)).toEqual([e]);
  });

  it("returns the coalesced list when the API is present", () => {
    const a = ev();
    const b = ev();
    const e = ev({ getCoalescedEvents: () => [a, b] });
    expect(coalescedEvents(e)).toEqual([a, b]);
  });

  it("falls back to the event when the coalesced list is empty", () => {
    const e = ev({ getCoalescedEvents: () => [] });
    expect(coalescedEvents(e)).toEqual([e]);
  });
});

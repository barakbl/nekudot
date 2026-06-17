import { describe, it, expect, beforeEach } from "vitest";
import { bindDrawingInput } from "../src/app/drawing-input";
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

describe("drawing input: multi-touch camera gesture guards", () => {
  // Count stroke starts so we can assert a 2nd finger never begins a new one.
  const setup = (gestureActive: () => boolean) => {
    const stage = makeStage();
    let starts = 0;
    const brush = {
      strokeStart: () => void starts++,
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
      penEnabled: () => false,
      gestureActive,
      onStrokeEnd() {},
    });
    return { stage, starts: () => starts };
  };

  it("ignores a 2nd finger while a stroke is already live", () => {
    const { stage, starts } = setup(() => false);
    stage.fire("pointerdown", { button: 0, pointerId: 1, pointerType: "touch" });
    stage.fire("pointerdown", { button: 0, pointerId: 2, pointerType: "touch" });
    expect(starts()).toBe(1); // only the first finger drew
  });

  it("ignores a touch pointerdown while a camera gesture owns the input", () => {
    const { stage, starts } = setup(() => true);
    stage.fire("pointerdown", { button: 0, pointerId: 1, pointerType: "touch" });
    expect(starts()).toBe(0);
  });

  it("still draws with a mouse during a gesture flag (touch-only guard)", () => {
    const { stage, starts } = setup(() => true);
    stage.fire("pointerdown", { button: 0, pointerId: 1, pointerType: "mouse" });
    expect(starts()).toBe(1);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { bindDrawingInput } from "../src/app/drawing-input";
import type { BrushBase } from "../src/base";
import type { LayerManager } from "../src/layered/manager";
import type { SymmetryController } from "../src/symmetry/controller";

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
      brush: () => brush,
      symmetry: { beginStroke() {}, active: () => false } as unknown as SymmetryController,
      layerManager: { currentSize: { width: 100, height: 100 } } as unknown as LayerManager,
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

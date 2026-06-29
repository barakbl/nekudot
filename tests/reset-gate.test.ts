import { describe, it, expect, vi } from "vitest";
import { createResetGate, type ResetGateDeps } from "../src/app/reset-gate";

const SIZE = { width: 800, height: 600 };

function makeDeps(): ResetGateDeps {
  return {
    resetLayers: vi.fn(),
    resizeCanvas: vi.fn(),
    forgetSyncFile: vi.fn(),
    clearContent: vi.fn(),
    resetArtStyle: vi.fn(),
    persistSize: vi.fn(),
    clearHistory: vi.fn(),
    pushUndo: vi.fn(),
  };
}

describe("reset gate", () => {
  it("Delete canvas: wipes + forgets the sync file, but stays undoable", () => {
    const deps = makeDeps();
    createResetGate(deps)({
      size: SIZE,
      undoLabel: "Delete canvas",
      clearHistory: false,
      resetArtStyle: false,
      resize: false,
    });
    expect(deps.resetLayers).toHaveBeenCalledWith(SIZE);
    expect(deps.forgetSyncFile).toHaveBeenCalledTimes(1); // the bug this gate prevents
    expect(deps.clearContent).toHaveBeenCalledTimes(1);
    expect(deps.resetArtStyle).not.toHaveBeenCalled();
    expect(deps.resizeCanvas).not.toHaveBeenCalled(); // keeps the current size
    expect(deps.clearHistory).not.toHaveBeenCalled(); // undo is preserved
    expect(deps.pushUndo).toHaveBeenCalledWith("Delete canvas");
  });

  it("New art: resizes, clears content, and clears undo (a fresh piece)", () => {
    const deps = makeDeps();
    createResetGate(deps)({
      size: SIZE,
      undoLabel: "New art",
      clearHistory: true,
      resetArtStyle: false,
      resize: true,
    });
    expect(deps.resizeCanvas).toHaveBeenCalledWith(SIZE);
    expect(deps.forgetSyncFile).toHaveBeenCalledTimes(1);
    expect(deps.clearContent).toHaveBeenCalledTimes(1);
    expect(deps.resetArtStyle).not.toHaveBeenCalled();
    expect(deps.clearHistory).toHaveBeenCalledTimes(1);
    expect(deps.pushUndo).toHaveBeenCalledWith("New art");
  });

  it("guided start resets the art style instead of only clearing content", () => {
    const deps = makeDeps();
    createResetGate(deps)({
      size: SIZE,
      undoLabel: "Mandala",
      clearHistory: true,
      resetArtStyle: true,
      resize: true,
    });
    expect(deps.resetArtStyle).toHaveBeenCalledTimes(1);
    expect(deps.clearContent).not.toHaveBeenCalled(); // resetArtStyle subsumes it
    expect(deps.clearHistory).toHaveBeenCalledTimes(1);
  });

  it("runs beforeUndo setup before clearing history + pushing the undo baseline", () => {
    const deps = makeDeps();
    const order: string[] = [];
    vi.mocked(deps.clearHistory).mockImplementation(() => order.push("clearHistory"));
    vi.mocked(deps.pushUndo).mockImplementation(() => order.push("pushUndo"));
    createResetGate(deps)({
      size: SIZE,
      undoLabel: "Mandala",
      clearHistory: true,
      resetArtStyle: true,
      resize: true,
      beforeUndo: () => order.push("beforeUndo"),
    });
    expect(order).toEqual(["beforeUndo", "clearHistory", "pushUndo"]);
  });

  it("always forgets the sync file and pushes undo, in every mode", () => {
    for (const resize of [true, false]) {
      const deps = makeDeps();
      createResetGate(deps)({
        size: SIZE,
        undoLabel: "x",
        clearHistory: resize,
        resetArtStyle: false,
        resize,
      });
      expect(deps.forgetSyncFile).toHaveBeenCalledTimes(1);
      expect(deps.pushUndo).toHaveBeenCalledTimes(1);
    }
  });
});

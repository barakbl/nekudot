import type { CanvasSize } from "../canvas-size";

// One coordinated "wipe to a fresh drawing" gate. Every soft-reset path - New
// art, Delete canvas, the Start-page mandala + blank - goes through here, so
// layers, content, the folder-sync filename, the persisted size and the undo
// baseline stay in lockstep. (A path forgetting one of these is how the
// sync-filename bug crept in.) Undo is deliberately NOT bundled in: clearHistory
// is the document-boundary switch - true for a fresh piece (New / mandala /
// blank), false for Delete canvas, which stays undoable.

export type ResetGateDeps = {
  resetLayers: (size: CanvasSize) => void;
  resizeCanvas: (size: CanvasSize) => void;
  forgetSyncFile: () => void;
  // Wipe the process event log so Record replays THIS fresh drawing, not the one
  // that was on the canvas before the reset.
  resetEventLog: () => void;
  clearContent: () => void;
  resetArtStyle: () => void;
  persistSize: (size: CanvasSize) => void;
  clearHistory: () => void;
  pushUndo: (label: string) => void;
};

export type ResetDrawingOpts = {
  size: CanvasSize;
  undoLabel: string;
  clearHistory: boolean; // true = boundary (clears undo); false = undoable (Delete)
  resetArtStyle: boolean; // guided starts also revert the connecting look
  resize: boolean; // New/mandala/blank change size; Delete keeps the current one
  // Flow-specific setup that must land in the fresh undo baseline (e.g. the
  // mandala's background / brush / symmetry), run just before the undo push.
  beforeUndo?: () => void;
};

export function createResetGate(deps: ResetGateDeps) {
  return function resetDrawing(opts: ResetDrawingOpts): void {
    deps.resetLayers(opts.size);
    if (opts.resize) deps.resizeCanvas(opts.size);
    deps.forgetSyncFile();
    deps.resetEventLog();
    if (opts.resetArtStyle) deps.resetArtStyle();
    else deps.clearContent();
    deps.persistSize(opts.size);
    opts.beforeUndo?.();
    if (opts.clearHistory) deps.clearHistory();
    deps.pushUndo(opts.undoLabel);
  };
}

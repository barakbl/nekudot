// Durability on hide/close. When the tab hides (switch/minimize/close), commit
// any in-progress stroke - its paint exists only on canvas until the stroke-end
// push - and flush any dirty pixel-log rows. Everything else is already
// persisted at stroke end; in-flight IDB transactions drain on their own. Both
// events because older Safari closes tabs without firing visibilitychange;
// running twice is a no-op (no active stroke, clean log).
//
// MUST be wired last in boot, after the drawing input is bound (it reads
// commitActiveStroke).
export function bindDurability(deps: {
  drawingInput: { commitActiveStroke: () => void };
  pixelLog: { flush: () => Promise<void> };
}): void {
  const persistOnHide = () => {
    deps.drawingInput.commitActiveStroke();
    void deps.pixelLog.flush();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistOnHide();
  });
  window.addEventListener("pagehide", persistOnHide);
}

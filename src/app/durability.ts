// Durability on hide/close. When the tab hides (switch/minimize/close), commit
// any in-progress stroke - its paint exists only on canvas until the stroke-end
// push - and flush any dirty pixel-log rows. Everything else is already
// persisted at stroke end; in-flight IDB transactions drain on their own. Both
// events because older Safari closes tabs without firing visibilitychange;
// running twice is a no-op (no active stroke, clean log).
//
// KNOWN LIMITATION (best-effort, deliberately not "fixed"): committing a stroke
// only STARTS its persist - an async toBlob encode + IndexedDB write - which
// can't be guaranteed to finish if the tab is hard-killed mid-stroke.
// visibilitychange->hidden usually lets it complete (a backgrounded page lingers
// before teardown); pagehide on a real close is the risky one. The window is
// narrow: only a stroke actively in progress at the instant of teardown is at
// risk; anything already ended is persisted. A hard guarantee would need a
// synchronous / vector-replay persistence model (store the stroke's points,
// re-render on boot) - a large change, not worth it for this rare edge. There
// is no synchronous bitmap-persist path (toBlob/IDB are async; the bitmaps are
// too large for synchronous localStorage, which is why paint lives in IDB).
//
// MUST be wired last in boot, after the drawing input is bound (it reads
// commitActiveStroke).
export function bindDurability(deps: {
  drawingInput: { commitActiveStroke: () => void };
  pixelLog: { flush: () => Promise<void> };
  eventLog?: { flush: () => Promise<void> }; // shadow event log (vector-replay)
  history?: { flushDurable: () => void }; // tile-undo on-mode v1 shadow keyframe
}): void {
  const persistOnHide = () => {
    deps.drawingInput.commitActiveStroke();
    void deps.pixelLog.flush();
    void deps.eventLog?.flush();
    // Commit the debounced shadow keyframe so a rollback build (or a holed v2
    // chain) restores the last pointer state, not the last write-window's.
    deps.history?.flushDurable();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") persistOnHide();
  });
  window.addEventListener("pagehide", persistOnHide);
}

import type { Viewport } from "./viewport";

// Desktop camera input over the viewport: window-resize re-fit, wheel zoom/pan,
// and middle-mouse drag-pan. Two-finger touch gestures are bound separately in
// app/touch-gestures; the Viewport instance + the onViewportChange seam stay in
// main. Pure event wiring - nothing to return.
export function bindCameraInput(deps: {
  viewportEl: HTMLElement;
  viewport: Viewport;
}): void {
  const { viewportEl, viewport } = deps;

  // Issue #3: shrinking the window can leave the canvas bigger than the viewport
  // and unreachable - fit it back in (no-op while it still fits).
  window.addEventListener("resize", () => viewport.onResize());

  // Desktop wheel: Cmd/Ctrl + wheel zooms about the cursor; a plain wheel /
  // two-finger trackpad scroll pans (the page itself never scrolls).
  viewportEl.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        viewport.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
      } else {
        viewport.panBy(-e.deltaX, -e.deltaY);
      }
    },
    { passive: false },
  );

  // Desktop pan: middle-mouse drag. Reaches here by bubbling up from the stage,
  // whose draw handler ignores any button other than 0, so it never draws.
  let panning = false;
  let panX = 0;
  let panY = 0;
  viewportEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 1) return;
    e.preventDefault();
    panning = true;
    panX = e.clientX;
    panY = e.clientY;
    viewportEl.setPointerCapture(e.pointerId);
  });
  viewportEl.addEventListener("pointermove", (e) => {
    if (!panning) return;
    viewport.panBy(e.clientX - panX, e.clientY - panY);
    panX = e.clientX;
    panY = e.clientY;
  });
  const endPan = (e: PointerEvent) => {
    if (!panning) return;
    panning = false;
    viewportEl.releasePointerCapture(e.pointerId);
  };
  viewportEl.addEventListener("pointerup", endPan);
  viewportEl.addEventListener("pointercancel", endPan);
}

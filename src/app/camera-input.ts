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
  // and unreachable - fit it back in (no-op while it still fits). Coalesced to one
  // re-fit per frame so a burst of resize events (a drag-resize) doesn't thrash.
  let resizeRaf = 0;
  window.addEventListener("resize", () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      viewport.onResize();
    });
  });

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
  // whose draw handler ignores any button other than 0, so it never draws. Track
  // the captured pointerId so a second pointer landing mid-pan (another finger /
  // button) can't hijack the delta or end the pan early - only the owning pointer
  // drives it.
  let panId: number | null = null;
  let panX = 0;
  let panY = 0;
  viewportEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 1 || panId !== null) return;
    e.preventDefault();
    panId = e.pointerId;
    panX = e.clientX;
    panY = e.clientY;
    viewportEl.setPointerCapture(e.pointerId);
  });
  viewportEl.addEventListener("pointermove", (e) => {
    if (e.pointerId !== panId) return;
    viewport.panBy(e.clientX - panX, e.clientY - panY);
    panX = e.clientX;
    panY = e.clientY;
  });
  const endPan = (e: PointerEvent) => {
    if (e.pointerId !== panId) return;
    panId = null;
    viewportEl.releasePointerCapture(e.pointerId);
  };
  viewportEl.addEventListener("pointerup", endPan);
  viewportEl.addEventListener("pointercancel", endPan);
}

// Phones turn the corner-anchored panels into bottom sheets (see styles.css);
// must match that media query so the header gesture switches modes.
const MOBILE_QUERY = "(max-width: 640px)";
const DISMISS_PX = 90; // swipe the header down this far to close the sheet

// Make a fixed-position panel draggable by a handle element (its header).
// Desktop: drag repositions the panel (mirrors the toolbar's drag-dots).
// Mobile (bottom sheet): the header is instead a swipe-down-to-dismiss handle —
// repositioning is suppressed so inline left/top can't override the sheet CSS.
// Clicks on interactive controls inside the handle don't start either gesture.
export function makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
  let offsetX = 0;
  let offsetY = 0;
  let mode: "drag" | "swipe" | null = null;
  let swipeStartY = 0;
  let swipeDy = 0;

  handle.classList.add("drag-handle");

  const resetSwipe = () => {
    panel.style.transform = "";
    panel.style.opacity = "";
  };

  handle.addEventListener("pointerdown", (e) => {
    if (
      (e.target as HTMLElement).closest(
        "button, input, select, [contenteditable='true']",
      )
    )
      return;
    handle.setPointerCapture(e.pointerId);

    if (window.matchMedia(MOBILE_QUERY).matches) {
      mode = "swipe";
      swipeStartY = e.clientY;
      swipeDy = 0;
      return;
    }

    mode = "drag";
    const rect = panel.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    // Pin by left/top regardless of any right/bottom anchoring.
    panel.style.left = `${rect.left}px`;
    panel.style.top = `${rect.top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    handle.classList.add("dragging");
  });

  handle.addEventListener("pointermove", (e) => {
    if (!handle.hasPointerCapture(e.pointerId)) return;
    if (mode === "swipe") {
      swipeDy = Math.max(0, e.clientY - swipeStartY); // downward only
      panel.style.transform = `translateY(${swipeDy}px)`;
      panel.style.opacity = String(Math.max(0.4, 1 - swipeDy / 400));
    } else if (mode === "drag") {
      panel.style.left = `${e.clientX - offsetX}px`;
      panel.style.top = `${e.clientY - offsetY}px`;
    }
  });

  const end = (e: PointerEvent, cancelled: boolean) => {
    if (handle.hasPointerCapture(e.pointerId))
      handle.releasePointerCapture(e.pointerId);
    handle.classList.remove("dragging");
    if (mode === "swipe") {
      resetSwipe();
      if (!cancelled && swipeDy > DISMISS_PX) panel.style.display = "none";
    }
    mode = null;
  };
  handle.addEventListener("pointerup", (e) => end(e, false));
  handle.addEventListener("pointercancel", (e) => end(e, true));
}

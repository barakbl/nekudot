// Make a fixed-position panel draggable by a handle element (its header).
// Mirrors the toolbar's drag-dots behavior. Clicks on interactive controls
// inside the handle (close button, inputs, editable names) don't start a drag.
export function makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
  let offsetX = 0;
  let offsetY = 0;
  handle.classList.add("drag-handle");

  handle.addEventListener("pointerdown", (e) => {
    if (
      (e.target as HTMLElement).closest(
        "button, input, select, [contenteditable='true']",
      )
    )
      return;
    handle.setPointerCapture(e.pointerId);
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
    panel.style.left = `${e.clientX - offsetX}px`;
    panel.style.top = `${e.clientY - offsetY}px`;
  });

  handle.addEventListener("pointerup", (e) => {
    handle.releasePointerCapture(e.pointerId);
    handle.classList.remove("dragging");
  });
}

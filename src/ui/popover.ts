// Shared UI primitives (drag, toggles, window stacking, popovers) live here.

// Close a class-toggled popover when a mousedown lands outside `container`.
// This matches the navbar/menu pattern: the popover shows via an "open" class on
// `popover`, and `container` is the wrapper that holds both the trigger and the
// popover. A single persistent document listener (a no-op while closed) - cheap,
// and these menus are app-lifetime singletons, so there is nothing to tear down.
//
// Popovers that are created/destroyed per open and need capture-phase dismissal
// or layered Escape handling (the icon-select dropdown, the colour picker) wire
// their own listeners; this deliberately covers only the common case.
// Nudge an open, left-anchored popover left so it stays within the viewport.
// The navbar combos are `position: absolute; left: 0` under a pill that can sit
// against the right edge on a narrow phone; only shifts when it would overflow.
export function keepInViewport(popover: HTMLElement, margin = 8): void {
  popover.style.left = ""; // clear any prior nudge so we measure from left: 0
  const rect = popover.getBoundingClientRect();
  let shift = 0;
  const overflowRight = rect.right - (window.innerWidth - margin);
  if (overflowRight > 0) shift = -overflowRight;
  // Too wide to also clear the left edge: pin to the left margin instead.
  if (rect.left + shift < margin) shift = margin - rect.left;
  if (shift !== 0) popover.style.left = `${Math.round(shift)}px`;
}

export function closeOnOutsidePointer(
  container: HTMLElement,
  popover: HTMLElement,
): void {
  document.addEventListener("mousedown", (e) => {
    if (!popover.classList.contains("open")) return;
    if (container.contains(e.target as Node)) return;
    popover.classList.remove("open");
  });
}

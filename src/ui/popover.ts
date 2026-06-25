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

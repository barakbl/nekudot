// A tiny stacking manager for the app's floating panels (Brushes, Connecting,
// Layers, Maps, Symmetry, Shortcuts) so they behave like windows in a normal
// app: clicking anywhere on a panel raises it above the others, and showWindow()
// opens a panel and brings it to the front.
//
// We keep the panels in an explicit bottom→top order and re-assign z-indices
// from Z_BASE on every change, so the values stay bounded to [Z_BASE,
// Z_BASE + count). That band sits above the navbar but below the modals,
// tooltips and toasts (see their z-index in styles.css), which must stay on top.
const Z_BASE = 100;

// Registered panels, ordered bottom → top. The last entry is the frontmost.
const stack: HTMLElement[] = [];

function applyZ(): void {
  stack.forEach((el, i) => {
    el.style.zIndex = String(Z_BASE + i);
  });
}

// Bring a panel to the front (no-op if it's already there or unregistered).
export function raiseWindow(panel: HTMLElement): void {
  const i = stack.indexOf(panel);
  if (i < 0 || i === stack.length - 1) return;
  stack.splice(i, 1);
  stack.push(panel);
  applyZ();
}

// Register a floating panel once, at creation. A pointerdown anywhere on it
// raises it (capture phase, so inner handlers that stopPropagation don't block
// the focus-to-front behavior).
export function registerWindow(panel: HTMLElement): void {
  if (!stack.includes(panel)) {
    stack.push(panel);
    applyZ();
  }
  panel.addEventListener("pointerdown", () => raiseWindow(panel), true);
}

// Reveal a panel and bring it to the front. Used by the navbar buttons and the
// keyboard shortcuts, which now always open a panel (close via its × button)
// rather than toggling it shut.
export function showWindow(panel: HTMLElement): void {
  panel.style.display = "";
  raiseWindow(panel);
}

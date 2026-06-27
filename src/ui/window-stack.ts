import {
  clampHandleVisible,
  clampToViewport,
  HANDLE_MIN_VISIBLE,
  isMobileLayout,
} from "./drag";

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

// Each newly-shown panel steps CASCADE_STEP px down-right from its CSS anchor so
// open panels don't fully occlude one another, wrapping after CASCADE_WRAP steps.
const CASCADE_STEP = 24;
const CASCADE_WRAP = 6;
const OPEN_MARGIN = 8;

let cascadeCount = 0;

// Registered panels, ordered bottom → top. The last entry is the frontmost.
const stack: HTMLElement[] = [];

// Down-right offset for the n-th freshly-opened panel.
export function nextCascadeOffset(index: number): { x: number; y: number } {
  const i = ((index % CASCADE_WRAP) + CASCADE_WRAP) % CASCADE_WRAP;
  return { x: i * CASCADE_STEP, y: i * CASCADE_STEP };
}

// Only createPanel boxes opt in (not the self-positioning brush-preview window).
function isCascadeManaged(panel: HTMLElement): boolean {
  return panel.dataset.cascade === "1";
}

// Clears prior inline position first so repeated opens cascade from a stable
// origin rather than drifting.
function cascadePanel(panel: HTMLElement): void {
  if (isMobileLayout()) return; // mobile bottom sheets are CSS-positioned
  panel.style.left = "";
  panel.style.top = "";
  panel.style.right = "";
  panel.style.bottom = "";
  const rect = panel.getBoundingClientRect();
  const off = nextCascadeOffset(cascadeCount++);
  const pos = clampToViewport(
    { x: rect.left + off.x, y: rect.top + off.y },
    { w: rect.width, h: rect.height },
    { w: window.innerWidth, h: window.innerHeight },
    OPEN_MARGIN,
  );
  panel.style.left = `${pos.x}px`;
  panel.style.top = `${pos.y}px`;
  panel.style.right = "auto";
  panel.style.bottom = "auto";
}

// On resize, nudge back only the open panels that have gone out of reach, so
// CSS-anchored ones keep re-anchoring on their own.
function reclampVisible(): void {
  if (isMobileLayout()) return;
  const viewport = { w: window.innerWidth, h: window.innerHeight };
  for (const panel of stack) {
    if (!isCascadeManaged(panel) || panel.style.display === "none") continue;
    const rect = panel.getBoundingClientRect();
    const pos = clampHandleVisible(
      { x: rect.left, y: rect.top },
      { w: rect.width, h: rect.height },
      viewport,
      HANDLE_MIN_VISIBLE,
    );
    if (Math.abs(pos.x - rect.left) > 0.5 || Math.abs(pos.y - rect.top) > 0.5) {
      panel.style.left = `${pos.x}px`;
      panel.style.top = `${pos.y}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("resize", reclampVisible);
}

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
  const wasHidden = panel.style.display === "none";
  panel.style.display = "";
  if (wasHidden && isCascadeManaged(panel)) cascadePanel(panel);
  raiseWindow(panel);
}

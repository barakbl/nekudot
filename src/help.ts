// Lightweight help-hint framework.
//
//   attachHelp(someElement, "Explanation text…")
//
// A small "?" chip is inserted right after the element, hidden until help mode
// is on (toggled by the `?` key or the toggle in the Shortcuts panel). A mouse
// reveals the hint on hover; touch/pen reveals it on tap (tap again, tap away,
// or Escape to dismiss). The shown chip gets `.active` so it reads on touch
// where there's no hover.

const HELP_MODE_CLASS = "help-mode";

let activeIcon: HTMLElement | null = null;
let activeTooltip: HTMLElement | null = null;
const modeListeners = new Set<(on: boolean) => void>();

export function attachHelp(target: HTMLElement, text: string): HTMLElement {
  const icon = document.createElement("span");
  icon.className = "help-icon";
  icon.textContent = "?";
  icon.setAttribute("role", "button");
  icon.setAttribute("aria-label", "Help");
  icon.title = ""; // suppress native title; we render our own popover
  icon.dataset.helpText = text;

  target.insertAdjacentElement("afterend", icon);

  // Mouse: hover shows / leave hides. Touch & pen: tap toggles — preventDefault
  // stops the synthesized hover+click that would otherwise re-hide it instantly.
  icon.addEventListener("pointerenter", (e) => {
    if (e.pointerType === "mouse") show(icon, text);
  });
  icon.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse" && activeIcon === icon) hide();
  });
  icon.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    if (activeIcon === icon) hide();
    else show(icon, text);
  });
  // Don't let a click on the chip bubble to the panel/window behind it.
  icon.addEventListener("click", (e) => e.stopPropagation());

  return icon;
}

export function toggleHelpMode(): void {
  setHelpMode(!isHelpModeOn());
}

export function setHelpMode(on: boolean): void {
  if (on === isHelpModeOn()) return;
  document.body.classList.toggle(HELP_MODE_CLASS, on);
  if (!on) hide();
  for (const cb of modeListeners) cb(on);
}

export function isHelpModeOn(): boolean {
  return document.body.classList.contains(HELP_MODE_CLASS);
}

// Subscribe to help-mode on/off changes (e.g. the Shortcuts panel toggle stays
// in sync when toggled by the `?` key). Returns an unsubscribe fn.
export function onHelpModeChange(cb: (on: boolean) => void): () => void {
  modeListeners.add(cb);
  return () => modeListeners.delete(cb);
}

function show(icon: HTMLElement, text: string): void {
  if (!isHelpModeOn()) return;
  hide();
  const tip = document.createElement("div");
  tip.className = "help-tooltip";
  tip.textContent = text;
  document.body.appendChild(tip);
  position(tip, icon);
  icon.classList.add("active");
  activeIcon = icon;
  activeTooltip = tip;
}

function hide(): void {
  if (activeTooltip) {
    activeTooltip.remove();
    activeTooltip = null;
  }
  if (activeIcon) {
    activeIcon.classList.remove("active");
    activeIcon = null;
  }
}

function position(tip: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const gap = 6;
  const tipRect = tip.getBoundingClientRect();
  // Default to the right of the chip, vertically centred on it.
  let left = rect.right + gap;
  let top = rect.top + rect.height / 2 - tipRect.height / 2;
  const maxLeft = window.innerWidth - tipRect.width - 8;
  if (left > maxLeft) left = Math.max(8, rect.left - tipRect.width - gap);
  top = Math.min(Math.max(8, top), window.innerHeight - tipRect.height - 8);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

// Global dismissers: tap/click outside the active chip, or Escape.
document.addEventListener("click", (e) => {
  if (!activeIcon) return;
  if (activeIcon.contains(e.target as Node)) return;
  hide();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hide();
});

// Lightweight help-tooltip framework.
//
// Usage:
//   attachHelp(someElement, "Explanation text…")
//
// A tiny "?" icon is inserted right after the element. The icons are hidden
// until help mode is on (toggled via `toggleHelpMode()` — bound to `?`
// elsewhere). Hovering an icon (mouse) or tapping it (touch) shows a small
// popover; the popover hides on leave, on a tap outside, or on Escape.

const HELP_MODE_CLASS = "help-mode";

let activeIcon: HTMLElement | null = null;
let activeTooltip: HTMLElement | null = null;

export function attachHelp(target: HTMLElement, text: string): HTMLElement {
  const icon = document.createElement("span");
  icon.className = "help-icon";
  icon.textContent = "?";
  icon.setAttribute("role", "button");
  icon.setAttribute("aria-label", "Help");
  icon.title = ""; // suppress native title; we render our own popover
  icon.dataset.helpText = text;

  target.insertAdjacentElement("afterend", icon);

  icon.addEventListener("mouseenter", () => show(icon, text));
  icon.addEventListener("mouseleave", () => {
    if (activeIcon === icon) hide();
  });
  icon.addEventListener("click", (e) => {
    // For touch / explicit clicks: toggle.
    e.stopPropagation();
    if (activeIcon === icon) hide();
    else show(icon, text);
  });

  return icon;
}

export function toggleHelpMode(): void {
  document.body.classList.toggle(HELP_MODE_CLASS);
  if (!isHelpModeOn()) hide();
}

export function isHelpModeOn(): boolean {
  return document.body.classList.contains(HELP_MODE_CLASS);
}

function show(icon: HTMLElement, text: string): void {
  if (!isHelpModeOn()) return;
  hide();
  const tip = document.createElement("div");
  tip.className = "help-tooltip";
  tip.textContent = text;
  document.body.appendChild(tip);
  position(tip, icon);
  activeIcon = icon;
  activeTooltip = tip;
}

function hide(): void {
  if (activeTooltip) {
    activeTooltip.remove();
    activeTooltip = null;
  }
  activeIcon = null;
}

function position(tip: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  // Default: to the right of the icon, vertically aligned with its top.
  const gap = 6;
  let left = rect.right + gap;
  let top = rect.top;
  // Clamp inside viewport (rough).
  const tipRect = tip.getBoundingClientRect();
  const maxLeft = window.innerWidth - tipRect.width - 8;
  if (left > maxLeft) left = Math.max(8, rect.left - tipRect.width - gap);
  const maxTop = window.innerHeight - tipRect.height - 8;
  if (top > maxTop) top = maxTop;
  if (top < 8) top = 8;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

// Global dismissers.
document.addEventListener("click", (e) => {
  if (!activeIcon) return;
  if (activeIcon.contains(e.target as Node)) return;
  hide();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hide();
});

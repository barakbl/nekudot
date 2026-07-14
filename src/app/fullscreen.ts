import type { MenuAction } from "../menu";

// Fullscreen toggle for the toolbar. iPad Safari supports the Fullscreen API on
// elements (webkit-prefixed); iPhone Safari does not - so the button is
// feature-detected and buildNavbar leaves it out where it's unsupported.

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => void };

const fsDoc = document as FsDocument;

export function fullscreenSupported(): boolean {
  return Boolean(document.fullscreenEnabled || fsDoc.webkitFullscreenEnabled);
}

function isFullscreen(): boolean {
  return Boolean(document.fullscreenElement || fsDoc.webkitFullscreenElement);
}

function enterFullscreen(): void {
  const el = document.documentElement as FsElement;
  if (el.requestFullscreen) void el.requestFullscreen();
  else el.webkitRequestFullscreen?.();
}

function exitFullscreen(): void {
  if (document.exitFullscreen) void document.exitFullscreen();
  else fsDoc.webkitExitFullscreen?.();
}

// Corner-bracket glyphs matching the toolbar's other 14px stroke icons.
const ENTER_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4 H4 V8"/><path d="M16 4 H20 V8"/><path d="M8 20 H4 V16"/><path d="M16 20 H20 V16"/></svg>`;
const EXIT_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8 H8 V4"/><path d="M20 8 H16 V4"/><path d="M4 16 H8 V20"/><path d="M20 16 H16 V20"/></svg>`;
const CLASS = "nav-action-fullscreen";

// Reflect the current state on the rendered button. Queried by class so this
// stays decoupled from how the navbar builds its action buttons.
function syncButtons(): void {
  const full = isFullscreen();
  const label = full ? "Exit full screen" : "Full screen";
  for (const btn of document.querySelectorAll<HTMLElement>(`.${CLASS}`)) {
    btn.innerHTML = full ? EXIT_ICON : ENTER_ICON;
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }
}

// The toolbar action, or null on platforms that can't go fullscreen (iPhone).
export function makeFullscreenAction(): MenuAction | null {
  if (!fullscreenSupported()) return null;
  // Standard + webkit change events; the button glyph follows the actual state
  // (including the user pressing Esc to leave fullscreen).
  for (const ev of ["fullscreenchange", "webkitfullscreenchange"]) {
    document.addEventListener(ev, syncButtons);
  }
  return {
    label: "Full screen",
    className: CLASS,
    icon: ENTER_ICON,
    onClick: () => (isFullscreen() ? exitFullscreen() : enterFullscreen()),
  };
}

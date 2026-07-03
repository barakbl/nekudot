import type { Viewport } from "./viewport";

// How long the pill lingers after the last zoom change before it fades out.
const HOLD_MS = 800;

// A transient corner zoom % pill: hidden at rest, it flashes in while the zoom
// changes then fades, so the canvas stays clean. Click (while shown) resets to 100%.
export function createZoomReadout(viewport: Viewport): {
  el: HTMLButtonElement;
  refresh: () => void;
} {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "zoom-readout";
  el.title = "Reset zoom to 100%";
  el.setAttribute("aria-label", "Zoom level - click to reset to 100%");

  let lastPct = Math.round(viewport.scale * 100);
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const flash = (): void => {
    el.classList.add("is-visible");
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => el.classList.remove("is-visible"), HOLD_MS);
  };

  // Flash only on a ZOOM change - a pan fires onChange too, but this is a zoom
  // indicator, so an unchanged % stays hidden.
  const refresh = (): void => {
    const pct = Math.round(viewport.scale * 100);
    el.textContent = `${pct}%`;
    if (pct !== lastPct) {
      lastPct = pct;
      flash();
    }
  };

  el.addEventListener("click", () => viewport.zoomTo(1)); // onChange -> refresh -> flash

  return { el, refresh };
}

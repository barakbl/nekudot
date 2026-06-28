import type { Store } from "../store/base";
import type { UiVisibility } from "./ui-visibility";

// Docks in the navbar (UI visible) and pops out as a draggable floating circle
// when the UI is hidden, so there's always a touch-reliable way back (the
// 4-finger swipe is eaten by iPadOS).

const POS_KEY = "app.hideUiButton.pos";
const BTN = 40; // keep in sync with .hide-ui-btn.floating in styles.css
const MARGIN = 8;
const DRAG_THRESHOLD = 6;

// Docked uses an expand glyph, not an eye (an eye collides with the layers'
// visibility convention); floating uses the eye-slash.
const EXPAND = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"/><path d="M10 20H4v-6"/><path d="M20 4l-8 8"/><path d="M4 20l8-8"/></svg>`;
const EYE_OFF = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.2 4.1"/><path d="M6.6 6.6A18 18 0 0 0 2 12s3.5 7 10 7a10.9 10.9 0 0 0 4-.8"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>`;

export function createHideUiButton(opts: {
  uiVisibility: UiVisibility;
  store: Store;
  navbar: HTMLElement;
}): HTMLElement {
  const { uiVisibility, store, navbar } = opts;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "hide-ui-btn";
  btn.setAttribute("aria-label", "Hide all menus and panels");

  const place = (x: number, y: number) => {
    const maxX = window.innerWidth - BTN - MARGIN;
    const maxY = window.innerHeight - BTN - MARGIN;
    btn.style.left = `${Math.max(MARGIN, Math.min(maxX, x))}px`;
    btn.style.top = `${Math.max(MARGIN, Math.min(maxY, y))}px`;
  };

  const dock = () => {
    btn.classList.remove("floating");
    btn.style.left = "";
    btn.style.top = "";
    navbar.appendChild(btn);
  };
  const float = () => {
    document.body.appendChild(btn);
    btn.classList.add("floating");
    const saved = store.get<{ x: number; y: number }>(POS_KEY);
    if (saved && typeof saved.x === "number" && typeof saved.y === "number") {
      place(saved.x, saved.y);
    } else {
      place(window.innerWidth - BTN - 14, window.innerHeight - BTN - 22);
    }
  };

  const sync = () => {
    const hidden = uiVisibility.isHidden();
    btn.innerHTML = hidden ? EYE_OFF : EXPAND;
    btn.title = hidden ? "Show menus (drag to move)" : "Hide menus";
    btn.setAttribute(
      "aria-label",
      hidden ? "Show all menus and panels" : "Hide all menus and panels",
    );
    if (hidden) float();
    else dock();
  };
  dock();
  btn.innerHTML = EXPAND;
  btn.title = "Hide menus";
  uiVisibility.subscribe(sync);

  let downX = 0;
  let downY = 0;
  let startLeft = 0;
  let startTop = 0;
  let dragging = false;
  let moved = false;

  btn.addEventListener("pointerdown", (e) => {
    if (!btn.classList.contains("floating")) return; // docked: tap only, no drag
    dragging = true;
    moved = false;
    downX = e.clientX;
    downY = e.clientY;
    const r = btn.getBoundingClientRect();
    startLeft = r.left;
    startTop = r.top;
    btn.setPointerCapture(e.pointerId);
  });
  btn.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    if (!moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) moved = true;
    if (moved) place(startLeft + dx, startTop + dy);
  });
  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (btn.hasPointerCapture(e.pointerId)) btn.releasePointerCapture(e.pointerId);
    if (moved) {
      const r = btn.getBoundingClientRect();
      store.set(POS_KEY, { x: r.left, y: r.top });
    }
  };
  btn.addEventListener("pointerup", endDrag);
  btn.addEventListener("pointercancel", endDrag);
  btn.addEventListener("click", () => {
    if (moved) {
      moved = false; // a drag's trailing click isn't a toggle
      return;
    }
    uiVisibility.toggle("button");
  });

  window.addEventListener("resize", () => {
    if (btn.classList.contains("floating")) {
      const r = btn.getBoundingClientRect();
      place(r.left, r.top);
    }
  });

  return btn;
}

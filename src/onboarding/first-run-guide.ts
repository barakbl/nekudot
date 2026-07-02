import settings from "./settings.json";

// The first-run guide: a quiet, non-modal invitation to draw on the empty
// first-run canvas, plus a tips strip that surfaces AFTER the first stroke (so it
// never competes with the mandala bloom). Both are show-once and first-run only -
// the app gates start() to the same branch that opens the first mandala. The cue
// is pointer-transparent, so it can never eat the very pointerdown that dismisses
// it; motion is CSS and falls back to static under prefers-reduced-motion.

type Tip = { title: string; text: string };
const TIPS = (settings as { tips?: Tip[] }).tips ?? [];

// The strip surfaces the first few tips; the full set stays on the Start page.
const STRIP_TIP_COUNT = 3;
// After the first stroke lands, wait this long before the strip rises (the user
// is watching their bloom, not reading).
const STRIP_DELAY_MS = 700;
// Once shown, retire the strip after this many more strokes (they've clearly got
// it) or this idle timeout, whichever comes first.
const STRIP_STROKES_TO_RETIRE = 3;
const STRIP_IDLE_MS = 20000;
// Fade-out windows (kept in sync with the CSS transitions below).
const CUE_FADE_MS = 400;
const STRIP_FADE_MS = 320;

// A mini preview of the Round brush's mechanic: points along a shallow arc joined
// by straight links (a tiny web), the connectors self-drawing via stroke-dashoffset.
const CUE_GLYPH =
  '<svg class="frg-cue-glyph" viewBox="0 0 120 44" width="72" height="26" fill="none" aria-hidden="true">' +
  '<path class="frg-cue-arc" d="M12 34 L46 20 L78 16 L106 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<circle class="frg-cue-dot" cx="12" cy="34" r="3"/>' +
  '<circle class="frg-cue-dot" cx="46" cy="20" r="3"/>' +
  '<circle class="frg-cue-dot" cx="78" cy="16" r="3"/>' +
  '<circle class="frg-cue-dot frg-cue-lead" cx="106" cy="12" r="3.4"/>' +
  "</svg>";

export type FirstRunGuide = {
  start: () => void;
  notifyStrokeEnd: () => void;
  dispose: () => void;
};

export function createFirstRunGuide(opts: {
  mount: HTMLElement; // the viewport (fixed, full-window)
  tips?: Tip[]; // override for tests; defaults to settings.json
}): FirstRunGuide {
  const tips = (opts.tips ?? TIPS).slice(0, STRIP_TIP_COUNT);

  let started = false;
  let cue: HTMLElement | null = null;
  let strip: HTMLElement | null = null;
  let stripRetired = false;
  let strokes = 0;
  let strokesAtStripShow = -1;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const after = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
    return t;
  };

  const dismissCue = (): void => {
    if (!cue) return;
    const el = cue;
    cue = null;
    el.classList.add("is-dismissing");
    after(CUE_FADE_MS, () => el.remove());
  };

  const buildCue = (): HTMLElement => {
    const el = document.createElement("div");
    el.className = "frg-cue";
    el.setAttribute("aria-hidden", "true"); // decorative; the viewport carries the name
    el.innerHTML =
      CUE_GLYPH +
      '<div class="frg-cue-text">' +
      '<div class="frg-cue-primary">Drag to draw</div>' +
      '<div class="frg-cue-secondary">anywhere on the canvas</div>' +
      "</div>";
    return el;
  };

  const buildStrip = (): HTMLElement => {
    const el = document.createElement("div");
    el.className = "frg-tips";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Getting started tips");

    const head = document.createElement("div");
    head.className = "frg-tips-head";
    const heading = document.createElement("span");
    heading.className = "frg-tips-heading";
    heading.textContent = "A few ways to go further";
    const got = document.createElement("button");
    got.type = "button";
    got.className = "frg-tips-got";
    got.textContent = "Got it";
    got.addEventListener("click", () => retireStrip());
    head.append(heading, got);
    el.appendChild(head);

    const list = document.createElement("div");
    list.className = "frg-tips-list";
    for (const t of tips) {
      const row = document.createElement("p");
      row.className = "frg-tip";
      const b = document.createElement("b");
      b.textContent = t.title;
      row.append(b, document.createTextNode(" - " + t.text));
      list.appendChild(row);
    }
    el.appendChild(list);
    return el;
  };

  const showStrip = (): void => {
    if (strip || stripRetired || !tips.length) return;
    strip = buildStrip();
    opts.mount.appendChild(strip);
    // Let the base (offscreen) state paint before transitioning it in.
    after(20, () => strip?.classList.add("is-in"));
    strokesAtStripShow = strokes;
    after(STRIP_IDLE_MS, retireStrip);
  };

  function retireStrip(): void {
    stripRetired = true;
    const el = strip;
    strip = null;
    if (!el) return;
    el.classList.remove("is-in");
    el.classList.add("is-out");
    after(STRIP_FADE_MS, () => el.remove());
  }

  const onPointerDown = (): void => dismissCue();

  return {
    start(): void {
      if (started) return;
      started = true;
      cue = buildCue();
      opts.mount.appendChild(cue);
      // Passive + capture + once: fires on the first pointerdown without ever
      // blocking the stroke it starts, and self-removes.
      opts.mount.addEventListener("pointerdown", onPointerDown, {
        capture: true,
        passive: true,
        once: true,
      });
    },

    notifyStrokeEnd(): void {
      if (!started || stripRetired) return;
      strokes += 1;
      if (strokes === 1 && strokesAtStripShow < 0) {
        after(STRIP_DELAY_MS, showStrip);
      } else if (strip && strokes - strokesAtStripShow >= STRIP_STROKES_TO_RETIRE) {
        retireStrip();
      }
    },

    dispose(): void {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      opts.mount.removeEventListener("pointerdown", onPointerDown, { capture: true });
      cue?.remove();
      strip?.remove();
      cue = null;
      strip = null;
    },
  };
}

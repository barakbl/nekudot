// The brush-settings preview window: a big (~80% of screen, 1:1) centred, fixed
// (non-movable) panel opened from the Preview button in the settings panel. It is
// a single free-draw Playground - draw with the current brush + connection engine
// on its own canvas + point cloud, isolated from the artwork, at the real Size /
// Opacity / colour / art style. A Clear button wipes it; a paper-colour selector
// (Canvas / Light / Dark) sets the background; changing a setting updates the
// "what changed" hint line but never interrupts your drawing. The preview always
// connects to "both" (map routing is ignored). Closed with the x (no auto-dismiss).

import { CanvasRenderer } from "./renderer";
import { sizeCanvasForDpr } from "./canvas-size";
import { createBareHost, type PaintHost } from "./paint-host";
import { createNeighborFinder } from "./neighbor-finder";
import { makeCloseButton } from "./settings-panel";
import type { BrushBase } from "./base";
import type { Store } from "./store/base";
import tipsData from "./brush-preview-tips.json";

// Rotating tips shown in the window footer (edit src/brush-preview-tips.json).
type Tip = { text: string; link?: { href: string; label: string } };
const TIPS = tipsData as Tip[];

const BG_KEY = "app.brushPreview.bg";
const DARK_BG = "#16161a";
const LIGHT_BG = "#ffffff";

type Pt = { x: number; y: number };

// The setting that just changed, shown in the preview's info box.
export type PreviewChange = { label: string; value: string; help?: string };

export type BrushPreviewOpts = {
  // Build a throwaway brush configured like the active one, bound to `host`.
  makeBrush: (host: PaintHost) => BrushBase | null;
  size: () => number; // current stroke width
  alpha: () => number; // current stroke opacity
  color: () => string; // current primary (stroke) colour
  background: () => string; // the real artwork canvas background (the "Canvas" bg option)
  dpr: number;
  store: Store; // persists the chosen background
  // Optional window-stack hooks so the panel raises/orders like the others.
  registerWindow?: (el: HTMLElement) => void;
  showWindow?: (el: HTMLElement) => void;
};

export type BrushPreview = {
  open: () => void; // reveal the window (Preview button)
  onSettingChanged: (change?: PreviewChange) => void; // a setting changed -> refresh the hint line
};

export function createBrushPreview(opts: BrushPreviewOpts): BrushPreview {
  let win: HTMLElement | null = null;
  let builtSide = 0;

  let canvas: HTMLCanvasElement | null = null;
  let renderer: CanvasRenderer | null = null;
  let host: PaintHost | null = null;
  let finder: ReturnType<typeof createNeighborFinder> | null = null;

  let infoEl: HTMLElement | null = null;
  let bgBtns: { val: string; el: HTMLButtonElement }[] = [];
  let tipTextEl: HTMLElement | null = null;
  let tipIdx = 0;
  let lastChange: PreviewChange | undefined;

  let brush: BrushBase | null = null;
  let drawing = false;
  let hintTip: HTMLElement | null = null;

  const side = (): number => Math.round(0.8 * Math.min(window.innerWidth, window.innerHeight));

  const makeCanvas = (
    s: number,
  ): { canvas: HTMLCanvasElement; renderer: CanvasRenderer } | null => {
    const cv = document.createElement("canvas");
    cv.className = "brush-preview-canvas";
    sizeCanvasForDpr(cv, s, s, opts.dpr);
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    const r = new CanvasRenderer(ctx, { dpr: opts.dpr, lineCap: "round", lineJoin: "round" });
    return { canvas: cv, renderer: r };
  };

  const bareHostFor = (
    r: CanvasRenderer,
    f: ReturnType<typeof createNeighborFinder>,
  ): PaintHost => {
    const h = createBareHost(r, f);
    // The bare host reports width/alpha as 1; feed the live stroke values so the
    // demo matches the current Size / Opacity sliders.
    h.strokeWidth = () => opts.size();
    h.strokeAlpha = () => opts.alpha();
    return h;
  };

  // The canvas itself stays transparent; the chosen paper colour is a CSS
  // background on the element, so switching it is instant and never wipes a
  // drawing.
  const resetCanvas = (r: CanvasRenderer): void => {
    r.setEraseMode(false);
    r.clear();
    r.setStrokeStyle(opts.color());
    r.setLineWidth(opts.size());
    r.setGlobalAlpha(opts.alpha());
  };

  // "canvas" (default) = the real artwork paper; "light"/"dark" override it.
  const bgChoice = (): string => opts.store.get<string>(BG_KEY) ?? "canvas";
  const bgColor = (): string => {
    const c = bgChoice();
    if (c === "dark") return DARK_BG;
    if (c === "light") return LIGHT_BG;
    return opts.background();
  };
  const applyBg = (): void => {
    if (canvas) canvas.style.backgroundColor = bgColor();
  };
  const syncBg = (): void => {
    const cur = bgChoice();
    for (const b of bgBtns) b.el.classList.toggle("active", b.val === cur);
  };
  const setBg = (val: string): void => {
    opts.store.set(BG_KEY, val);
    applyBg();
    syncBg();
  };

  // --- the always-on "?" hint (reuses the settings help text + tooltip style) --
  const hideHint = (): void => {
    hintTip?.remove();
    hintTip = null;
  };
  const showHint = (icon: HTMLElement, text: string): void => {
    hideHint();
    const tip = document.createElement("div");
    tip.className = "help-tooltip";
    tip.textContent = text;
    document.body.appendChild(tip);
    const r = icon.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let left = Math.min(r.left, window.innerWidth - tr.width - 8);
    left = Math.max(8, left);
    let top = r.bottom + 6;
    if (top + tr.height > window.innerHeight - 8) top = r.top - tr.height - 6;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
    hintTip = tip;
  };
  const makeHint = (text: string): HTMLElement => {
    const icon = document.createElement("span");
    icon.className = "brush-preview-help";
    icon.textContent = "?";
    icon.setAttribute("role", "button");
    icon.setAttribute("aria-label", "What this setting does");
    icon.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "mouse") showHint(icon, text);
    });
    icon.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse") hideHint();
    });
    icon.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse") return;
      e.preventDefault();
      e.stopPropagation();
      hintTip ? hideHint() : showHint(icon, text);
    });
    return icon;
  };

  // The "what changed" line: a standing invite until a setting is changed, then
  // the last change (name + value, with its "?" help) so you can read the hint
  // while drawing.
  const refreshInfo = (): void => {
    hideHint();
    if (!infoEl) return;
    const el = infoEl;
    el.replaceChildren();
    if (!lastChange) {
      const m = document.createElement("span");
      m.className = "brush-preview-info-empty";
      m.textContent = "Draw here to try the brush - tweak a setting, then draw again.";
      el.append(m);
      return;
    }
    const name = document.createElement("span");
    name.className = "brush-preview-info-name";
    name.textContent = lastChange.label;
    const val = document.createElement("span");
    val.className = "brush-preview-info-val";
    val.textContent = lastChange.value;
    el.append(name, val);
    if (lastChange.help) el.append(makeHint(lastChange.help));
  };

  const pos = (cv: HTMLCanvasElement, e: PointerEvent): Pt => {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top }; // CSS px = logical px
  };

  const wirePlayground = (cv: HTMLCanvasElement): void => {
    cv.addEventListener("pointerdown", (e) => {
      if (!renderer || !host) return;
      drawing = true;
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {
        /* capture unsupported */
      }
      renderer.setStrokeStyle(opts.color());
      renderer.setLineWidth(opts.size());
      renderer.setGlobalAlpha(opts.alpha());
      brush = opts.makeBrush(host); // fresh brush picks up the latest settings
      const p = pos(cv, e);
      try {
        brush?.strokeStart(p.x, p.y);
        brush?.stroke(p.x, p.y, true);
      } catch {
        /* ignore */
      }
    });
    cv.addEventListener("pointermove", (e) => {
      if (!drawing || !brush) return;
      const p = pos(cv, e);
      try {
        brush.stroke(p.x, p.y, true);
      } catch {
        /* ignore */
      }
    });
    const end = (): void => {
      if (!drawing) return;
      drawing = false;
      try {
        brush?.strokeEnd();
      } catch {
        /* ignore */
      }
      brush = null;
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("pointerleave", end);
  };

  const clearPlayground = (): void => {
    finder?.clear();
    if (renderer) resetCanvas(renderer);
  };

  const renderTip = (): void => {
    if (!tipTextEl || TIPS.length === 0) return;
    const tip = TIPS[((tipIdx % TIPS.length) + TIPS.length) % TIPS.length];
    tipTextEl.replaceChildren(document.createTextNode(tip.text + (tip.link ? " " : "")));
    if (tip.link) {
      const a = document.createElement("a");
      a.className = "brush-preview-tip-link";
      a.href = tip.link.href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = `${tip.link.label} →`;
      tipTextEl.append(a);
    }
  };
  const showTip = (dir: number): void => {
    tipIdx += dir;
    renderTip();
  };

  const build = (s: number): boolean => {
    const made = makeCanvas(s);
    if (!made) return false;
    builtSide = s;
    canvas = made.canvas;
    renderer = made.renderer;
    finder = createNeighborFinder("quadtree", []);
    host = bareHostFor(renderer, finder);

    win = document.createElement("div");
    // `app-modal` makes bindShortcuts treat the open window as a modal, so app
    // shortcuts (undo/redo, brush keys…) don't fire while you're previewing.
    win.className = "brush-preview-window app-modal";

    const head = document.createElement("div");
    head.className = "brush-preview-head";
    const title = document.createElement("h3");
    title.textContent = "Brush preview";
    // Paper-colour selector: Canvas (match the artwork, default) / Light / Dark.
    const bgSeg = document.createElement("div");
    bgSeg.className = "brush-preview-bgseg";
    bgBtns = [
      { val: "canvas", glyph: "▢", title: "Match canvas background" },
      { val: "light", glyph: "☀", title: "Light background" },
      { val: "dark", glyph: "☾", title: "Dark background" },
    ].map(({ val, glyph, title }) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "brush-preview-bgbtn";
      b.textContent = glyph;
      b.title = title;
      b.addEventListener("click", () => setBg(val));
      bgSeg.append(b);
      return { val, el: b };
    });
    const headRight = document.createElement("div");
    headRight.className = "brush-preview-head-right";
    headRight.append(bgSeg, makeCloseButton(close));
    head.append(title, headRight);

    // Top strip: the "what changed" info line.
    const topEl = document.createElement("div");
    topEl.className = "brush-preview-top";
    infoEl = document.createElement("div");
    infoEl.className = "brush-preview-info";
    topEl.append(infoEl);

    const stage = document.createElement("div");
    stage.className = "brush-preview-stage";
    stage.append(canvas);
    wirePlayground(canvas);

    // Footer bar: rotating tips on the left, the Clear button on the right.
    const bar = document.createElement("div");
    bar.className = "brush-preview-bar";
    const tipsBox = document.createElement("div");
    tipsBox.className = "brush-preview-tips";
    const tipPrev = document.createElement("button");
    tipPrev.type = "button";
    tipPrev.className = "brush-preview-tip-nav";
    tipPrev.textContent = "←";
    tipPrev.title = "Previous tip";
    tipPrev.addEventListener("click", () => showTip(-1));
    tipTextEl = document.createElement("span");
    tipTextEl.className = "brush-preview-tip-text";
    const tipNext = document.createElement("button");
    tipNext.type = "button";
    tipNext.className = "brush-preview-tip-nav";
    tipNext.textContent = "→";
    tipNext.title = "Next tip";
    tipNext.addEventListener("click", () => showTip(1));
    tipsBox.append(tipPrev, tipTextEl, tipNext);
    renderTip();
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "brush-preview-clear";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", clearPlayground);
    bar.append(tipsBox, clearBtn);

    win.append(head, topEl, stage, bar);
    document.body.appendChild(win);
    opts.registerWindow?.(win);
    applyBg();
    syncBg();
    resetCanvas(renderer);
    refreshInfo();
    return true;
  };

  function close(): void {
    hideHint();
    if (win) win.style.display = "none";
  }

  const open = (): void => {
    // Rebuild if the screen size changed enough to matter (e.g. rotation).
    if (win && side() !== builtSide) {
      win.remove();
      win = null;
    }
    if (!win && !build(side())) return;
    if (!win) return;
    win.style.display = "";
    opts.showWindow?.(win);
    applyBg(); // keep the "Canvas" option in sync with the live artwork paper
    syncBg();
    refreshInfo();
  };

  const onSettingChanged = (change?: PreviewChange): void => {
    if (!win || win.style.display === "none") return; // only while open
    if (change) lastChange = change;
    refreshInfo(); // a setting change updates the hint line; it never interrupts drawing
  };

  return { open, onSettingChanged };
}

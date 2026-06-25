// The brush-settings preview window: a big (≈80% of screen, 1:1) centered, fixed
// (non-movable) panel opened from the Preview button in the settings panel. Its
// tab bar is one tab per scripted scene (Wave / Circles / Spiral / Scribble) plus
// a Playground tab last:
//   - A scene tab replays that scene through the real brush whenever a setting
//     changes, over a small seeded "memory map" so the connecting web shows; a
//     box names the setting that just changed with a "?" hint reusing the
//     settings help text. The stroke speeds up over its last half second. The
//     active scene is persisted.
//   - Playground: draw freely with the current brush; a Clear button wipes it. A
//     setting change while on Playground does nothing (it won't interrupt you).
// Both run the genuine brush + connection engine on their own canvas + point
// cloud, isolated from the artwork, at the real Size / Opacity / colour / art
// style. The preview always connects to "both" (map routing is ignored). Closed
// with the × (no auto-dismiss).

import { CanvasRenderer } from "./renderer";
import { createBareHost, type PaintHost } from "./paint-host";
import { createNeighborFinder } from "./neighbor-finder";
import { makeCloseButton } from "./settings-panel";
import type { BrushBase } from "./base";
import type { Store } from "./store/base";
import tipsData from "./brush-preview-tips.json";

// Rotating tips shown in the window footer (edit src/brush-preview-tips.json).
type Tip = { text: string; link?: { href: string; label: string } };
const TIPS = tipsData as Tip[];

// Settle a slider drag before replaying ("settle, then play"). A change while a
// run is playing restarts it once you stop moving.
const DEBOUNCE_MS = 200;
// The scene is replayed a couple of times, each pass nudged a few px, so the
// build-up of long/repeated work shows. Playback length scales with how many
// points the scene has (PACE_MS each), clamped, so it's an even, unhurried pace;
// the very last stretch plays faster.
const REPEATS = 2;
const PACE_MS = 14;
// Duration is clamped to this band; widened so the Speed slider actually bites.
const MIN_TOTAL_MS = 2200;
const MAX_TOTAL_MS = 7200;
const TAIL_MS = 600; // final faster stretch
const TAIL_FRACTION = 0.18; // share of points covered in that final stretch
const SHIFT_PX = 4; // per-pass offset

const SCENE_KEY = "app.brushPreview.scene";
const BG_KEY = "app.brushPreview.bg";
const SPEED_KEY = "app.brushPreview.speed";
const SPEED_MIN = 0.4;
const SPEED_MAX = 2.6;
const PLAYGROUND = "playground";
const DARK_BG = "#16161a";
const LIGHT_BG = "#ffffff";

type Pt = { x: number; y: number };

// A scene draws one "figure" big in the centre plus four smaller copies on the
// sides, so the behaviour is shown at several scales/places. `figure` lays out a
// figure centred at (cx,cy) within radius `boxR`, with adjacent lines `gap` px
// apart (normalized to Reach/weight/opacity by the caller) and at most `maxLines`
// of them. Multiple sub-strokes = the web weaves between the lines.
type Scene = { id: string; label: string; figure: Figure };
type Figure = (cx: number, cy: number, boxR: number, gap: number, maxLines: number) => Pt[][];

const clampLines = (boxR: number, gap: number, max: number): number =>
  Math.max(2, Math.min(max, Math.floor((2 * boxR) / gap) + 1));
const pointsFor = (boxR: number): number => Math.max(10, Math.min(26, Math.round(boxR / 5)));

function circle(cx: number, cy: number, r: number, n: number): Pt[] {
  const pts: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r });
  }
  return pts;
}

// Parallel wavy lines, `gap` apart.
const waveFigure: Figure = (cx, cy, boxR, gap, maxLines) => {
  const g = Math.min(gap, boxR / 1.5);
  const n = clampLines(boxR, g, maxLines);
  const M = pointsFor(boxR);
  const amp = Math.min(g * 0.42, boxR * 0.35);
  const segs: Pt[][] = [];
  for (let i = 0; i < n; i++) {
    const y = cy + (i - (n - 1) / 2) * g;
    const line: Pt[] = [];
    for (let k = 0; k <= M; k++) {
      const u = k / M;
      line.push({ x: cx - boxR + 2 * boxR * u, y: y + Math.sin(u * Math.PI * 3) * amp });
    }
    segs.push(line);
  }
  return segs;
};

// Concentric rings, `gap` apart (a small circle inside bigger ones).
const circlesFigure: Figure = (cx, cy, boxR, gap, maxLines) => {
  const g = Math.min(gap, boxR / 2);
  const n = Math.max(2, Math.min(maxLines, Math.floor(boxR / g)));
  const segs: Pt[][] = [];
  for (let i = 1; i <= n; i++) {
    const r = i * g;
    if (r > boxR + 0.5) break;
    segs.push(circle(cx, cy, r, Math.max(16, pointsFor(boxR) + i * 4)));
  }
  return segs;
};

// An archimedean spiral whose turns are `gap` apart.
const spiralFigure: Figure = (cx, cy, boxR, gap, maxLines) => {
  const g = Math.min(gap, boxR / 2);
  const turns = Math.max(2, Math.min(maxLines, Math.floor(boxR / g)));
  const rMax = Math.min(boxR, turns * g);
  const N = Math.max(24, turns * 18);
  const pts: Pt[] = [];
  for (let k = 0; k <= N; k++) {
    const u = k / N;
    const a = u * turns * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * rMax * u, y: cy + Math.sin(a) * rMax * u });
  }
  return [pts];
};

// A free 3:2 Lissajous knot — lots of crossings; sized to the box.
const scribbleFigure: Figure = (cx, cy, boxR) => {
  const A = boxR;
  const B = boxR * 0.82;
  const N = Math.max(40, Math.round(boxR / 2));
  const pts: Pt[] = [];
  for (let k = 0; k <= N; k++) {
    const t = (k / N) * Math.PI * 2;
    pts.push({ x: cx + A * Math.sin(3 * t + Math.PI / 2), y: cy + B * Math.sin(2 * t) });
  }
  return [pts];
};

const SCENES: Scene[] = [
  { id: "wave", label: "Wave", figure: waveFigure },
  { id: "circles", label: "Circles", figure: circlesFigure },
  { id: "spiral", label: "Spiral", figure: spiralFigure },
  { id: "scribble", label: "Scribble", figure: scribbleFigure },
];

// Lay out a scene as a quincunx (the 5 on a die): a big hero figure in the
// centre with four smaller copies in the corners, which fills the square evenly.
function composeScene(s: number, gap: number, figure: Figure): Pt[][] {
  const segs: Pt[][] = [];
  const push = (arr: Pt[][]): void => {
    for (const seg of arr) segs.push(seg);
  };
  push(figure(s / 2, s / 2, s * 0.2, gap, 5));
  const c = s * 0.2; // corner inset
  const r = s * 0.11;
  for (const [cx, cy] of [
    [c, c],
    [s - c, c],
    [c, s - c],
    [s - c, s - c],
  ] as const) {
    push(figure(cx, cy, r, gap, 3));
  }
  return segs;
}

// Line spacing normalized to the live Reach / Web weight / Opacity: kept within
// Reach so the web always connects, and pulled closer as weight + opacity drop so
// the web reads densely. Clamped so a figure always has a few lines that fit.
function spacingFor(reach: number, weight: number, alpha: number, s: number): number {
  const wN = Math.min(1, Math.max(0, (weight - 1) / 11)); // strands 1..12
  const aN = Math.min(1, Math.max(0, alpha));
  const factor = 0.35 + 0.45 * wN + 0.2 * aN; // ~0.35 (light/faint) .. 1.0
  return Math.max(8, Math.min(reach * factor, s * 0.16));
}

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
  store: Store; // persists the chosen scene + background
  // Optional window-stack hooks so the panel raises/orders like the others.
  registerWindow?: (el: HTMLElement) => void;
  showWindow?: (el: HTMLElement) => void;
};

export type BrushPreview = {
  open: () => void; // reveal the window (Preview button)
  onSettingChanged: (change?: PreviewChange) => void; // a setting changed → replay if open
};

export function createBrushPreview(opts: BrushPreviewOpts): BrushPreview {
  let win: HTMLElement | null = null;
  let builtSide = 0;
  let tab = SCENES[0].id; // a scene id, or PLAYGROUND

  let pvCanvas: HTMLCanvasElement | null = null;
  let pvRenderer: CanvasRenderer | null = null;
  let pgCanvas: HTMLCanvasElement | null = null;
  let pgRenderer: CanvasRenderer | null = null;
  let pgHost: PaintHost | null = null;
  let pgFinder: ReturnType<typeof createNeighborFinder> | null = null;

  let topEl: HTMLElement | null = null;
  let infoEl: HTMLElement | null = null;
  let speedEl: HTMLElement | null = null;
  let tabBtns: { key: string; el: HTMLButtonElement }[] = [];
  let bgBtns: { val: string; el: HTMLButtonElement }[] = [];
  let clearBar: HTMLElement | null = null;
  let clearBtn: HTMLButtonElement | null = null;
  let tipTextEl: HTMLElement | null = null;
  let tipIdx = 0;
  let lastChange: PreviewChange | undefined;

  let debounceTimer: number | null = null;
  let rafId: number | null = null;
  let pgBrush: BrushBase | null = null;
  let drawing = false;
  let hintTip: HTMLElement | null = null;

  const reduceMotion = (): boolean =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

  const clearTimer = (id: number | null): null => {
    if (id !== null) window.clearTimeout(id);
    return null;
  };
  const cancelRaf = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  const side = (): number => Math.round(0.8 * Math.min(window.innerWidth, window.innerHeight));

  const currentScene = (): Scene => {
    const id = tab === PLAYGROUND ? opts.store.get<string>(SCENE_KEY) : tab;
    return SCENES.find((sc) => sc.id === id) ?? SCENES[0];
  };

  const makeCanvas = (
    s: number,
  ): { canvas: HTMLCanvasElement; renderer: CanvasRenderer } | null => {
    const canvas = document.createElement("canvas");
    canvas.className = "brush-preview-canvas";
    canvas.width = Math.round(s * opts.dpr);
    canvas.height = Math.round(s * opts.dpr);
    canvas.style.width = `${s}px`;
    canvas.style.height = `${s}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const renderer = new CanvasRenderer(ctx, { dpr: opts.dpr, lineCap: "round", lineJoin: "round" });
    return { canvas, renderer };
  };

  const bareHostFor = (
    renderer: CanvasRenderer,
    finder: ReturnType<typeof createNeighborFinder>,
  ): PaintHost => {
    const host = createBareHost(renderer, finder);
    // The bare host reports width/alpha as 1; feed the live stroke values so the
    // demo matches the current Size / Opacity sliders.
    host.strokeWidth = () => opts.size();
    host.strokeAlpha = () => opts.alpha();
    return host;
  };

  // The canvas itself stays transparent; the chosen paper colour is a CSS
  // background on the element, so switching it is instant and never wipes a
  // playground drawing.
  const resetCanvas = (renderer: CanvasRenderer): void => {
    renderer.setEraseMode(false);
    renderer.clear();
    renderer.setStrokeStyle(opts.color());
    renderer.setLineWidth(opts.size());
    renderer.setGlobalAlpha(opts.alpha());
  };

  const speedVal = (): number => {
    const v = opts.store.get<number>(SPEED_KEY);
    return typeof v === "number" ? Math.min(SPEED_MAX, Math.max(SPEED_MIN, v)) : 1;
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
    const col = bgColor();
    if (pvCanvas) pvCanvas.style.backgroundColor = col;
    if (pgCanvas) pgCanvas.style.backgroundColor = col;
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

  // The "what changed" line. On Playground it's a standing invite; on a scene it
  // shows the last change (with its "?" help) or a prompt until one happens.
  const refreshInfo = (): void => {
    hideHint();
    if (!infoEl) return;
    const el = infoEl; // capture so the closure below can use the narrowed non-null value
    el.replaceChildren();
    const message = (text: string): void => {
      const m = document.createElement("span");
      m.className = "brush-preview-info-empty";
      m.textContent = text;
      el.append(m);
    };
    if (!lastChange) {
      // Standing prompt until a setting is changed - phrased per tab.
      message(
        tab === PLAYGROUND
          ? "Draw here to try the brush - tweak a setting, then draw again."
          : "Move a slider to see what it does.",
      );
      return;
    }
    // Once a setting changes, show it (with its "?" help) on every tab, so you
    // can read the hint while drawing in the Playground too.
    const name = document.createElement("span");
    name.className = "brush-preview-info-name";
    name.textContent = lastChange.label;
    const val = document.createElement("span");
    val.className = "brush-preview-info-val";
    val.textContent = lastChange.value;
    infoEl.append(name, val);
    if (lastChange.help) infoEl.append(makeHint(lastChange.help));
  };

  const pos = (canvas: HTMLCanvasElement, e: PointerEvent): Pt => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top }; // CSS px = logical px
  };

  const wirePlayground = (canvas: HTMLCanvasElement): void => {
    canvas.addEventListener("pointerdown", (e) => {
      if (!pgRenderer || !pgHost) return;
      drawing = true;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* capture unsupported */
      }
      pgRenderer.setStrokeStyle(opts.color());
      pgRenderer.setLineWidth(opts.size());
      pgRenderer.setGlobalAlpha(opts.alpha());
      pgBrush = opts.makeBrush(pgHost); // fresh brush picks up the latest settings
      const p = pos(canvas, e);
      try {
        pgBrush?.strokeStart(p.x, p.y);
        pgBrush?.stroke(p.x, p.y, true);
      } catch {
        /* ignore */
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing || !pgBrush) return;
      const p = pos(canvas, e);
      try {
        pgBrush.stroke(p.x, p.y, true);
      } catch {
        /* ignore */
      }
    });
    const end = (): void => {
      if (!drawing) return;
      drawing = false;
      try {
        pgBrush?.strokeEnd();
      } catch {
        /* ignore */
      }
      pgBrush = null;
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", end);
  };

  const clearPlayground = (): void => {
    pgFinder?.clear();
    if (pgRenderer) resetCanvas(pgRenderer);
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

  const setTab = (key: string): void => {
    tab = key;
    const isPlay = key === PLAYGROUND;
    for (const b of tabBtns) b.el.classList.toggle("active", b.key === key);
    if (!isPlay) opts.store.set(SCENE_KEY, key); // the scene IS the tab
    if (pvCanvas) pvCanvas.style.display = isPlay ? "none" : "";
    if (pgCanvas) pgCanvas.style.display = isPlay ? "" : "none";
    // The bottom bar holds the speed slider on scenes, the Clear button on
    // Playground - same spot, one at a time.
    if (speedEl) speedEl.style.display = isPlay ? "none" : "";
    if (clearBtn) clearBtn.style.display = isPlay ? "" : "none";
    refreshInfo();
    if (!isPlay) runPreview();
  };

  const build = (s: number): boolean => {
    const pv = makeCanvas(s);
    const pg = makeCanvas(s);
    if (!pv || !pg) return false;
    builtSide = s;
    pvCanvas = pv.canvas;
    pvRenderer = pv.renderer;
    pgCanvas = pg.canvas;
    pgRenderer = pg.renderer;
    pgFinder = createNeighborFinder("quadtree", []);
    pgHost = bareHostFor(pgRenderer, pgFinder);

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

    // Tab bar: one tab per scene, then Playground (pushed to the right).
    const tabs = document.createElement("div");
    tabs.className = "brush-preview-tabs";
    tabBtns = [];
    const mkTab = (label: string, key: string, extra?: string): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "brush-preview-tab" + (extra ? " " + extra : "");
      b.textContent = label;
      b.addEventListener("click", () => setTab(key));
      tabBtns.push({ key, el: b });
      return b;
    };
    for (const sc of SCENES) tabs.append(mkTab(sc.label, sc.id));
    tabs.append(mkTab("Playground", PLAYGROUND, "brush-preview-tab-play"));

    // Top strip: the "what changed" info line (shown on every tab).
    topEl = document.createElement("div");
    topEl.className = "brush-preview-top";
    infoEl = document.createElement("div");
    infoEl.className = "brush-preview-info";
    topEl.append(infoEl);

    const stage = document.createElement("div");
    stage.className = "brush-preview-stage";
    pgCanvas.style.display = "none";
    stage.append(pvCanvas, pgCanvas);
    wirePlayground(pgCanvas);

    // Bottom bar (footer): rotating tips on the left; the play-speed slider on
    // scenes / the Clear button on Playground on the right (same spot, one at a time).
    clearBar = document.createElement("div");
    clearBar.className = "brush-preview-bar";
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
    speedEl = document.createElement("div");
    speedEl.className = "brush-preview-speed";
    const speedLbl = document.createElement("span");
    speedLbl.textContent = "Speed";
    const speedInput = document.createElement("input");
    speedInput.type = "range";
    speedInput.min = String(SPEED_MIN);
    speedInput.max = String(SPEED_MAX);
    speedInput.step = "0.1";
    speedInput.value = String(speedVal());
    speedInput.title = "Playback speed";
    speedInput.addEventListener("change", () => {
      opts.store.set(SPEED_KEY, Number(speedInput.value));
      runPreview(); // replay at the new speed so the change is visible
    });
    speedEl.append(speedLbl, speedInput);
    clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "brush-preview-clear";
    clearBtn.textContent = "Clear";
    clearBtn.addEventListener("click", clearPlayground);
    clearBar.append(tipsBox, speedEl, clearBtn);

    win.append(head, tabs, topEl, stage, clearBar);
    document.body.appendChild(win);
    opts.registerWindow?.(win);
    applyBg();
    syncBg();
    resetCanvas(pvRenderer);
    resetCanvas(pgRenderer);
    return true;
  };

  function close(): void {
    cancelRaf();
    hideHint();
    debounceTimer = clearTimer(debounceTimer);
    if (win) win.style.display = "none";
  }

  function runPreview(): void {
    if (!pvRenderer) return;
    cancelRaf();
    applyBg(); // keep the "Canvas" option in sync with the live artwork paper
    resetCanvas(pvRenderer);

    // Fresh point cloud per run so a re-fire never weaves into stale points.
    const finder = createNeighborFinder("quadtree", []);
    const host = bareHostFor(pvRenderer, finder);
    const brush = opts.makeBrush(host);
    if (!brush) return; // e.g. the eraser — nothing to show on blank paper

    // Normalize the line spacing to the live Reach / Web weight / Opacity (read
    // off the preview brush's connection), so the lines sit within reach and the
    // web reads clearly — closer together as weight + opacity drop.
    const flatConn = brush.activeConnection?.()?.toFlat?.();
    const reach = typeof flatConn?.radius === "number" ? flatConn.radius : 40;
    const weight = typeof flatConn?.strands === "number" ? flatConn.strands : 1;
    const gap = spacingFor(reach, weight, opts.alpha(), builtSide);
    const segs = composeScene(builtSide, gap, currentScene().figure);

    // Replay the scene REPEATS times, each pass nudged a few px and accumulating
    // into the SAME cloud, so the web builds up like real repeated/long work.
    // Each segment (and each pass) gets a unique id so the animator starts/ends a
    // sub-stroke at every boundary.
    const flat: { x: number; y: number; seg: number }[] = [];
    let segId = 0;
    for (let p = 0; p < REPEATS; p++) {
      const dx = p * SHIFT_PX;
      const dy = p * SHIFT_PX * 0.6;
      for (const seg of segs) {
        for (const pt of seg) flat.push({ x: pt.x + dx, y: pt.y + dy, seg: segId });
        segId++;
      }
    }
    if (flat.length === 0) return;
    // Even, unhurried pace that scales with how much there is to draw, divided by
    // the user's chosen play speed.
    const totalMs = Math.max(
      MIN_TOTAL_MS,
      Math.min(MAX_TOTAL_MS, (flat.length * PACE_MS) / speedVal()),
    );

    let i = 0;
    let curSeg = -1;
    let started = false;
    const advanceTo = (target: number): void => {
      try {
        while (i <= target && i < flat.length) {
          const p = flat[i];
          if (p.seg !== curSeg) {
            if (started) brush.strokeEnd();
            brush.strokeStart(p.x, p.y);
            started = true;
            curSeg = p.seg;
          } else {
            brush.stroke(p.x, p.y, true);
          }
          i++;
        }
      } catch {
        cancelRaf();
      }
    };

    if (reduceMotion()) {
      advanceTo(flat.length - 1);
      if (started) {
        try {
          brush.strokeEnd();
        } catch {
          /* ignore */
        }
      }
      return;
    }
    // Eased progress: steady most of the way, then a quicker final stretch.
    const head = totalMs - TAIL_MS;
    const frac = (e: number): number =>
      e <= head
        ? (1 - TAIL_FRACTION) * (e / head)
        : 1 - TAIL_FRACTION + TAIL_FRACTION * ((e - head) / TAIL_MS);
    const start = performance.now();
    const step = (now: number): void => {
      const e = Math.min(totalMs, now - start);
      advanceTo(Math.floor(frac(e) * (flat.length - 1)));
      if (e < totalMs) {
        rafId = requestAnimationFrame(step);
      } else {
        rafId = null;
        if (started) {
          try {
            brush.strokeEnd();
          } catch {
            /* ignore */
          }
        }
      }
    };
    rafId = requestAnimationFrame(step);
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
    // Open on the last-used scene tab (persisted), which runs its preview.
    setTab(opts.store.get<string>(SCENE_KEY) ?? SCENES[0].id);
  };

  const onSettingChanged = (change?: PreviewChange): void => {
    if (!win || win.style.display === "none") return; // only while open
    if (change) lastChange = change;
    refreshInfo();
    if (tab === PLAYGROUND) return; // don't autoplay over free drawing
    debounceTimer = clearTimer(debounceTimer);
    debounceTimer = window.setTimeout(runPreview, DEBOUNCE_MS); // replay debounces
  };

  return { open, onSettingChanged };
}

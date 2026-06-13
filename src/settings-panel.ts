import {
  applySettingValue,
  PEN_SECTION,
  type BrushBase,
  type BrushSetting,
} from "./base";
import { makeDraggable } from "./drag";
import { attachHelp } from "./help";
import { ROUTING_PRESETS, flattenRouting } from "./brushes/connections/routing";
import {
  ROUTING_SECTION,
  STYLE_SECTION,
  type ConnectingFlat,
} from "./connecting-types";

// A row's value changed: forward to the brush so it persists (art-style dials
// per style, everything else per key). Threaded down to every input handler.
type PersistFn = (s: BrushSetting, value: unknown) => void;
const NO_PERSIST: PersistFn = () => {};

// Short what/why help for each art-style option, keyed by setting key.
const ART_STYLE_HELP: Record<string, string> = {
  strands:
    "How bold the mark is — each connection is drawn as this many thin 1px hairs. More hairs = heavier, but it's never one solid line.",
  spread:
    "How wide the hairs fan out, perpendicular to the line. Narrow = a dense ribbon; wide = an airy band.",
  alpha:
    "Opacity of each line. Low values let many overlapping lines build into soft shading; high values look like solid ink.",
  density:
    "Chance each eligible neighbour gets a line. Higher = denser web (and heavier to draw).",
  radius:
    "How far around each point to look for neighbours to connect. Larger reaches across bigger gaps.",
  sampleSpacing:
    "Stipple: spacing the web samples the stroke at. 0 = smoothest web (weave through every point). Raise it to break the web into evenly spaced tufts/dots — an artistic effect, not needed to control darkness (build-up is already rate-independent).",
  fade:
    "Fade each line with its length — longer connections go fainter, building soft shaded tone (Harmony's 'shaded' look).",
  scatter:
    "Jitter the hairs' ends: 0 = a neat parallel band, 1 = loose crossing hairs (hand-drawn).",
  taper:
    "Fade each hair from root to tip so it melts to a soft point instead of ending in a hard line — the key to fluffy fur.",
  flow:
    "Bow every hair the same way, like a combed or wind-swept pelt. 0 = straight, higher = a stronger sweep.",
  fray:
    "Stagger the hair lengths so the edge frays into stray strands instead of forming a blunt band.",
  length:
    "How far each hair reaches past its neighbour. 1 = stop at the dot; higher grows long flowing guard hairs that overshoot the shape — the soul of expressive fur.",
  wave:
    "Kink each hair with a gentle wave so the pelt looks like living hair instead of a flat comb. 0 = smooth sweep, higher = wavier, flicking tips.",
  dynamics:
    "Link weight to stroke speed: slow, deliberate passes build richer; fast flicks stay light.",
  curl:
    "Bow the connection lines into curves — only affects the 'Curve' line shape. 0 = straight, 1 = strong arc, for smoke wisps, wood grain and tendrils.",
  grainStrength:
    "Comb the web in one direction: 0 = lines reach every neighbour (an even web); 1 = only lines along the grain angle survive. Turns the web into fur, hatching or rain.",
  grainAngle:
    "Which way the grain combs, in degrees — 0 = horizontal, 90 = vertical. Only matters when Grain is above 0.",
  grainCross:
    "Comb along two perpendicular directions at once (the grain angle and its 90° cross) for crosshatching instead of a single grain.",
  minDist:
    "Skip connections shorter than this, so you don't get a clump of tiny lines right next to each point.",
  inset:
    "Trim both ends of every line so it floats between points instead of piling up dark on the dots (Harmony's airy web look).",
  connect:
    "Shape of the line between two points: straight, a bulging arc, or a smooth curve.",
  dash: "Solid, dashed, or dotted connection lines.",
  color:
    "Draw connections in the main color or the secondary color from the toolbar.",
};

// Per-preset slider visibility. The art-style group shows the dials a preset
// actually uses by default and folds the inactive (default-valued) ones under
// "More". Which dials a preset *supports* at all is decided upstream by the
// preset's sliders() (unsupported ones never reach this panel).
//
// The "open by default" dials are declared by the connection itself
// (ConnectionBase.defaultOpenKeys); they always head the group regardless of
// value. Every other dial sits at a NEUTRAL value when it has no visible effect;
// a preset (or the artist) moving it off NEUTRAL means it's "in use" → shown.
const NEUTRAL_STYLE: Record<string, string | number | boolean> = {
  fade: 0,
  curl: 0,
  grainStrength: 0,
  grainAngle: 0,
  grainCross: false,
  minDist: 0,
  sampleSpacing: 0,
  inset: 0,
  scatter: 0,
  taper: 0,
  flow: 0,
  fray: 0,
  wave: 0,
  dynamics: 0,
  strands: 1,
  length: 1,
  spread: 6,
  connect: "line",
  dash: "solid",
  color: "main",
};

// Whether a style dial is "in use" (shown by default) vs folded under "More".
// `openKeys` is the connection's always-open set (ConnectionBase.defaultOpenKeys).
function styleInUse(s: BrushSetting, openKeys: ReadonlySet<string>): boolean {
  if (openKeys.has(s.key)) return true;
  const neutral = NEUTRAL_STYLE[s.key];
  if (neutral === undefined) return true; // unknown dial → show rather than hide
  return s.value !== neutral;
}

// Brush size + opacity affect the stroke itself (not the connecting lines), so
// they're shown at the top of every brush's settings. They're app-global, wired
// to the renderer by main.ts; the panel just reads `get()` at render time.
export type BrushControl = {
  get: () => number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
};
export type BrushControls = { size: BrushControl; opacity: BrushControl };

// The app shows two settings boxes, both built here:
//   scope "brush"      — size/opacity + the brush's own params (Dash, etc.).
//   scope "connecting" — the connecting routing + art-style dials, shown only
//                        for brushes that connect (Round). Preset quick-pick is
//                        in the navbar, so no preset pills here.
export type SettingsPanelOpts = {
  scope: "brush" | "connecting";
  brushControls?: BrushControls; // brush scope only
  onSavePreset?: () => void; // connecting: save the dials as a new custom preset
  onUpdatePreset?: () => void; // connecting: overwrite the active custom preset
  activeCustomName?: () => string | null; // the active custom preset's name, or null
  // Whether the Pen section is shown (the More-menu "Pen pressure" toggle).
  // Defaults to shown; gates only the brush scope (Pen is a brush setting).
  showPen?: () => boolean;
};

const isConnectingSetting = (s: BrushSetting): boolean =>
  s.section === ROUTING_SECTION || s.section === STYLE_SECTION;

export function createSettingsPanel(opts: SettingsPanelOpts): {
  el: HTMLElement;
  render: (brush: BrushBase) => void;
} {
  const panel = document.createElement("div");
  panel.className =
    "settings-panel " +
    (opts.scope === "connecting" ? "connecting-panel" : "brush-panel");
  panel.style.display = "none";

  const header = document.createElement("div");
  header.className = "panel-header";
  const title = document.createElement("h3");
  header.appendChild(title);
  header.appendChild(
    makeCloseButton(() => {
      panel.style.display = "none";
    }),
  );
  panel.appendChild(header);
  makeDraggable(panel, header);

  const content = document.createElement("div");
  content.className = "panel-content";
  panel.appendChild(content);

  // Persisted across re-renders so applying a preset doesn't collapse the fold.
  let advancedOpen = false;

  const render = (brush: BrushBase) => {
    title.textContent =
      opts.scope === "connecting" ? "Connecting" : `${brush.name()} settings`;
    content.replaceChildren();

    // Every value change routes here so the brush persists it.
    const persist: PersistFn = (s, v) => brush.persistSetting(s, v);

    // Size + opacity head the Brush box (they affect every brush's stroke).
    // They self-persist via their own onChange (wired in main.ts), so no persist.
    if (opts.scope === "brush" && opts.brushControls) {
      content.appendChild(buildBrushControls(opts.brushControls));
    }

    const penHidden = opts.showPen ? !opts.showPen() : false;
    const settings = brush
      .getSettings()
      .filter((s) =>
        opts.scope === "connecting" ? isConnectingSetting(s) : !isConnectingSetting(s),
      )
      .filter((s) => !(penHidden && s.section === PEN_SECTION));

    if (settings.length === 0) {
      if (opts.scope === "connecting") {
        const empty = document.createElement("p");
        empty.className = "settings-empty";
        empty.textContent = brush.supportsConnecting()
          ? "No connection settings."
          : "This brush doesn't draw connections.";
        content.appendChild(empty);
      } else if (!opts.brushControls) {
        const empty = document.createElement("p");
        empty.className = "settings-empty";
        empty.textContent = "No settings.";
        content.appendChild(empty);
      }
      return;
    }

    // Walk runs of settings sharing a section. The Connection (routing) group
    // keeps its preset row; the art-style group folds its extras under "More".
    let i = 0;
    while (i < settings.length) {
      const section = settings[i].section;
      const run: BrushSetting[] = [];
      while (i < settings.length && settings[i].section === section) {
        run.push(settings[i]);
        i++;
      }

      if (section === ROUTING_SECTION) {
        content.appendChild(buildRoutingGroup(run, () => render(brush), persist));
      } else if (section === STYLE_SECTION) {
        const openKeys = new Set(brush.activeConnection()?.defaultOpenKeys() ?? []);
        content.appendChild(
          buildStyleGroup(
            run,
            {
              get: () => advancedOpen,
              set: (v) => {
                advancedOpen = v;
              },
            },
            openKeys,
            persist,
          ),
        );
      } else {
        if (section) content.appendChild(makeSectionHeader(section));
        for (const s of run) content.appendChild(makeRow(s, persist));
      }
    }

    // Connecting box: save the current dials as a Custom preset. When a custom
    // preset is already active, offer to update it in place or save a new one.
    if (opts.scope === "connecting" && opts.onSavePreset && brush.supportsConnecting()) {
      const mkBtn = (label: string, fn?: () => void) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "settings-save-preset";
        b.textContent = label;
        b.addEventListener("click", () => fn?.());
        return b;
      };
      const customName = opts.activeCustomName?.() ?? null;
      if (customName && opts.onUpdatePreset) {
        const row = document.createElement("div");
        row.className = "settings-preset-actions";
        row.append(
          mkBtn(`Update “${customName}”`, opts.onUpdatePreset),
          mkBtn("Save as new…", opts.onSavePreset),
        );
        content.appendChild(row);
      } else {
        content.appendChild(mkBtn("＋ Save as preset…", opts.onSavePreset));
      }
    }
  };

  return { el: panel, render };
}

function makeSectionHeader(text: string): HTMLElement {
  const h = document.createElement("h4");
  h.className = "settings-section";
  h.textContent = text;
  return h;
}

// The "Brush" block at the top of the panel: stroke size + opacity. Built fresh
// each render so the sliders reflect the live (possibly brush-overridden) values.
function buildBrushControls(c: BrushControls): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.appendChild(makeSectionHeader("Brush"));
  frag.appendChild(makeRow(brushControlSetting("__size", "Size", c.size)));
  frag.appendChild(makeRow(brushControlSetting("__opacity", "Opacity", c.opacity)));
  return frag;
}

function brushControlSetting(
  key: string,
  label: string,
  c: BrushControl,
): BrushSetting {
  return {
    kind: "number",
    key,
    label,
    min: c.min,
    max: c.max,
    step: c.step,
    value: c.get(),
    onChange: c.onChange,
  };
}

// A row of preset pills for a group, driven by a preset map + its flattener.
function makePresetRow<T>(
  items: BrushSetting[],
  presets: Record<string, T>,
  flatten: (p: T) => ConnectingFlat,
  rerender: () => void,
  persist: PersistFn,
  // Preset names that should wrap onto a fresh line (e.g. the texture presets
  // sit on a line after the Harmony-derived ones).
  newLineBefore?: Set<string>,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-presets";
  const current = currentValues(items);
  for (const [name, preset] of Object.entries(presets)) {
    if (newLineBefore?.has(name)) {
      const br = document.createElement("span");
      br.className = "settings-preset-break";
      row.appendChild(br);
    }
    const flat = flatten(preset);
    const pretty = name.replace(/_/g, " ");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-preset-btn";
    btn.textContent = pretty.charAt(0).toUpperCase() + pretty.slice(1);
    if (presetMatches(flat, current)) btn.classList.add("active");
    btn.addEventListener("click", () => {
      applyPreset(items, flat, persist);
      rerender();
    });
    row.appendChild(btn);
  }
  return row;
}

// Routing group: where connections are baked into and which maps feed/store
// them. Always visible, with its own presets.
function buildRoutingGroup(
  items: BrushSetting[],
  rerender: () => void,
  persist: PersistFn,
): HTMLElement {
  const box = document.createElement("div");
  box.className = "settings-group settings-group-routing";
  const title = document.createElement("h4");
  title.className = "settings-group-title";
  title.textContent = "Connection";
  box.appendChild(title);
  box.appendChild(
    makePresetRow(items, ROUTING_PRESETS, flattenRouting, rerender, persist),
  );
  for (const s of items) box.appendChild(makeRow(s, persist));
  return box;
}

// One art-style row + its "?" help, kept together on the left.
function styleRow(s: BrushSetting, persist: PersistFn): HTMLElement {
  const row = makeRow(s, persist);
  const help = ART_STYLE_HELP[s.key];
  const label = row.querySelector("label");
  if (help && label) {
    const wrap = document.createElement("span");
    wrap.className = "settings-label-help";
    label.replaceWith(wrap);
    wrap.appendChild(label);
    attachHelp(label, help);
  }
  return row;
}

// Art-style group: how the connection lines look. The preset quick-pick lives
// in the navbar Connecting combo, so this shows only the dials: the few core
// ones, with the texture/fine-tuning knobs folded under "More".
function buildStyleGroup(
  items: BrushSetting[],
  advanced: { get: () => boolean; set: (v: boolean) => void },
  openKeys: ReadonlySet<string>,
  persist: PersistFn,
): HTMLElement {
  const box = document.createElement("div");
  box.className = "settings-group settings-group-style";

  const title = document.createElement("h4");
  title.className = "settings-group-title";
  title.textContent = "Connection art style";
  box.appendChild(title);

  const primary = items.filter((s) => styleInUse(s, openKeys));
  const rest = items.filter((s) => !styleInUse(s, openKeys));
  for (const s of primary) box.appendChild(styleRow(s, persist));

  if (rest.length) {
    const open = advanced.get();
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "settings-group-toggle";
    toggle.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.innerHTML =
      '<svg class="settings-chevron" viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M6 4 L10 8 L6 12"/>' +
      "</svg><span>More</span>";

    const body = document.createElement("div");
    body.className = "settings-group-body";
    body.style.display = open ? "" : "none";
    for (const s of rest) body.appendChild(styleRow(s, persist));

    toggle.addEventListener("click", () => {
      const next = !advanced.get();
      advanced.set(next);
      body.style.display = next ? "" : "none";
      toggle.classList.toggle("open", next);
      toggle.setAttribute("aria-expanded", String(next));
    });

    box.appendChild(toggle);
    box.appendChild(body);
  }

  return box;
}

// Apply a preset by matching its keys to connecting settings' keys, persisting
// each. Order follows `items`, so radius is set before minDist (its onChange
// clamps minDist).
function applyPreset(
  items: BrushSetting[],
  preset: ConnectingFlat,
  persist: PersistFn,
): void {
  for (const s of items) {
    const v = preset[s.key];
    if (v === undefined) continue;
    applySettingValue(s, v);
    persist(s, v);
  }
}

function currentValues(items: BrushSetting[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of items) out[s.key] = s.value;
  return out;
}

function presetMatches(
  preset: ConnectingFlat,
  current: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(preset)) {
    if (current[key] !== value) return false;
  }
  return true;
}

function makeCloseButton(onClick: () => void): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "panel-close-btn";
  btn.title = "Close";
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M6 6 L18 18 M18 6 L6 18"/>' +
    "</svg>";
  btn.addEventListener("click", onClick);
  return btn;
}

export { makeCloseButton };

function makeRow(s: BrushSetting, persist: PersistFn = NO_PERSIST): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";

  const label = document.createElement("label");
  label.textContent = s.label;
  row.appendChild(label);

  if (s.kind === "number") {
    const wrap = document.createElement("div");
    wrap.className = "settings-number";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(s.min);
    input.max = String(s.max);
    if (s.step !== undefined) input.step = String(s.step);
    input.value = String(s.value);
    const display = document.createElement("span");
    display.className = "settings-value";
    display.textContent = String(s.value);
    input.addEventListener("input", () => {
      const v = Number(input.value);
      display.textContent = String(v);
      s.onChange(v);
      persist(s, v);
    });
    wrap.appendChild(input);
    wrap.appendChild(display);
    row.appendChild(wrap);
  } else if (s.kind === "color") {
    const input = document.createElement("input");
    input.type = "color";
    input.value = s.value;
    input.className = "settings-color";
    input.addEventListener("input", () => {
      s.onChange(input.value);
      persist(s, input.value);
    });
    row.appendChild(input);
  } else if (s.kind === "boolean") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "settings-checkbox";
    input.checked = s.value;
    input.addEventListener("change", () => {
      s.onChange(input.checked);
      persist(s, input.checked);
    });
    row.appendChild(input);
  } else {
    const select = document.createElement("select");
    select.className = "settings-select";
    for (const opt of s.options) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = s.optionLabels?.[opt] ?? opt;
      select.appendChild(o);
    }
    select.value = s.value;

    if (s.icons) {
      const wrap = document.createElement("div");
      wrap.className = "settings-select-with-icon";
      const preview = document.createElement("span");
      preview.className = "settings-select-icon";
      const icons = s.icons;
      preview.innerHTML = icons[s.value] ?? "";
      select.addEventListener("change", () => {
        preview.innerHTML = icons[select.value] ?? "";
        s.onChange(select.value);
        persist(s, select.value);
      });
      wrap.appendChild(preview);
      wrap.appendChild(select);
      row.appendChild(wrap);
    } else {
      select.addEventListener("change", () => {
        s.onChange(select.value);
        persist(s, select.value);
      });
      row.appendChild(select);
    }
  }

  return row;
}

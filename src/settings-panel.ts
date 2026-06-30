import {
  applySettingValue,
  isConnectingSetting,
  PEN_SECTION,
  type BrushBase,
  type BrushSetting,
  type SettingValue,
} from "./base";
import { makeDraggable } from "./ui/drag";
import { makeToggle } from "./ui/toggle";
import { attachHelp } from "./help";
import {
  ROUTING_SECTION,
  STYLE_SECTION,
  type ConnectingFlat,
} from "./connecting-types";

// Settings-tab glyphs: a paintbrush for the Brush tab, a spider-web for the Web
// (connection) tab. Small inline SVGs in the shared stroke style.
const BRUSH_TAB_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M9.06 11.9 17.13 3.84a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/>' +
  '<path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></svg>';
const WEB_TAB_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="1.6"/><path d="M12 3 V21 M3 12 H21 M6 6 L18 18 M18 6 L6 18"/>' +
  '<path d="M12 6.5 A5.5 5.5 0 0 1 17.5 12 M12 6.5 A5.5 5.5 0 0 0 6.5 12"/></svg>';

// A row's value changed: forward to the brush so it persists (art-style dials
// per style, everything else per key). Threaded down to every input handler.
// `value` is a SettingValue (never undefined) - the persist path mirrors
// Store.set's no-undefined contract end to end.
type PersistFn = (s: BrushSetting, value: SettingValue) => void;
const NO_PERSIST: PersistFn = () => {};

// Short what/why help for a setting, keyed by setting key - covers the
// connecting dials and the brush dials. makeRow attaches a "?" bubble for any
// key found here, in either tab.
const SETTING_HELP: Record<string, string> = {
  // --- Global brush controls ---
  __size: "Overall thickness of the stroke itself, before any web.",
  __opacity: "How solid the stroke is - lower lets overlapping passes build up.",
  // --- Brush-specific ---
  strokeDash: "Solid, dashed, or dotted stroke.",
  size: "Smallest-to-largest stamp size - your stroke speed picks a value between the two.",
  sensitivity:
    "How strongly stroke speed changes the stamp size. 0 keeps every stamp the same.",
  fillMode: "Fill each shape or leave it an outline - and which colour the fill takes.",
  fillOpacity: "How solid the shape fill is.",
  nibAngle:
    "The fixed angle of the chisel tip - sets the thick-to-thin direction of every stroke.",
  penChisel: "Let stylus tilt steer the chisel angle instead of the fixed Nib angle.",
  streamline: "Smooth the path so quick strokes come out clean and flowing, not shaky.",
  // Spray (airbrush) dials.
  sprayRadius:
    "How wide the spray scatters around the pointer - small a tight stipple, large a soft cloud.",
  sprayFlow: "How many specks land as you spray - higher builds up denser and faster.",
  sprayDot: "Size of each speck - tiny a fine grain, larger a coarse splatter.",
  // Color Pen.
  colorSource:
    "Where the pen pulls colour from: a gradient, palette, Rainbow or Complement gives a living, shifting run as you draw; Primary/Secondary lay one flat hue.",
  colorWheel:
    "How your stroke's direction maps to colour. Rotate shifts which way shows which hue, Range sets how much of the palette a full turn covers, Relative locks the run to where you started.",

  // --- Connecting web: routing ---
  connecting_mode:
    "Which points this brush links: just the current stroke, the shared map of every stroke, both, or nothing.",
  // --- Connecting web: weight ---
  strands:
    "How many fine strands make up each line - more reads as a bolder, denser mark (never one solid stroke).",
  spread:
    "How wide each line's strands fan out: low a tight ribbon, high an airy band. (Only bites once Weight is above 1.)",
  density: "How likely each nearby point is to link up - higher fills the web denser.",
  links:
    "Cap each point to its nearest few links instead of all within Reach - low trims long crossing lines into a clean, even mesh. 0 = link to all.",
  // --- Connecting web: art style ---
  alpha:
    "Opacity of each line - low lets overlapping lines build into soft shading, high reads as solid ink.",
  radius: "How far each point looks for others to link to - larger reaches across bigger gaps.",
  bloom:
    "Pad a sparse stroke with extra scattered points, so even a quick mark fills out into a full web. 0 keeps only the points you drew.",
  bloomRadius:
    "How far the bloom scatters its dots from your stroke - small hugs the line, large floods a wide area. (Shows once Bloom is on.)",
  sampleSpacing:
    "Spacing between the web's anchor points - 0 weaves a smooth web, higher breaks it into evenly spaced tufts or dots.",
  fade: "Make longer lines fainter, so the web settles into soft, shaded tone.",
  curl:
    "Bow the lines into curves - 0 straight, 1 a strong arc; good for smoke, wood grain and tendrils. (Shows only on the Curve line shape.)",
  comb:
    "Comb the web in one direction: drag out from the centre to comb harder, around to aim it. Centre is an even mesh; combed turns the web into fur, hatching or rain. Crosshatch combs two ways at once for a woven look.",
  minDist:
    "Skip the tiny links that bunch up right at each point, so the web breathes instead of clotting.",
  inset:
    "Trim both ends of every line so it floats between points instead of pooling dark on them.",
  connect: "Shape of the line between two points: straight, a bulging arc, or a smooth curve.",
  dash: "Solid, dashed, or dotted connection lines.",
  color:
    "Where the web's colour comes from: one solid hue (Primary/Secondary), or a living run pulled from a gradient, Rainbow or palette as it draws. 'From mark' reuses colour your strokes already laid down.",
  colorDirection:
    "How the gradient colours the web. 'Colour follows stroke' tints the whole web by your hand's travel; Rotate shifts the map, Range narrows it, Relative anchors to the stroke's start.",

  // --- Fur strands ---
  scatter: "How loosely the hair-tips land - 0 a neat combed band, high a scattered, lived-in coat.",
  taper: "Fade each hair from root to tip so it melts to a soft point - the key to fluffy fur.",
  flow: "Bow every hair the same way, like a combed or wind-swept pelt.",
  fray: "Stagger the hair lengths so the edge frays into stray strands instead of a blunt band.",
  length: "How far each hair overshoots its point - 1 stops at the dot, higher grows long flowing hairs.",
  wave: "Kink each hair with a gentle wave so the pelt looks like living hair, not a flat comb.",
  dynamics:
    "Link weight to stroke speed - slow, deliberate passes build richer, fast flicks stay light.",

  // --- Pen modulation ---
  penPressureSize: "Press harder for a thicker stroke.",
  penPressureAlpha: "Press harder for a more opaque stroke.",
  penTiltSize: "Tilt the pen to widen the stroke.",
  penTiltAlpha: "Tilt the pen to deepen opacity.",
  penWebDensity: "Press harder to thicken the connecting web as you draw.",
  penWebRadius: "Press harder to reach further for connections.",
  penSmoothing:
    "Smooth jitter in pressure and tilt so width and opacity shift gradually, not in jumps.",
  penResponse:
    "How quickly pressure and tilt take effect - low eases in gently, high jumps to full fast.",
};

// "Web weight" group: how heavy the connecting web reads (how many lines go out).
// The Light / Normal / Heavy presets are PER-STYLE - Normal is the active style's
// own factory default, Light/Heavy come from its spec (ConnectionSpec.webWeight,
// surfaced via brush.webWeightLevels()) - so each connecting style gets sensible
// values. They move only the "amount" levers (Weight/Density/Links); Customize
// also shows Spread (Weight's hair-fan shaper). Reach, Opacity, colour, dash
// stay in art style. A manual tweak matches no preset, so none stays highlighted.
const WEB_WEIGHT_KEYS = ["strands", "spread", "density", "links"] as const;
const WEB_WEIGHT_HELP =
  "Sets how heavy the web is for this connecting style: Weight (lines per point), Density and Links. Normal is this style's default look, Light makes it sparser, Heavy fills it in. Each style has its own Light/Normal/Heavy. Open Customize to fine-tune the sliders.";
const isWebWeight = (s: BrushSetting): boolean =>
  (WEB_WEIGHT_KEYS as readonly string[]).includes(s.key);

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
  bloom: 0,
  bloomRadius: 60,
  fade: 0,
  curl: 0,
  comb: "0", // Comb's value = grain strength (string); "0" folds it under "More"
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

// One settings window with two tabs:
//   Brush      — size/opacity + the brush's own params (Dash, Pen, …).
//   Connecting — the art-style dials (only for brushes that connect:
//                Round/Eraser/Soft Pencil). Preset quick-pick is in the navbar.
//                The routing "Connection" group lives in the Maps box now (see
//                buildRoutingControls), since it's about which map the web uses.
// A Reset button in the header reverts both to the brush's defaults + the
// selected art style's defaults (wired in main.ts).
export type SettingsTab = "brush" | "connecting";

export type SettingsPanelOpts = {
  brushControls: BrushControls; // size/opacity, always at the top of the Brush tab
  onSavePreset?: () => void; // connecting: save the dials as a new custom preset
  onUpdatePreset?: () => void; // connecting: overwrite the active custom preset
  activeCustomName?: () => string | null; // the active custom preset's name, or null
  onReset?: () => void; // header Reset button
  // Whether the Pen section is shown (the More-menu "Pen pressure" toggle).
  // Defaults to shown; gates only the Brush tab (Pen is a brush setting).
  showPen?: () => boolean;
  // Open the brush-preview window (the Preview button in the header).
  onOpenPreview?: () => void;
  // Notified after any setting on the panel changes - the preview names it (with
  // the same help text) and replays if its window is open.
  onSettingChange?: (change: { label: string; value: string; help?: string }) => void;
};

// Human value of a changed setting for the preview's info box ("On", "6", "Curve").
function settingValueText(s: BrushSetting, v: unknown): string {
  if (s.kind === "boolean") return v ? "On" : "Off";
  if (s.kind === "range" && Array.isArray(v)) return `${v[0]}–${v[1]}`;
  if (s.kind === "select") return s.optionLabels?.[String(v)] ?? String(v);
  return String(v);
}

export function createSettingsPanel(opts: SettingsPanelOpts): {
  el: HTMLElement;
  render: (brush: BrushBase) => void;
  showTab: (tab: SettingsTab) => void;
} {
  const panel = document.createElement("div");
  panel.className = "settings-panel brush-panel";
  panel.style.display = "none";

  const header = document.createElement("div");
  header.className = "panel-header";
  const title = document.createElement("h3");
  header.appendChild(title);
  const headerActions = document.createElement("div");
  headerActions.className = "panel-header-actions";
  if (opts.onOpenPreview) {
    const preview = document.createElement("button");
    preview.type = "button";
    preview.className = "panel-preview-btn";
    preview.title = "Preview this brush's settings";
    preview.setAttribute("aria-label", "Preview brush");
    preview.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M1.6 12 C4 6.4 8 4 12 4 C16 4 20 6.4 22.4 12 C20 17.6 16 20 12 20 C8 20 4 17.6 1.6 12 Z"/>' +
      '<circle cx="12" cy="12" r="3.2"/></svg>';
    preview.addEventListener("click", () => opts.onOpenPreview?.());
    headerActions.appendChild(preview);
  }
  if (opts.onReset) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "panel-reset-btn";
    reset.title = "Reset this brush + its art style to defaults";
    reset.innerHTML =
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 9 A9 9 0 1 1 5 15"/><path d="M3 4 V9 H8"/></svg>' +
      "<span>Reset</span>";
    reset.addEventListener("click", () => opts.onReset?.());
    headerActions.appendChild(reset);
  }
  headerActions.appendChild(
    makeCloseButton(() => {
      panel.style.display = "none";
    }),
  );
  header.appendChild(headerActions);
  panel.appendChild(header);
  makeDraggable(panel, header);

  // Tab bar (hidden for brushes that don't connect — only the Brush tab then).
  let activeTab: SettingsTab = "brush";
  let lastBrush: BrushBase | null = null;
  const tabBar = document.createElement("div");
  tabBar.className = "settings-tabs";
  const mkTab = (label: string, tab: SettingsTab, icon: string) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "settings-tab";
    const ic = document.createElement("span");
    ic.className = "settings-tab-icon";
    ic.innerHTML = icon; // trusted constant SVG
    b.append(ic, document.createTextNode(label));
    b.addEventListener("click", () => {
      activeTab = tab;
      if (lastBrush) render(lastBrush);
    });
    return b;
  };
  // The connection tab keeps its internal id "connecting"; it's labelled "Web".
  const brushTab = mkTab("Brush", "brush", BRUSH_TAB_ICON);
  const connTab = mkTab("Web", "connecting", WEB_TAB_ICON);
  tabBar.append(brushTab, connTab);
  panel.appendChild(tabBar);

  const content = document.createElement("div");
  content.className = "panel-content";
  panel.appendChild(content);

  // Persisted across re-renders so applying a preset doesn't collapse the fold.
  let advancedOpen = false;
  let webCustomizeOpen = false;

  const render = (brush: BrushBase) => {
    closeIconSelectPopover(); // body-anchored dropdowns would orphan otherwise
    lastBrush = brush;
    const connects = brush.supportsConnecting();
    if (activeTab === "connecting" && !connects) activeTab = "brush"; // tab gone

    title.textContent = `${brush.name()} settings`;
    tabBar.style.display = connects ? "" : "none";
    brushTab.classList.toggle("active", activeTab === "brush");
    connTab.classList.toggle("active", activeTab === "connecting");

    content.replaceChildren();
    const persist: PersistFn = (s, v) => {
      brush.persistSetting(s, v);
      opts.onSettingChange?.({
        label: s.label,
        value: settingValueText(s, v),
        help: SETTING_HELP[s.key],
      });
    };
    if (activeTab === "connecting") renderConnectingTab(brush, persist);
    else renderBrushTab(brush, persist);
  };

  const renderBrushTab = (brush: BrushBase, persist: PersistFn) => {
    // Size + opacity head the tab (they affect every brush's stroke). They
    // self-persist via their own onChange (wired in main.ts), so no persist.
    content.appendChild(buildBrushControls(opts.brushControls));

    const penHidden = opts.showPen ? !opts.showPen() : false;
    const settings = brush
      .getSettings()
      .filter((s) => !isConnectingSetting(s))
      .filter((s) => !(penHidden && s.section === PEN_SECTION));
    appendSettingGroups(settings, brush, persist);
  };

  const renderConnectingTab = (brush: BrushBase, persist: PersistFn) => {
    const settings = brush.getSettings().filter(isConnectingSetting);
    if (settings.length === 0) {
      const empty = document.createElement("p");
      empty.className = "settings-empty";
      empty.textContent = brush.supportsConnecting()
        ? "No connection settings."
        : "This brush doesn't draw connections.";
      content.appendChild(empty);
      return;
    }
    appendSettingGroups(settings, brush, persist);

    // Save the current dials as a Custom preset. When a custom preset is already
    // active, offer to update it in place or save a new one.
    if (opts.onSavePreset && brush.supportsConnecting()) {
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

  // Walk runs of settings sharing a section into the content. The Connection
  // (routing) group keeps its preset row; the art-style group folds its extras
  // under "More".
  const appendSettingGroups = (
    settings: BrushSetting[],
    brush: BrushBase,
    persist: PersistFn,
  ) => {
    let i = 0;
    while (i < settings.length) {
      const section = settings[i].section;
      const run: BrushSetting[] = [];
      while (i < settings.length && settings[i].section === section) {
        run.push(settings[i]);
        i++;
      }
      if (section === ROUTING_SECTION) {
        // The routing "Connection" group lives in the Maps panel now (it's about
        // which map the web reads from / writes to) - see buildRoutingControls.
      } else if (section === STYLE_SECTION) {
        const openKeys = new Set(brush.activeConnection()?.defaultOpenKeys() ?? []);
        // Split the web-weight dials into their own preset group, above the rest.
        const webItems = run.filter(isWebWeight);
        const others = run.filter((s) => !isWebWeight(s));
        if (webItems.length) {
          content.appendChild(
            buildWebWeightGroup(
              webItems,
              brush.webWeightLevels(),
              { get: () => webCustomizeOpen, set: (v) => (webCustomizeOpen = v) },
              () => render(brush),
              persist,
              // Report the picked Light/Normal/Heavy as the change, not the raw
              // dials it set, so the preview names the selection (with its help).
              (name) =>
                opts.onSettingChange?.({ label: "Web weight", value: name, help: WEB_WEIGHT_HELP }),
            ),
          );
        }
        content.appendChild(
          buildStyleGroup(
            others,
            { get: () => advancedOpen, set: (v) => (advancedOpen = v) },
            openKeys,
            persist,
          ),
        );
      } else {
        if (section) content.appendChild(makeSectionHeader(section));
        // Same dependency-gating for plain brush sections (e.g. Squares/Circles
        // Fill opacity hidden until Fill != none).
        const vis = makeVisibility(run, persist);
        for (const s of run) content.appendChild(vis.row(s));
        vis.apply();
      }
    }
  };

  // Switch tab (e.g. opening the window to the Connecting tab from the combo
  // gear). Re-renders with the current brush; the caller reveals the window.
  const showTab = (tab: SettingsTab) => {
    activeTab = tab;
    if (lastBrush) render(lastBrush);
  };

  return { el: panel, render, showTab };
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

// The routing "Connection" group, built for the Maps panel: which map a
// connecting brush reads from / writes to, and whether it connects at all.
// Returns null for non-connecting brushes (or when there's nothing to route).
// rerender is called after a change so the group reflects the new value.
export function buildRoutingControls(brush: BrushBase): HTMLElement | null {
  if (!brush.supportsConnecting()) return null;
  const items = brush
    .getSettings()
    .filter(isConnectingSetting)
    .filter((s) => s.section === ROUTING_SECTION);
  if (items.length === 0) return null;
  const persist: PersistFn = (s, v) => brush.persistSetting(s, v);
  return buildRoutingGroup(items, persist);
}

// Routing group: the single "Connect to" control. Always visible.
function buildRoutingGroup(
  items: BrushSetting[],
  persist: PersistFn,
): HTMLElement {
  const box = document.createElement("div");
  box.className = "settings-group settings-group-routing";
  const title = document.createElement("h4");
  title.className = "settings-group-title";
  title.textContent = "Web routing";
  box.appendChild(title);
  for (const s of items) box.appendChild(makeRow(s, persist));
  return box;
}

// Dependency-driven row visibility for a group. A dial with `visibleWhen` is
// hidden in place while its controlling sibling's live value fails the predicate
// and revealed when it passes - no panel re-render (which would tear down a
// drag). One controller per group: it seeds a live value map from the items,
// each row registers itself via `row()`, and makeRow's onLive feeds value
// changes back so apply() can toggle the dependent rows' display. Call apply()
// once after all rows (across primary + folded) are built.
function makeVisibility(items: BrushSetting[], persist: PersistFn) {
  const live: Record<string, string | number | boolean> = {};
  for (const s of items)
    if (s.kind === "number" || s.kind === "select" || s.kind === "boolean") live[s.key] = s.value;
  const rows = new Map<string, HTMLElement>();
  const deps = items.filter((s) => s.visibleWhen);
  const apply = () => {
    for (const s of deps) {
      const row = rows.get(s.key);
      const vw = s.visibleWhen;
      if (row && vw) row.style.display = vw.when(live[vw.key]) ? "" : "none";
    }
  };
  const row = (s: BrushSetting): HTMLElement => {
    const r = makeRow(s, persist, (k, v) => {
      live[k] = v;
      apply();
    });
    rows.set(s.key, r);
    return r;
  };
  return { row, apply };
}

// Web-weight group: three one-click presets (Light / Normal / Heavy) for how
// heavy the web reads, with the underlying Weight/Density/Links sliders folded
// under a "Customize" toggle (a "?" hint explains the group). Sits at the top
// of the connecting settings since it's the first thing most people reach for.
function buildWebWeightGroup(
  items: BrushSetting[],
  levels: { name: string; flat: ConnectingFlat }[],
  customize: { get: () => boolean; set: (v: boolean) => void },
  rerender: () => void,
  persist: PersistFn,
  onSelect?: (name: string) => void,
): HTMLElement {
  const box = document.createElement("div");
  box.className = "settings-group settings-group-webweight";

  const title = document.createElement("h4");
  title.className = "settings-group-title";
  title.textContent = "Web weight";
  box.appendChild(title);

  // Per-style preset pills (Light/Normal/Heavy). At most one matches; a manual
  // tweak matches none (custom), so none stays highlighted.
  const row = document.createElement("div");
  row.className = "settings-presets";
  const current = currentValues(items);
  for (const { name, flat } of levels) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "settings-preset-btn";
    btn.textContent = name;
    if (presetMatches(flat, current)) btn.classList.add("active");
    btn.addEventListener("click", () => {
      applyPreset(items, flat, persist);
      onSelect?.(name);
      rerender();
    });
    row.appendChild(btn);
  }
  box.appendChild(row);

  // "Customize" fold + a "?" hint explaining the group.
  const open = customize.get();
  const bar = document.createElement("div");
  bar.className = "settings-customize-bar";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "settings-group-toggle";
  toggle.classList.toggle("open", open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.innerHTML =
    '<svg class="settings-chevron" viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6 4 L10 8 L6 12"/>' +
    "</svg><span>Customize</span>";
  bar.appendChild(toggle);
  // The "?" hint uses the app help system: it inserts a help chip after the
  // toggle that only shows in help mode (press ?) and opens the standard popover.
  attachHelp(toggle, WEB_WEIGHT_HELP);
  box.appendChild(bar);

  const body = document.createElement("div");
  body.className = "settings-group-body";
  body.style.display = open ? "" : "none";
  const vis = makeVisibility(items, persist); // Spread is gated on Weight>1 here
  for (const s of items) body.appendChild(vis.row(s));
  vis.apply();
  box.appendChild(body);

  toggle.addEventListener("click", () => {
    const next = !customize.get();
    customize.set(next);
    body.style.display = next ? "" : "none";
    toggle.classList.toggle("open", next);
    toggle.setAttribute("aria-expanded", String(next));
  });

  return box;
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

  const vis = makeVisibility(items, persist);
  const primary = items.filter((s) => styleInUse(s, openKeys));
  const rest = items.filter((s) => !styleInUse(s, openKeys));
  for (const s of primary) box.appendChild(vis.row(s));

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
    for (const s of rest) body.appendChild(vis.row(s));

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

  vis.apply(); // hide dependency-gated dials whose controller isn't active yet
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

// onLive (optional) fires after any value change with the new value, so a group
// can re-evaluate dependent rows' `visibleWhen` predicates in place (no re-render).
function makeRow(
  s: BrushSetting,
  persist: PersistFn = NO_PERSIST,
  onLive?: (key: string, value: string | number | boolean) => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "settings-row";

  const label = document.createElement("label");
  label.textContent = s.label;
  row.appendChild(label);

  // Attach the "?" help bubble (help mode) for any setting with a help entry.
  const help = SETTING_HELP[s.key];
  if (help) {
    const wrap = document.createElement("span");
    wrap.className = "settings-label-help";
    label.replaceWith(wrap);
    wrap.appendChild(label);
    attachHelp(label, help);
  }

  if (s.kind === "number") {
    const wrap = document.createElement("div");
    wrap.className = "settings-number";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(s.min);
    input.max = String(s.max);
    if (s.step !== undefined) input.step = String(s.step);
    input.value = String(s.value);
    const unit = s.unit ?? "";
    const display = document.createElement("span");
    display.className = "settings-value";
    display.textContent = String(s.value) + unit;
    input.addEventListener("input", () => {
      const v = Number(input.value);
      display.textContent = String(v) + unit;
      s.onChange(v);
      persist(s, v);
      onLive?.(s.key, v);
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
    const toggle = makeToggle(s.value, (v) => {
      s.onChange(v);
      persist(s, v);
      onLive?.(s.key, v);
    });
    row.appendChild(toggle.el);
  } else if (s.kind === "custom") {
    if (!s.inline) row.classList.add("settings-row-custom"); // inline = stay one row
    row.appendChild(s.el);
  } else if (s.kind === "range") {
    // One two-handle slider for a [low, high] pair (e.g. Squares/Circles size).
    const wrap = document.createElement("div");
    wrap.className = "settings-number";
    const dual = document.createElement("div");
    dual.className = "settings-dual";
    const rail = document.createElement("div");
    rail.className = "settings-dual-rail";
    const fill = document.createElement("div");
    fill.className = "settings-dual-fill";
    const mkInput = () => {
      const i = document.createElement("input");
      i.type = "range";
      i.className = "settings-dual-input";
      i.min = String(s.min);
      i.max = String(s.max);
      if (s.step !== undefined) i.step = String(s.step);
      return i;
    };
    const loIn = mkInput();
    const hiIn = mkInput();
    let [lo, hi] = s.value;
    loIn.value = String(lo);
    hiIn.value = String(hi);
    dual.append(rail, fill, loIn, hiIn);
    const display = document.createElement("span");
    display.className = "settings-value";
    const span = Math.max(1, s.max - s.min);
    const gap = s.step ?? 1;
    const paint = () => {
      fill.style.left = `${((lo - s.min) / span) * 100}%`;
      fill.style.right = `${((s.max - hi) / span) * 100}%`;
      // raise whichever handle sits in the busier half so it stays grabbable
      loIn.style.zIndex = lo - s.min > s.max - hi ? "4" : "3";
      display.textContent = `${lo}-${hi}`;
    };
    const commit = () => {
      paint();
      s.onChange(lo, hi);
      persist(s, [lo, hi]);
    };
    loIn.addEventListener("input", () => {
      lo = Math.min(Number(loIn.value), hi - gap);
      loIn.value = String(lo);
      commit();
    });
    hiIn.addEventListener("input", () => {
      hi = Math.max(Number(hiIn.value), lo + gap);
      hiIn.value = String(hi);
      commit();
    });
    paint();
    wrap.append(dual, display);
    row.appendChild(wrap);
  } else if (s.icons) {
    // Selects whose options carry a glyph/swatch (Dash, Color, Fill) get a
    // custom dropdown so each option shows its icon — native <option> can't.
    row.appendChild(makeIconSelect(s, persist, onLive));
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
    select.addEventListener("change", () => {
      s.onChange(select.value);
      persist(s, select.value);
      onLive?.(s.key, select.value);
    });
    row.appendChild(select);
  }

  return row;
}

// Only one icon-select dropdown is open at a time; closed on outside-click,
// Escape, selection, or a panel re-render.
let closeOpenIconSelect: (() => void) | null = null;
function closeIconSelectPopover(): void {
  closeOpenIconSelect?.();
}

// A custom dropdown for selects with per-option icons. Closed: a pill showing
// the selected option's icon + label. Open: a body-anchored popover listing
// every option with its own icon, so e.g. the Color select previews the live
// Primary/Secondary colours next to each.
function makeIconSelect(
  s: BrushSetting & { kind: "select" },
  persist: PersistFn,
  onLive?: (key: string, value: string | number | boolean) => void,
): HTMLElement {
  const icons = s.icons ?? {};
  const labelOf = (v: string) => s.optionLabels?.[v] ?? v;
  let value = s.value;

  const wrap = document.createElement("div");
  wrap.className = "icon-select";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "icon-select-trigger";
  wrap.appendChild(trigger);

  const fillTrigger = () => {
    trigger.replaceChildren();
    const ic = document.createElement("span");
    ic.className = "icon-select-icon";
    ic.innerHTML = icons[value] ?? "";
    const lbl = document.createElement("span");
    lbl.className = "icon-select-label";
    lbl.textContent = labelOf(value);
    const chev = document.createElement("span");
    chev.className = "icon-select-chevron";
    chev.textContent = "⌄";
    trigger.append(ic, lbl, chev);
  };
  fillTrigger();

  let pop: HTMLElement | null = null;
  const close = () => {
    if (!pop) return;
    pop.remove();
    pop = null;
    closeOpenIconSelect = null;
    document.removeEventListener("mousedown", onOutside, true);
  };
  const onOutside = (e: MouseEvent) => {
    if (wrap.contains(e.target as Node) || pop?.contains(e.target as Node)) return;
    close();
  };

  const open = () => {
    closeOpenIconSelect?.(); // close any other open dropdown
    pop = document.createElement("div");
    pop.className = "icon-select-pop";
    for (const opt of s.options) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "icon-select-option" + (opt === value ? " active" : "");
      const ic = document.createElement("span");
      ic.className = "icon-select-icon";
      ic.innerHTML = icons[opt] ?? "";
      const lbl = document.createElement("span");
      lbl.className = "icon-select-label";
      lbl.textContent = labelOf(opt);
      row.append(ic, lbl);
      row.addEventListener("click", () => {
        value = opt;
        fillTrigger();
        s.onChange(opt);
        persist(s, opt);
        onLive?.(s.key, opt);
        close();
      });
      pop.appendChild(row);
    }
    document.body.appendChild(pop);

    // Anchor under the trigger (viewport coords → position: fixed), flipping
    // up / clamping in if it would run off-screen.
    const t = trigger.getBoundingClientRect();
    pop.style.left = `${t.left}px`;
    pop.style.top = `${t.bottom + 4}px`;
    pop.style.minWidth = `${t.width}px`;
    const p = pop.getBoundingClientRect();
    if (p.bottom > window.innerHeight - 8)
      pop.style.top = `${Math.max(8, t.top - p.height - 4)}px`;
    if (p.right > window.innerWidth - 8)
      pop.style.left = `${Math.max(8, window.innerWidth - p.width - 8)}px`;

    closeOpenIconSelect = close;
    document.addEventListener("mousedown", onOutside, true);
  };

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (pop) close();
    else open();
  });
  return wrap;
}

// Dropdowns are body-anchored, so close any open one on Escape.
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeIconSelectPopover();
  });
}

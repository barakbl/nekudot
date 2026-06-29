// The colour palette popover: a small floating picker that opens next to the
// swatch it was launched from (the toolbar Primary/Secondary swatches, the Layers
// background swatch, ...), like the OS colour picker. Layout, top to bottom:
//   - Recent colours
//   - Tabs: "Palette" (all palettes, filtered by a Mood combo, with New / Import) /
//     "Picker". The active tab + selected mood are remembered across sessions.
//   - The Picker tab reveals OKLCH / HSB sub-tabs: OKLCH L/C/H sliders, or a
//     Photoshop-style saturation/brightness square + hue bar, plus an Eyedropper
//     (where supported) and a shared preview + Done.
// Palettes are seeded from colors/gradients on first run (see store.ensureSeeded)
// and are all editable. In the editors the colour applies live as you drag (via
// the request's onPreview, falling back to onPick); a swatch click or the Done
// button commits it (onPick), records it as recent, and closes. Outside-click /
// Escape also closes it.
import { makeCloseButton } from "../settings-panel";
import { makeToggle } from "../ui/toggle";
import { attachHelp } from "../help";
import {
  clampColors,
  makeId,
  MAX_SWATCHES,
  normalizeHex,
  pushRecent,
  type Palette,
} from "./palette";
import {
  ALL_CATEGORIES,
  allCategories,
  DEFAULT_CATEGORY,
  categoryName,
  normalizeCategory,
} from "./categories";
import { gradientCatalog, type CatalogItem } from "./gradients/catalog";
import { palettesToOklchJson, palettesFromOklchJson, MAX_BACKUP_BYTES } from "./palette-json";
import { gradientCss as gradientCssFor, type GradientSpace } from "./gradient";
import { hexToOklch, oklchToHex } from "./oklch";
import { hexToHsv, hsvToHex } from "./hsv";
import { parseGpl, toGpl } from "./gpl";
import { triggerDownload } from "../export";
import {
  loadCustomPalettes,
  loadLastUsedPalette,
  loadRecent,
  saveCustomPalettes,
  saveLastUsedPalette,
  saveRecent,
} from "./store";

// What the popover is currently picking a colour for. Whoever opens it supplies
// this - the toolbar Primary/Secondary swatches, the Layers background swatch,
// etc. - so the popover itself stays target-agnostic. `anchor` is the element it
// pops up next to.
export type PickRequest = {
  title: string; // shown in the header, e.g. "Primary color", "Background"
  anchor: HTMLElement; // the popover opens next to this element
  getColor: () => string; // the current colour (seeds the pickers)
  onPick: (hex: string) => void; // commit a chosen "#rrggbb" (records recent, closes)
  // Live preview as the slider/marker moves, before the user commits with Done.
  // Defaults to onPick; supply a lighter variant when onPick has side effects you
  // don't want per drag-tick (e.g. recording an undo entry).
  onPreview?: (hex: string) => void;
};

export type PalettePanel = {
  el: HTMLElement;
  open: (req: PickRequest) => void;
  close: () => void;
};

export type PalettePanelOpts = {
  // Called whenever the set of gradient-enabled palettes changes (a Gradient
  // toggle), so consumers (e.g. the connection Color dial) can refresh.
  onGradientsChanged?: () => void;
  // Whether "Smooth gradients" is on - when true, preview bars interpolate in
  // OKLCH (matching the connection blend) instead of the classic sRGB blend.
  smoothGradients?: () => boolean;
};


type Tab = "palette" | "picker";
type PickerMode = "oklch" | "hsb";
const TAB_KEY = "nekudot.colors.tab";
const MOOD_KEY = "nekudot.colors.mood"; // selected mood id, or ALL_CATEGORIES

const trashIcon =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M3 6 h18"/><path d="M8 6 V4 a2 2 0 0 1 2 -2 h4 a2 2 0 0 1 2 2 v2"/>' +
  '<path d="M19 6 l-1 14 a2 2 0 0 1 -2 2 H8 a2 2 0 0 1 -2 -2 L5 6"/></svg>';

const eyedropperIcon =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M17 3.5 a2.12 2.12 0 0 1 3 3 L9 17.5 l-4 1 1 -4 11 -11 z"/><path d="M14.5 6.5 l3 3"/></svg>';

const editIcon =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 20 h9"/><path d="M16.5 3.5 a2.12 2.12 0 0 1 3 3 L7 19 l-4 1 1 -4 12.5 -12.5 z"/></svg>';

// A standard "import" glyph (down arrow dropping into a tray) for the Import
// button, drawn in the same stroke style as the other icons.
const importIcon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 3 V14"/><path d="M7.5 9.5 L12 14 l4.5 -4.5"/>' +
  '<path d="M4 16.5 V19 a2 2 0 0 0 2 2 h12 a2 2 0 0 0 2 -2 v-2.5"/></svg>';

// The mirror of importIcon (up arrow rising out of a tray) for per-palette export.
const exportIcon =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 15 V3"/><path d="M7.5 7.5 L12 3 l4.5 4.5"/>' +
  '<path d="M4 16.5 V19 a2 2 0 0 0 2 2 h12 a2 2 0 0 0 2 -2 v-2.5"/></svg>';

// The browser EyeDropper API (Chromium). Absent in Safari/Firefox - feature-detect.
type EyeDropperResult = { sRGBHex: string };
type EyeDropperCtor = new () => { open: () => Promise<EyeDropperResult> };
function getEyeDropper(): EyeDropperCtor | undefined {
  return (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function createPalettePanel(opts: PalettePanelOpts = {}): PalettePanel {
  let current: PickRequest | null = null;
  let custom: Palette[] = [];
  let loaded = false; // the initial loadCustomPalettes has resolved (guards early saves)
  let recent: string[] = [];
  let lastUsedId: string | null = null; // palette last picked from (pinned top)
  let activeTab: Tab = loadTab();
  let activeMood: string = loadMood(); // selected mood filter (ALL_CATEGORIES = show all)
  // List "Edit" mode (off by default for a clean pick view): reveals the New /
  // Import actions + per-palette edit/export/delete + gradient toggles. Distinct
  // from the focused single-palette editor (enterEdit/editView).
  let listEditing = false;
  let pickerMode: PickerMode = "oklch";
  let working = "#000000"; // the colour the Picker tab is editing
  // Focused palette editing: a draft copy of the palette being built/edited. While
  // set, the popover shows only that palette + the colour picker (see enterEdit).
  let editDraft: Palette | null = null;
  let editSelected = -1; // index of the swatch the picker is bound to (-1 = none)
  let editSwatchEls: HTMLElement[] = []; // swatch DOM, for live colour updates
  const MAXC = 0.37; // OKLCH chroma at the C slider's max

  const panel = document.createElement("div");
  panel.className = "color-palette-popover";
  panel.style.display = "none";

  // Header (title + close).
  const header = document.createElement("div");
  header.className = "panel-header";
  const title = document.createElement("h3");
  title.textContent = "Colors";
  header.appendChild(title);
  const actions = document.createElement("div");
  actions.className = "panel-header-actions";
  // "Edit" toggle (shown only on the Palette tab). Off => clean pick view.
  const editToggleBtn = document.createElement("button");
  editToggleBtn.type = "button";
  editToggleBtn.className = "palette-edit-toggle";
  editToggleBtn.textContent = "Edit";
  editToggleBtn.title = "Edit palettes: add, import, rename, export, delete";
  editToggleBtn.addEventListener("click", () => setListEditing(!listEditing));
  actions.append(editToggleBtn, makeCloseButton(() => close()));
  header.appendChild(actions);
  panel.appendChild(header);

  const body = document.createElement("div");
  body.className = "palette-body";
  panel.appendChild(body);

  // --- Recent (top) ----------------------------------------------------------
  const recentWrap = document.createElement("div");
  body.appendChild(recentWrap);

  // --- Tabs: Palette / Picker ------------------------------------------------
  const tabBar = document.createElement("div");
  tabBar.className = "settings-tabs palette-tabs";
  const paletteTabBtn = makeTab("Palette", "palette");
  const pickerTabBtn = makeTab("Picker", "picker");
  tabBar.append(paletteTabBtn, pickerTabBtn);
  body.appendChild(tabBar);

  // Palette pane: New / Import actions, a Mood filter combo, then the (mood-
  // filtered) list of all palettes.
  const customPane = document.createElement("div");
  customPane.className = "palette-pane";
  const customWrap = document.createElement("div");
  customWrap.className = "palette-list";
  const customFooter = document.createElement("div");
  customFooter.className = "palette-footer";
  const newPaletteBtn = makeActionBtn("+ New palette", () => enterEdit(null));
  const importBtn = makeActionBtn("Import/Export", () => openImportModal(), importIcon);
  customFooter.append(newPaletteBtn, importBtn);
  // "?" hints (shown in help mode, toggled by the ? key) explain each action.
  attachHelp(
    newPaletteBtn,
    "Build your own palette: name it, choose a category, then add swatches and pick " +
      "each colour. It's saved here, ready to edit or use as a gradient.",
  );
  attachHelp(
    importBtn,
    "Import or export palettes: add one of the bundled gradients, or import a GIMP " +
      "palette (.gpl) - the plain-text format GIMP, Krita, Inkscape and Aseprite " +
      "export. The same modal exports or restores all your palettes as a JSON backup.",
  );

  // Mood filter combo (under the actions). Default "All moods" shows everything.
  const moodRow = document.createElement("div");
  moodRow.className = "palette-mood-row";
  const moodLabel = document.createElement("label");
  moodLabel.className = "palette-mood-label";
  moodLabel.textContent = "Category";
  const moodSelect = document.createElement("select");
  moodSelect.className = "palette-mood-select";
  const allOpt = document.createElement("option");
  allOpt.value = ALL_CATEGORIES;
  allOpt.textContent = "All categories";
  moodSelect.appendChild(allOpt);
  for (const m of allCategories()) {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.name;
    moodSelect.appendChild(o);
  }
  moodSelect.value = activeMood;
  moodSelect.addEventListener("change", () => {
    activeMood = moodSelect.value;
    saveMood(activeMood);
    renderCustom();
    reposition();
  });
  moodRow.append(moodLabel, moodSelect);

  customPane.append(customFooter, moodRow, customWrap);
  body.appendChild(customPane);

  // Picker pane: OKLCH / HSB sub-tabs + eyedropper, the editors, and a shared
  // preview + Apply.
  const pickerPane = document.createElement("div");
  pickerPane.className = "palette-pane";
  const tools = document.createElement("div");
  tools.className = "palette-tools";
  const pickTabs = document.createElement("div");
  pickTabs.className = "settings-tabs palette-tabs";
  const oklchTabBtn = makePickTab("OKLCH", "oklch");
  const hsbTabBtn = makePickTab("HSB", "hsb");
  pickTabs.append(oklchTabBtn, hsbTabBtn);
  tools.appendChild(pickTabs);
  if (getEyeDropper()) {
    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "palette-icon-tool";
    eye.title = "Eyedropper - pick a colour from the screen";
    eye.innerHTML = eyedropperIcon;
    eye.addEventListener("click", openEyedropper);
    tools.appendChild(eye);
  }

  // Shared preview / hex / Done (declared before the editors so setWorking's
  // targets exist; reflects whichever picker sub-tab is active).
  const foot = document.createElement("div");
  foot.className = "picker-foot";
  const preview = document.createElement("span");
  preview.className = "picker-preview";
  const hexInput = document.createElement("input");
  hexInput.type = "text";
  hexInput.className = "picker-hex";
  hexInput.maxLength = 7;
  hexInput.spellcheck = false;
  hexInput.setAttribute("aria-label", "Hex colour");
  // Typing a valid hex drives the active editor (sliders/markers) + preview, and
  // applies the colour live - just like dragging a slider (see setWorking).
  hexInput.addEventListener("input", () => {
    const n = normalizeHex(hexInput.value);
    if (n) seedActiveEditor(n, true);
  });
  // On blur/enter, snap the text to the canonical form (or revert if invalid).
  hexInput.addEventListener("change", () => (hexInput.value = working));
  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "picker-apply";
  // The colour already applies live as you drag (see setWorking); this just
  // finalises - records it as recent and closes the popover.
  applyBtn.textContent = "Done";
  applyBtn.addEventListener("click", () => pick(working));
  foot.append(preview, hexInput, applyBtn);

  // The picker UI lives in one group so it can be reparented into the focused
  // palette editor (enterEdit) and back.
  const oklchEditor = buildOklchEditor(setWorking);
  const hsbEditor = buildHsbEditor(setWorking);
  const pickerGroup = document.createElement("div");
  pickerGroup.className = "picker-group";
  pickerGroup.append(tools, oklchEditor.el, hsbEditor.el, foot);
  pickerPane.appendChild(pickerGroup);
  body.appendChild(pickerPane);

  // --- Focused palette editor (only that palette + the picker + Save) ---------
  const editView = document.createElement("div");
  editView.className = "palette-pane palette-edit-view";
  editView.style.display = "none";
  const editNameInput = document.createElement("input");
  editNameInput.type = "text";
  editNameInput.className = "palette-name palette-edit-name";
  editNameInput.setAttribute("aria-label", "Palette name");
  editNameInput.addEventListener("input", () => {
    if (editDraft) editDraft.name = editNameInput.value;
  });
  // Mood selector for the draft (its value is set from the draft in enterEdit).
  const editMoodRow = document.createElement("div");
  editMoodRow.className = "palette-mood-row palette-edit-mood";
  const editMoodLabel = document.createElement("span");
  editMoodLabel.className = "palette-mood-label";
  editMoodLabel.textContent = "Category";
  const editMoodSelect = document.createElement("select");
  editMoodSelect.className = "palette-mood-select";
  for (const m of allCategories()) {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.name;
    editMoodSelect.appendChild(o);
  }
  editMoodSelect.addEventListener("change", () => {
    if (editDraft) editDraft.category = editMoodSelect.value;
  });
  editMoodRow.append(editMoodLabel, editMoodSelect);
  const editGrid = document.createElement("div");
  editGrid.className = "palette-grid";
  const editPickerSlot = document.createElement("div"); // pickerGroup moves here
  const editGradWrap = document.createElement("div"); // draft gradient toggle
  const editActions = document.createElement("div");
  editActions.className = "palette-edit-actions";
  const cancelBtn = makeActionBtn("Cancel", () => exitEdit(false));
  const saveBtn = makeActionBtn("Save palette", () => exitEdit(true));
  saveBtn.classList.add("palette-save-btn");
  editActions.append(cancelBtn, saveBtn);
  editView.append(
    editNameInput,
    editMoodRow,
    editGrid,
    editPickerSlot,
    editGradWrap,
    editActions,
  );
  body.appendChild(editView);

  const statusEl = document.createElement("div");
  statusEl.className = "palette-status";
  body.appendChild(statusEl);

  // --- Tabs ------------------------------------------------------------------
  function makeTab(label: string, tab: Tab): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "settings-tab";
    b.textContent = label;
    b.addEventListener("click", () => setTab(tab));
    return b;
  }
  function setTab(tab: Tab): void {
    activeTab = tab;
    saveTab(tab);
    customPane.style.display = tab === "palette" ? "" : "none";
    pickerPane.style.display = tab === "picker" ? "" : "none";
    paletteTabBtn.classList.toggle("active", tab === "palette");
    pickerTabBtn.classList.toggle("active", tab === "picker");
    editToggleBtn.style.display = tab === "palette" ? "" : "none"; // Edit is palette-only
    if (tab === "picker") setPickerMode(pickerMode);
    reposition();
  }
  // Reflect list-edit mode in the toggle's label + the New/Import footer's
  // visibility (the per-palette actions are gated inside renderCustom).
  function applyListEditing(): void {
    editToggleBtn.textContent = listEditing ? "Done" : "Edit";
    editToggleBtn.classList.toggle("active", listEditing);
    customFooter.style.display = listEditing ? "" : "none";
  }
  function setListEditing(on: boolean): void {
    listEditing = on;
    applyListEditing();
    renderCustom();
    reposition();
  }
  function loadTab(): Tab {
    try {
      // Migrate the old "app"/"custom" tabs (now merged) to "palette".
      return localStorage.getItem(TAB_KEY) === "picker" ? "picker" : "palette";
    } catch {
      return "palette";
    }
  }
  function saveTab(tab: Tab): void {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // ignore (private mode etc.)
    }
  }
  function loadMood(): string {
    try {
      const v = localStorage.getItem(MOOD_KEY);
      return v && (v === ALL_CATEGORIES || normalizeCategory(v) === v) ? v : ALL_CATEGORIES;
    } catch {
      return ALL_CATEGORIES;
    }
  }
  function saveMood(mood: string): void {
    try {
      localStorage.setItem(MOOD_KEY, mood);
    } catch {
      // ignore (private mode etc.)
    }
  }

  // --- Picker sub-tabs (OKLCH / HSB) -----------------------------------------
  // `live` is true only for a user gesture in an editor (slider drag / marker
  // move), false for programmatic seeding (open, sub-tab switch, hex typing).
  function setWorking(hex: string, live = false): void {
    working = hex;
    preview.style.background = hex;
    // Don't fight the user while they're typing in the hex field.
    if (document.activeElement !== hexInput) hexInput.value = hex;
    // In the focused editor, the picker drives the selected swatch live.
    if (editDraft && editSelected >= 0 && editSelected < editDraft.colors.length) {
      editDraft.colors[editSelected] = hex;
      editSwatchEls[editSelected]?.style.setProperty("background", hex);
    } else if (live && current) {
      // Outside the editor, dragging the slider/marker applies the colour live -
      // no Apply step. The footer button (Done) just records it as recent + closes
      // (see pick()). onPreview keeps this off the undo stack where onPick commits.
      const n = normalizeHex(hex);
      if (n) (current.onPreview ?? current.onPick)(n);
    }
  }
  // live=true when the seed is itself a user gesture (typing a hex), so it applies
  // the colour the same way dragging a slider does; false for programmatic seeds.
  function seedActiveEditor(hex: string, live = false): void {
    if (pickerMode === "oklch") oklchEditor.seed(hex, live);
    else hsbEditor.seed(hex, live);
  }
  function makePickTab(label: string, mode: PickerMode): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "settings-tab";
    b.textContent = label;
    b.addEventListener("click", () => setPickerMode(mode));
    return b;
  }
  function setPickerMode(mode: PickerMode): void {
    pickerMode = mode;
    oklchEditor.el.style.display = mode === "oklch" ? "" : "none";
    hsbEditor.el.style.display = mode === "hsb" ? "" : "none";
    oklchTabBtn.classList.toggle("active", mode === "oklch");
    hsbTabBtn.classList.toggle("active", mode === "hsb");
    // Seed the newly shown editor from the working colour (keeps continuity when
    // you switch sub-tabs mid-edit).
    if (mode === "oklch") oklchEditor.seed(working);
    else hsbEditor.seed(working);
    reposition();
  }

  // --- OKLCH editor: L / C / H sliders with live gradient tracks --------------
  function buildOklchEditor(onChange: (hex: string, live: boolean) => void): {
    el: HTMLElement;
    seed: (hex: string, live?: boolean) => void;
  } {
    const el = document.createElement("div");
    el.className = "oklch-editor";
    // step "any" keeps the sliders continuous, so seeding from a hex isn't
    // quantized - switching OKLCH <-> HSB then preserves the colour faithfully.
    const lRow = makeSliderRow("L", 0, 1, "any");
    const cRow = makeSliderRow("C", 0, MAXC, "any");
    const hRow = makeSliderRow("H", 0, 360, "any");
    el.append(lRow.row, cRow.row, hRow.row);

    const update = (live: boolean) => {
      const l = lRow.value();
      const c = cRow.value();
      const h = hRow.value();
      lRow.setTrack(sampleGradient((t) => oklchToHex({ l: t, c, h })));
      cRow.setTrack(sampleGradient((t) => oklchToHex({ l, c: t * MAXC, h })));
      hRow.setTrack(sampleGradient((t) => oklchToHex({ l, c, h: t * 360 })));
      lRow.setText(`${Math.round(l * 100)}%`);
      cRow.setText(c.toFixed(3));
      hRow.setText(`${Math.round(h)}°`);
      onChange(oklchToHex({ l, c, h }), live);
    };
    lRow.onInput(() => update(true));
    cRow.onInput(() => update(true));
    hRow.onInput(() => update(true));

    return {
      el,
      seed(hex: string, live = false) {
        const o = hexToOklch(normalizeHex(hex) ?? "#000000");
        lRow.set(o.l);
        cRow.set(o.c);
        hRow.set(o.h);
        update(live);
      },
    };
  }

  function makeSliderRow(label: string, min: number, max: number, step: number | string) {
    const row = document.createElement("div");
    row.className = "oklch-row";
    const lab = document.createElement("span");
    lab.className = "oklch-label";
    lab.textContent = label;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.className = "oklch-slider";
    const val = document.createElement("span");
    val.className = "oklch-val";
    row.append(lab, slider, val);
    return {
      row,
      value: () => Number(slider.value),
      set: (v: number) => (slider.value = String(v)),
      onInput: (cb: () => void) => slider.addEventListener("input", cb),
      setTrack: (css: string) => (slider.style.background = css),
      setText: (s: string) => (val.textContent = s),
    };
  }

  function sampleGradient(fn: (t: number) => string, n = 8): string {
    const stops: string[] = [];
    for (let i = 0; i <= n; i++) stops.push(fn(i / n));
    return `linear-gradient(to right, ${stops.join(", ")})`;
  }

  // --- HSB editor: Photoshop-style saturation/brightness square + hue bar -----
  function buildHsbEditor(onChange: (hex: string, live: boolean) => void): {
    el: HTMLElement;
    seed: (hex: string, live?: boolean) => void;
  } {
    const el = document.createElement("div");
    el.className = "hsb-editor";
    const main = document.createElement("div");
    main.className = "hsb-main";
    const sb = document.createElement("div");
    sb.className = "hsb-sb";
    const sbMarker = document.createElement("span");
    sbMarker.className = "hsb-sb-marker";
    sb.appendChild(sbMarker);
    const hue = document.createElement("div");
    hue.className = "hsb-hue";
    const hueMarker = document.createElement("span");
    hueMarker.className = "hsb-hue-marker";
    hue.appendChild(hueMarker);
    main.append(sb, hue);
    el.appendChild(main);

    let h = 0;
    let s = 0;
    let v = 0;

    const update = (live: boolean) => {
      // S/B field for the current hue: white -> hue across, black overlay down.
      sb.style.background =
        `linear-gradient(to top, #000, rgba(0,0,0,0)),` +
        `linear-gradient(to right, #fff, ${hsvToHex(h, 1, 1)})`;
      sbMarker.style.left = `${s * 100}%`;
      sbMarker.style.top = `${(1 - v) * 100}%`;
      hueMarker.style.top = `${(h / 360) * 100}%`;
      onChange(hsvToHex(h, s, v), live);
    };

    const sbPick = (ev: PointerEvent) => {
      const r = sb.getBoundingClientRect();
      s = clamp01((ev.clientX - r.left) / r.width);
      v = clamp01(1 - (ev.clientY - r.top) / r.height);
      update(true);
    };
    sb.addEventListener("pointerdown", (e) => {
      sb.setPointerCapture(e.pointerId);
      sbPick(e);
    });
    sb.addEventListener("pointermove", (e) => {
      if (sb.hasPointerCapture(e.pointerId)) sbPick(e);
    });
    sb.addEventListener("pointerup", (e) => sb.releasePointerCapture(e.pointerId));

    const huePick = (ev: PointerEvent) => {
      const r = hue.getBoundingClientRect();
      h = clamp01((ev.clientY - r.top) / r.height) * 360;
      update(true);
    };
    hue.addEventListener("pointerdown", (e) => {
      hue.setPointerCapture(e.pointerId);
      huePick(e);
    });
    hue.addEventListener("pointermove", (e) => {
      if (hue.hasPointerCapture(e.pointerId)) huePick(e);
    });
    hue.addEventListener("pointerup", (e) => hue.releasePointerCapture(e.pointerId));

    return {
      el,
      seed(hex: string, live = false) {
        const o = hexToHsv(normalizeHex(hex) ?? "#000000");
        h = o.h;
        s = o.s;
        v = o.v;
        update(live);
      },
    };
  }

  // --- Building blocks -------------------------------------------------------
  function makeSection(label: string): {
    section: HTMLElement;
    head: HTMLElement;
    grid: HTMLElement;
  } {
    const section = document.createElement("div");
    section.className = "palette-section";
    const head = document.createElement("div");
    head.className = "palette-section-head";
    const lab = document.createElement("span");
    lab.className = "palette-section-label";
    lab.textContent = label;
    head.appendChild(lab);
    const grid = document.createElement("div");
    grid.className = "palette-grid";
    section.append(head, grid);
    return { section, head, grid };
  }

  function makeSwatch(color: string, onPick: () => void, onRemove?: () => void): HTMLElement {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "swatch-chip";
    sw.style.background = color;
    sw.title = color;
    sw.addEventListener("click", onPick);
    if (onRemove) {
      const rm = document.createElement("span");
      rm.className = "swatch-remove";
      rm.textContent = "×";
      rm.title = "Remove colour";
      rm.addEventListener("click", (e) => {
        e.stopPropagation();
        onRemove();
      });
      sw.appendChild(rm);
    }
    return sw;
  }

  function makeActionBtn(
    label: string,
    onClick: () => void,
    icon?: string,
  ): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "palette-action-btn";
    if (icon) {
      // Leading icon + label in their own spans (the button is inline-flex, so
      // they centre with the CSS gap between them).
      const ic = document.createElement("span");
      ic.className = "palette-action-icon";
      ic.innerHTML = icon;
      const lab = document.createElement("span");
      lab.textContent = label;
      b.append(ic, lab);
    } else {
      b.textContent = label;
    }
    b.addEventListener("click", onClick);
    return b;
  }

  // --- Gradient flag + swatch editing ----------------------------------------
  function isGradient(p: Palette): boolean {
    return !!p.gradient;
  }
  // Persist palettes, then notify (after the write commits, so a reload in the
  // listener reads fresh data). Used by every palette mutation so that editing a
  // gradient palette's colours updates consumers (e.g. the connection Color dial)
  // live.
  function saveCustom(): void {
    // Don't persist before the initial load has populated `custom` - otherwise an
    // early mutation could overwrite the seeded palettes with an empty/stale list.
    if (!loaded) return;
    void saveCustomPalettes(custom).then(() => opts.onGradientsChanged?.());
  }
  function setGradient(p: Palette, on: boolean): void {
    p.gradient = on;
    renderCustom();
    saveCustom();
  }
  // Preview a palette as a left->right gradient, pre-blended in JS with the SAME
  // maths the connection art uses (colors/gradient), so the swatch matches the
  // rendered result - in either space, on every browser.
  function gradientCss(colors: string[]): string {
    const space: GradientSpace = opts.smoothGradients?.() ? "oklch" : "srgb";
    return gradientCssFor(colors, space);
  }
  // The "Gradient" on/off row shown under a palette's swatches, with a live bar.
  function makeGradRow(p: Palette): HTMLElement {
    const row = document.createElement("div");
    row.className = "palette-grad-row";
    const t = makeToggle(isGradient(p), (on) => setGradient(p, on));
    const lab = document.createElement("span");
    lab.className = "palette-grad-label";
    lab.textContent = "Gradient";
    row.append(t.el, lab);
    if (isGradient(p) && p.colors.length) {
      const bar = document.createElement("span");
      bar.className = "palette-grad-bar";
      bar.style.background = gradientCss(p.colors);
      row.appendChild(bar);
    }
    return row;
  }
  // --- Focused palette editor ------------------------------------------------
  // Open the editor on a custom palette (or a fresh draft when `p` is null). Hides
  // the browse UI and shows only the palette + the picker. The draft is a copy, so
  // nothing is persisted until Save.
  function enterEdit(p: Palette | null): void {
    editDraft = p
      ? { ...p, colors: [...p.colors] }
      : { id: makeId(), name: "New palette", colors: [], gradient: false, category: DEFAULT_CATEGORY };
    editSelected = editDraft.colors.length ? 0 : -1;
    editNameInput.value = editDraft.name;
    editMoodSelect.value = normalizeCategory(editDraft.category);
    // Draft gradient toggle (committed on Save, so it doesn't touch `custom` yet).
    const gradRow = document.createElement("div");
    gradRow.className = "palette-grad-row";
    const gradToggle = makeToggle(!!editDraft.gradient, (on) => {
      if (editDraft) editDraft.gradient = on;
    });
    const gradLabel = document.createElement("span");
    gradLabel.className = "palette-grad-label";
    gradLabel.textContent = "Gradient";
    gradRow.append(gradToggle.el, gradLabel);
    editGradWrap.replaceChildren(gradRow);
    editPickerSlot.appendChild(pickerGroup); // move the picker into the editor
    applyBtn.style.display = "none"; // changes are live; no Done button in edit mode
    setMode("edit");
    renderEditGrid();
    if (editSelected >= 0) {
      setWorking(normalizeHex(editDraft.colors[editSelected]) ?? "#000000");
      seedActiveEditor(working);
    }
    reposition();
  }
  function exitEdit(save: boolean): void {
    if (save && editDraft) {
      const d: Palette = { ...editDraft, colors: clampColors(editDraft.colors) };
      d.name = d.name.trim() || "Palette";
      custom = custom.some((x) => x.id === d.id)
        ? custom.map((x) => (x.id === d.id ? d : x))
        : [...custom, d];
      saveCustom();
    }
    editDraft = null;
    editSelected = -1;
    editSwatchEls = [];
    pickerPane.appendChild(pickerGroup); // move the picker back (children intact)
    applyBtn.style.display = "";
    setMode("browse");
    renderCustom();
  }
  function renderEditGrid(): void {
    if (!editDraft) return;
    editGrid.replaceChildren();
    editSwatchEls = [];
    editDraft.colors.forEach((c, i) => {
      const sw = makeSwatch(
        c,
        () => selectEditSwatch(i),
        () => removeEditColor(i),
      );
      if (i === editSelected) sw.classList.add("selected");
      editSwatchEls[i] = sw;
      editGrid.appendChild(sw);
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "swatch-chip palette-add-swatch";
    add.title = "Add a colour (then pick it below)";
    add.textContent = "+";
    add.addEventListener("click", addEditColor);
    editGrid.appendChild(add);
  }
  function selectEditSwatch(i: number): void {
    if (!editDraft) return;
    editSelected = i;
    for (let j = 0; j < editSwatchEls.length; j++)
      editSwatchEls[j]?.classList.toggle("selected", j === i);
    setWorking(normalizeHex(editDraft.colors[i]) ?? "#000000");
    seedActiveEditor(working);
  }
  // Add a new swatch and bind the picker to it, so the next picker change sets the
  // new colour (rather than dumping the current one).
  function addEditColor(): void {
    if (!editDraft || editDraft.colors.length >= MAX_SWATCHES) return;
    editDraft.colors = [...editDraft.colors, working];
    renderEditGrid();
    selectEditSwatch(editDraft.colors.length - 1);
  }
  function removeEditColor(i: number): void {
    if (!editDraft) return;
    editDraft.colors = editDraft.colors.filter((_, j) => j !== i);
    if (editSelected >= editDraft.colors.length) editSelected = editDraft.colors.length - 1;
    renderEditGrid();
    if (editSelected >= 0) selectEditSwatch(editSelected);
  }
  // Show either the browse UI (recents/tabs/panes) or only the focused editor.
  function setMode(mode: "browse" | "edit"): void {
    const browse = mode === "browse";
    tabBar.style.display = browse ? "" : "none";
    editView.style.display = browse ? "none" : "";
    if (browse) {
      setTab(activeTab);
      renderRecent();
    } else {
      recentWrap.style.display = "none";
      customPane.style.display = "none";
      pickerPane.style.display = "none";
      editToggleBtn.style.display = "none"; // hidden inside the focused editor
    }
  }

  // --- Picking ---------------------------------------------------------------
  // Selecting a colour applies it, records it as recent, and closes the popover -
  // the OS-colour-picker behaviour the user expects.
  function pick(hex: string): void {
    const n = normalizeHex(hex);
    if (!n || !current) return;
    current.onPick(n);
    recent = pushRecent(recent, n);
    void saveRecent(recent);
    close();
  }

  function openEyedropper(): void {
    const Ctor = getEyeDropper();
    if (!Ctor) return;
    // Hide the popover while sampling so it doesn't cover the pixels being aimed
    // at (the native eyedropper overlays the whole screen).
    panel.style.display = "none";
    new Ctor()
      .open()
      .then((r) => {
        // In the editor, drop the colour onto the selected swatch and reopen so
        // the user can keep editing; otherwise pick (applies + stays closed).
        if (editDraft) {
          seedActiveEditor(normalizeHex(r.sRGBHex) ?? "#000000");
          panel.style.display = "";
          reposition();
        } else {
          pick(r.sRGBHex);
        }
      })
      .catch(() => {
        // Cancelled (Escape / dismissed): bring the popover back.
        panel.style.display = "";
        reposition();
      });
  }

  // --- Rendering -------------------------------------------------------------
  function renderRecent(): void {
    recentWrap.replaceChildren();
    recentWrap.style.display = recent.length ? "" : "none";
    if (!recent.length) return;
    const { section, head, grid } = makeSection("Recent");
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "palette-link";
    clear.textContent = "Clear";
    clear.addEventListener("click", () => {
      recent = [];
      void saveRecent(recent);
      renderRecent();
    });
    head.appendChild(clear);
    for (const c of recent) grid.appendChild(makeSwatch(c, () => pick(c)));
    recentWrap.appendChild(section);
  }

  function emptyNote(text: string): HTMLElement {
    const p = document.createElement("p");
    p.className = "palette-empty";
    p.textContent = text;
    return p;
  }
  function paletteMatchesMood(p: Palette): boolean {
    return activeMood === ALL_CATEGORIES || normalizeCategory(p.category) === activeMood;
  }

  // The palette list, filtered by the active mood (ALL shows everything). Each
  // palette shows its swatches (click to pick), a mood tag, Edit + Delete, and a
  // Gradient toggle. The last-used palette floats to the top.
  function renderCustom(): void {
    customWrap.replaceChildren();
    if (custom.length === 0) {
      customWrap.appendChild(
        emptyNote(
          listEditing
            ? "No palettes yet. Use New palette or Import to add one."
            : "No palettes yet. Tap Edit to create or import one.",
        ),
      );
      return;
    }
    const visible = orderedCustom().filter(paletteMatchesMood);
    if (visible.length === 0) {
      customWrap.appendChild(
        emptyNote(`No "${categoryName(activeMood)}" palettes. Switch category or create one.`),
      );
      return;
    }
    for (const p of visible) {
      const { section, head, grid } = makeSection(p.name);
      section.classList.add("palette-custom");
      // Mood tag (helps tell palettes apart when viewing "All moods").
      const moodTag = document.createElement("span");
      moodTag.className = "palette-mood-tag";
      moodTag.textContent = categoryName(normalizeCategory(p.category));
      head.appendChild(moodTag);
      // A subtle "Last used" tag (only worth showing when there's more than one).
      if (custom.length > 1 && p.id === lastUsedId) {
        const tag = document.createElement("span");
        tag.className = "palette-lastused-tag";
        tag.textContent = "Last used";
        head.appendChild(tag);
      }
      // Edit affordances (per-palette actions + the Gradient toggle) only show in
      // list-edit mode, keeping the default pick view clean.
      if (listEditing) {
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "palette-icon-btn";
        edit.title = "Edit palette";
        edit.innerHTML = editIcon;
        edit.addEventListener("click", () => enterEdit(p));
        const exportBtn = document.createElement("button");
        exportBtn.type = "button";
        exportBtn.className = "palette-icon-btn";
        exportBtn.title = "Export as .gpl";
        exportBtn.innerHTML = exportIcon;
        exportBtn.addEventListener("click", () => downloadPalette(p));
        const del = document.createElement("button");
        del.type = "button";
        del.className = "palette-icon-btn";
        del.title = "Delete palette";
        del.innerHTML = trashIcon;
        del.addEventListener("click", () => {
          custom = custom.filter((x) => x.id !== p.id);
          saveCustom();
          renderCustom();
        });
        const acts = document.createElement("div");
        acts.className = "palette-head-actions";
        acts.append(edit, exportBtn, del);
        head.appendChild(acts);
      }

      for (const c of p.colors)
        grid.appendChild(makeSwatch(c, () => useCustomColor(p, c)));
      if (listEditing) section.appendChild(makeGradRow(p));
      customWrap.appendChild(section);
    }
  }

  // Custom palettes with the last-used one pinned first (others keep their order).
  function orderedCustom(): Palette[] {
    const out = [...custom];
    const i = lastUsedId ? out.findIndex((p) => p.id === lastUsedId) : -1;
    if (i > 0) out.unshift(out.splice(i, 1)[0]);
    return out;
  }

  // Pick a colour from a custom palette + remember that palette as last-used.
  function useCustomColor(p: Palette, color: string): void {
    if (lastUsedId !== p.id) {
      lastUsedId = p.id;
      void saveLastUsedPalette(p.id);
    }
    pick(color);
  }

  // Export a palette as a downloaded .gpl file (re-importable here or in GIMP).
  function downloadPalette(p: Palette): void {
    const slug =
      p.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    triggerDownload(new Blob([toGpl(p)], { type: "text/plain" }), `${slug || "palette"}.gpl`);
    setStatus(`Exported "${p.name}".`);
  }

  let statusTimer = 0;
  function setStatus(msg: string): void {
    statusEl.textContent = msg;
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => (statusEl.textContent = ""), 4000);
  }

  // Add a palette to the list (dedup by id), reveal it by switching the mood
  // filter to its mood, persist, and report. Shared by catalog-add and upload.
  function addPalette(p: Palette, msg: string): void {
    if (custom.some((x) => x.id === p.id)) {
      setStatus(`"${p.name}" is already in your palettes.`);
    } else {
      custom = [...custom, p];
      saveCustom();
      setStatus(msg);
    }
    // Only touch the mood filter if it would otherwise hide the result - drop to
    // "All moods" so the palette is visible, without overriding a deliberate filter
    // when it already matches.
    if (activeMood !== ALL_CATEGORIES && normalizeCategory(p.category) !== activeMood) {
      activeMood = ALL_CATEGORIES;
      moodSelect.value = activeMood;
      saveMood(activeMood);
    }
    renderCustom();
    reposition();
  }

  // --- Hidden file input (.gpl upload) ---------------------------------------
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".gpl,text/plain";
  fileInput.style.display = "none";
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ""; // allow re-importing the same file
    if (!file) return;
    const text = await file.text();
    const base = file.name.replace(/\.[^.]+$/, "");
    const pal = parseGpl(text, base || "Imported");
    if (!pal) {
      setStatus("Couldn't read that .gpl file.");
      return;
    }
    pal.category = DEFAULT_CATEGORY;
    closeImportModal();
    addPalette(pal, `Imported "${pal.name}" (${pal.colors.length} colours).`);
  });
  panel.appendChild(fileInput);

  // --- Import modal: the bundled gradient catalog + the file actions ----------
  // A child of `panel` so the popover's outside-click dismiss treats clicks in it
  // as "inside" (it stays open). Its own backdrop click / close button dismiss it.
  // The foot holds two groups: a single-palette upload (.gpl), and a JSON
  // backup/restore pair that exports or replaces the whole collection.
  const importModal = document.createElement("div");
  importModal.className = "palette-import-overlay";
  importModal.style.display = "none";
  const importCard = document.createElement("div");
  importCard.className = "palette-import-card";
  const importHead = document.createElement("div");
  importHead.className = "palette-import-head";
  const importTitle = document.createElement("h4");
  importTitle.textContent = "Import / Export palettes";
  importHead.append(importTitle, makeCloseButton(() => closeImportModal()));
  const importList = document.createElement("div");
  importList.className = "palette-import-list";
  const importFootEl = document.createElement("div");
  importFootEl.className = "palette-import-foot";
  const uploadBtn = makeActionBtn("Import .gpl file", () => fileInput.click(), importIcon);
  // Backup/restore the entire collection as one OKLCH JSON file. Export opens the
  // checkbox picker (so we close this modal first); import swaps in the file.
  const backupLabel = document.createElement("div");
  backupLabel.className = "palette-import-backup-label";
  backupLabel.textContent = "Multiple palettes (OKLCH - recommended format)";
  const backupRow = document.createElement("div");
  backupRow.className = "palette-import-backup";
  const exportJsonBtn = makeActionBtn(
    "Export",
    () => {
      closeImportModal();
      openExportModal();
    },
    exportIcon,
  );
  const importJsonBtn = makeActionBtn(
    "Import JSON",
    () => {
      closeImportModal();
      jsonFileInput.click();
    },
    importIcon,
  );
  backupRow.append(exportJsonBtn, importJsonBtn);
  importFootEl.append(uploadBtn, backupLabel, backupRow);
  importCard.append(importHead, importList, importFootEl);
  importModal.appendChild(importCard);
  importModal.addEventListener("click", (e) => {
    if (e.target === importModal) closeImportModal(); // backdrop only
  });
  panel.appendChild(importModal);

  // --- Backup: export / import all palettes as one OKLCH JSON file ------------
  const jsonFileInput = document.createElement("input");
  jsonFileInput.type = "file";
  jsonFileInput.accept = ".json,application/json";
  jsonFileInput.style.display = "none";
  jsonFileInput.addEventListener("change", async () => {
    const file = jsonFileInput.files?.[0];
    jsonFileInput.value = "";
    if (!file) return;
    // Reject an implausibly large file before reading it into memory; the parser
    // re-checks the text length and validates the shape with zod.
    if (file.size > MAX_BACKUP_BYTES) {
      setStatus("That file is too large to be a palette backup.");
      return;
    }
    const incoming = palettesFromOklchJson(await file.text());
    if (!incoming.length) {
      setStatus("Couldn't read that palette file.");
      return;
    }
    // Merge by id: same-id palettes are replaced, new ones appended.
    const byId = new Map(custom.map((p) => [p.id, p] as const));
    for (const p of incoming) byId.set(p.id, p);
    custom = [...byId.values()];
    saveCustom();
    renderCustom();
    reposition();
    setStatus(`Imported ${incoming.length} palette${incoming.length === 1 ? "" : "s"}.`);
  });
  panel.appendChild(jsonFileInput);

  // Export modal: a checkbox list of every palette (all checked) -> JSON download.
  const exportModal = document.createElement("div");
  exportModal.className = "palette-import-overlay";
  exportModal.style.display = "none";
  const exportCard = document.createElement("div");
  exportCard.className = "palette-import-card";
  const exportHead = document.createElement("div");
  exportHead.className = "palette-import-head";
  const exportTitle = document.createElement("h4");
  exportTitle.textContent = "Export palettes";
  exportHead.append(exportTitle, makeCloseButton(() => closeExportModal()));
  // A tools row above the list: a Select all / Deselect all toggle whose label
  // reflects the current state and flips every checkbox when clicked.
  const exportTools = document.createElement("div");
  exportTools.className = "palette-export-tools";
  const selectAllBtn = document.createElement("button");
  selectAllBtn.type = "button";
  selectAllBtn.className = "palette-link";
  selectAllBtn.addEventListener("click", () => {
    const target = !allChecked(); // all on -> clear; otherwise select every one
    for (const cb of exportChecks.values()) cb.checked = target;
    refreshSelectAll();
  });
  exportTools.appendChild(selectAllBtn);
  const exportList = document.createElement("div");
  exportList.className = "palette-import-list";
  const exportFootEl = document.createElement("div");
  exportFootEl.className = "palette-import-foot";
  const exportBtn = makeActionBtn("Export selected", () => doExport(), exportIcon);
  exportFootEl.appendChild(exportBtn);
  exportCard.append(exportHead, exportTools, exportList, exportFootEl);
  exportModal.appendChild(exportCard);
  exportModal.addEventListener("click", (e) => {
    if (e.target === exportModal) closeExportModal();
  });
  panel.appendChild(exportModal);

  const exportChecks = new Map<string, HTMLInputElement>(); // palette id -> checkbox
  // True when every palette is ticked - drives the toggle's label + behaviour.
  function allChecked(): boolean {
    return custom.length > 0 && custom.every((p) => exportChecks.get(p.id)?.checked);
  }
  function refreshSelectAll(): void {
    selectAllBtn.textContent = allChecked() ? "Deselect all" : "Select all";
  }
  function openExportModal(): void {
    exportList.replaceChildren();
    exportChecks.clear();
    exportTools.style.display = custom.length ? "" : "none";
    if (custom.length === 0) {
      const note = document.createElement("p");
      note.className = "palette-empty";
      note.textContent = "No palettes to export yet.";
      exportList.appendChild(note);
    }
    for (const p of custom) {
      const row = document.createElement("label");
      row.className = "palette-export-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true; // select all by default
      cb.addEventListener("change", refreshSelectAll);
      exportChecks.set(p.id, cb);
      const bar = document.createElement("span");
      bar.className = "palette-import-preview";
      bar.style.background = gradientCss(p.colors);
      const name = document.createElement("span");
      name.className = "palette-import-name";
      name.textContent = p.name;
      row.append(cb, bar, name);
      exportList.appendChild(row);
    }
    refreshSelectAll();
    exportModal.style.display = "";
    reposition();
  }
  function closeExportModal(): void {
    exportModal.style.display = "none";
  }
  function doExport(): void {
    const chosen = custom.filter((p) => exportChecks.get(p.id)?.checked);
    if (!chosen.length) {
      setStatus("Select at least one palette to export.");
      return;
    }
    triggerDownload(
      new Blob([palettesToOklchJson(chosen)], { type: "application/json" }),
      "nekudot-palettes.json",
    );
    closeExportModal();
    setStatus(`Exported ${chosen.length} palette${chosen.length === 1 ? "" : "s"}.`);
  }

  // One tappable row in the import list (a swatch preview + name → add it).
  function makeImportRow(item: CatalogItem): HTMLElement {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "palette-import-item";
    const bar = document.createElement("span");
    bar.className = "palette-import-preview";
    bar.style.background = gradientCss(item.palette.colors);
    const name = document.createElement("span");
    name.className = "palette-import-name";
    name.textContent = item.palette.name;
    row.append(bar, name);
    row.addEventListener("click", () => {
      addPalette({ ...item.palette }, `Added "${item.palette.name}".`);
      closeImportModal();
    });
    return row;
  }

  function openImportModal(): void {
    importList.replaceChildren();
    // Only palettes not already in the list. Deleting one (persisted in the
    // custom store) drops it from `custom`, so it reappears here keyed by its
    // catalog id - the bundled catalog is the persistent "source".
    const present = new Set(custom.map((p) => p.id));
    const available = gradientCatalog().filter((item) => !present.has(item.id));
    if (available.length === 0) {
      const note = document.createElement("p");
      note.className = "palette-empty";
      note.textContent =
        "Every bundled palette is in your list. Upload a .gpl, or delete a palette to make it available here again.";
      importList.appendChild(note);
    }
    // Group available palettes by category into collapsible sections, all closed
    // on open; clicking a category header reveals its palettes.
    const byCat = new Map<string, CatalogItem[]>();
    for (const item of available) {
      const c = normalizeCategory(item.palette.category);
      const arr = byCat.get(c) ?? [];
      arr.push(item);
      byCat.set(c, arr);
    }
    for (const cat of allCategories()) {
      const group = byCat.get(cat.id);
      if (!group || !group.length) continue;
      const section = document.createElement("div");
      section.className = "palette-import-group";
      const header = document.createElement("button");
      header.type = "button";
      header.className = "palette-import-group-head";
      header.setAttribute("aria-expanded", "false");
      const chevron = document.createElement("span");
      chevron.className = "palette-import-chevron";
      chevron.textContent = "▸";
      const label = document.createElement("span");
      label.textContent = `${cat.name} (${group.length})`;
      header.append(chevron, label);
      const body = document.createElement("div");
      body.className = "palette-import-group-body";
      body.style.display = "none"; // collapsed by default
      for (const item of group) body.appendChild(makeImportRow(item));
      header.addEventListener("click", () => {
        const open = body.style.display === "none";
        body.style.display = open ? "" : "none";
        header.setAttribute("aria-expanded", String(open));
        chevron.textContent = open ? "▾" : "▸";
        reposition();
      });
      section.append(header, body);
      importList.appendChild(section);
    }
    importModal.style.display = "";
    reposition();
  }
  function closeImportModal(): void {
    importModal.style.display = "none";
  }

  // --- Open / close / positioning --------------------------------------------
  // Dismiss handlers (outside click + Escape) are only attached while open.
  let onDocPointerDown: ((e: PointerEvent) => void) | null = null;
  let onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  let lastAnchor: HTMLElement | null = null;

  function open(req: PickRequest): void {
    current = req;
    lastAnchor = req.anchor;
    title.textContent = req.title;
    if (editDraft) exitEdit(false); // discard any in-progress edit from last time
    closeImportModal();
    closeExportModal();
    listEditing = false; // always open in the clean pick view
    applyListEditing();
    setWorking(normalizeHex(req.getColor()) ?? "#000000");
    renderCustom();
    setTab(activeTab); // re-seeds the Picker editor if that tab is active
    renderRecent();
    panel.style.display = "";
    positionNear(req.anchor);
    // Attach the outside-click dismiss on the next tick so the click that opened
    // the popover doesn't immediately close it.
    setTimeout(() => attachDismiss(req.anchor), 0);
  }

  function close(): void {
    panel.style.display = "none";
    closeImportModal();
    closeExportModal();
    detachDismiss();
  }

  function attachDismiss(anchor: HTMLElement): void {
    detachDismiss();
    onDocPointerDown = (e) => {
      const t = e.target as Node;
      // A native OS colour dialog isn't part of our DOM, so it won't land here.
      if (panel.contains(t) || anchor.contains(t)) return;
      close();
    };
    onKeyDown = (e) => {
      if (e.key !== "Escape") return;
      // Escape dismisses the topmost layer: an open modal first, else the popover.
      if (importModal.style.display !== "none") closeImportModal();
      else if (exportModal.style.display !== "none") closeExportModal();
      else close();
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
  }

  function detachDismiss(): void {
    if (onDocPointerDown)
      document.removeEventListener("pointerdown", onDocPointerDown, true);
    if (onKeyDown) document.removeEventListener("keydown", onKeyDown, true);
    onDocPointerDown = null;
    onKeyDown = null;
  }

  function reposition(): void {
    if (panel.style.display !== "none" && lastAnchor) positionNear(lastAnchor);
  }

  // Place the popover next to its anchor: below by default, flipped above when
  // there isn't room, and clamped to the viewport. On phones the CSS makes it a
  // bottom sheet, so clear any inline coords and let the stylesheet position it.
  function positionNear(anchor: HTMLElement): void {
    if (window.matchMedia("(max-width: 640px)").matches) {
      panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = "";
      return;
    }
    const gap = 8;
    const margin = 8;
    const a = anchor.getBoundingClientRect();
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    let top = a.bottom + gap;
    if (top + ph > window.innerHeight - margin && a.top - gap - ph > margin)
      top = a.top - gap - ph;
    let left = a.left;
    left = Math.min(left, window.innerWidth - pw - margin);
    left = Math.max(margin, left);
    top = Math.min(top, window.innerHeight - ph - margin);
    top = Math.max(margin, top);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  // --- Init ------------------------------------------------------------------
  title.textContent = "Colors";
  applyListEditing(); // start in the clean (non-edit) pick view
  setTab(activeTab);
  renderCustom();
  renderRecent();
  void loadCustomPalettes().then((p) => {
    custom = p;
    loaded = true;
    renderCustom();
  });
  void loadLastUsedPalette().then((id) => {
    lastUsedId = id;
    renderCustom(); // re-order once we know which palette was last used
  });
  void loadRecent().then((r) => {
    recent = r;
    renderRecent();
  });

  return { el: panel, open, close };
}

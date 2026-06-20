// The colour palette popover: a small floating picker that opens next to the
// swatch it was launched from (the toolbar Primary/Secondary swatches, the Layers
// background swatch, ...), like the OS colour picker. Layout, top to bottom:
//   - Recent colours
//   - Tabs: "App" (read-only default palettes) / "Custom" (the user's palettes +
//     New / Import GPL) / "Picker". The active tab is remembered across sessions.
//   - The Picker tab reveals OKLCH / HSB sub-tabs: OKLCH L/C/H sliders, or a
//     Photoshop-style saturation/brightness square + hue bar, plus an Eyedropper
//     (where supported) and a shared preview + Apply.
// Picking a colour applies it (via the request's onPick), records it as recent,
// and auto-closes. Clicking outside or pressing Escape also closes it.
import { makeCloseButton } from "../settings-panel";
import { makeToggle } from "../toggle";
import { attachHelp } from "../help";
import {
  builtinPalettes,
  clampColors,
  makeId,
  MAX_SWATCHES,
  normalizeHex,
  pushRecent,
  type Palette,
} from "./palette";
import { hexToOklch, oklchToHex } from "./oklch";
import { hexToHsv, hsvToHex } from "./hsv";
import { parseGpl } from "./gpl";
import {
  loadBuiltinGradients,
  loadCustomPalettes,
  loadLastUsedPalette,
  loadRecent,
  saveBuiltinGradients,
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
  onPick: (hex: string) => void; // apply a chosen "#rrggbb"
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
};

type Tab = "app" | "custom" | "picker";
type PickerMode = "oklch" | "hsb";
const TAB_KEY = "nekudot.colors.tab";

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
// Palette File button, drawn in the same stroke style as the other icons.
const importIcon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 3 V14"/><path d="M7.5 9.5 L12 14 l4.5 -4.5"/>' +
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
  let recent: string[] = [];
  let lastUsedId: string | null = null; // custom palette last picked from (pinned top)
  let activeTab: Tab = loadTab();
  let pickerMode: PickerMode = "oklch";
  let working = "#000000"; // the colour the Picker tab is editing
  // Focused palette editing: a draft copy of the palette being built/edited. While
  // set, the popover shows only that palette + the colour picker (see enterEdit).
  let editDraft: Palette | null = null;
  let editSelected = -1; // index of the swatch the picker is bound to (-1 = none)
  let editSwatchEls: HTMLElement[] = []; // swatch DOM, for live colour updates
  let builtinGradients: Record<string, boolean> = {}; // built-in gradient on/off
  const builtins = builtinPalettes();
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
  actions.appendChild(makeCloseButton(() => close()));
  header.appendChild(actions);
  panel.appendChild(header);

  const body = document.createElement("div");
  body.className = "palette-body";
  panel.appendChild(body);

  // --- Recent (top) ----------------------------------------------------------
  const recentWrap = document.createElement("div");
  body.appendChild(recentWrap);

  // --- Tabs: App / Custom / Picker -------------------------------------------
  const tabBar = document.createElement("div");
  tabBar.className = "settings-tabs palette-tabs";
  const appTabBtn = makeTab("App", "app");
  const customTabBtn = makeTab("Custom", "custom");
  const pickerTabBtn = makeTab("Picker", "picker");
  tabBar.append(appTabBtn, customTabBtn, pickerTabBtn);
  body.appendChild(tabBar);

  // App pane: read-only default palettes.
  const appPane = document.createElement("div");
  appPane.className = "palette-pane";
  const builtinWrap = document.createElement("div");
  builtinWrap.className = "palette-list";
  appPane.appendChild(builtinWrap);
  body.appendChild(appPane);

  // Custom pane: the user's palettes + New / Import GPL.
  const customPane = document.createElement("div");
  customPane.className = "palette-pane";
  const customWrap = document.createElement("div");
  customWrap.className = "palette-list";
  const customFooter = document.createElement("div");
  customFooter.className = "palette-footer";
  const newPaletteBtn = makeActionBtn("+ New palette", () => enterEdit(null));
  const importGplBtn = makeActionBtn(
    "Import Palette File (.gpl)",
    () => fileInput.click(),
    importIcon,
  );
  importGplBtn.classList.add("palette-action-wide"); // longer label: smaller + wraps
  customFooter.append(newPaletteBtn, importGplBtn);
  // "?" hints (shown in help mode, toggled by the ? key) explain each action.
  attachHelp(
    newPaletteBtn,
    "Build your own palette: name it, then add swatches and pick each colour. " +
      "It's saved here under Custom, ready to edit or use as a gradient.",
  );
  attachHelp(
    importGplBtn,
    "Load a GIMP palette (.gpl) - the plain-text colour-list format GIMP, Krita, " +
      "Inkscape and Aseprite all export. Pick a .gpl file and its colours arrive " +
      "as a new custom palette.",
  );
  // Actions (New palette / Import GPL) sit at the top, just under the tabs.
  customPane.append(customFooter, customWrap);
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

  // Shared preview / hex / Apply (declared before the editors so setWorking's
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
  // Typing a valid hex drives the active editor (sliders/markers) + preview.
  hexInput.addEventListener("input", () => {
    const n = normalizeHex(hexInput.value);
    if (n) seedActiveEditor(n);
  });
  // On blur/enter, snap the text to the canonical form (or revert if invalid).
  hexInput.addEventListener("change", () => (hexInput.value = working));
  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "picker-apply";
  applyBtn.textContent = "Apply";
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
  editView.append(editNameInput, editGrid, editPickerSlot, editGradWrap, editActions);
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
    appPane.style.display = tab === "app" ? "" : "none";
    customPane.style.display = tab === "custom" ? "" : "none";
    pickerPane.style.display = tab === "picker" ? "" : "none";
    appTabBtn.classList.toggle("active", tab === "app");
    customTabBtn.classList.toggle("active", tab === "custom");
    pickerTabBtn.classList.toggle("active", tab === "picker");
    if (tab === "picker") setPickerMode(pickerMode);
    reposition();
  }
  function loadTab(): Tab {
    try {
      const v = localStorage.getItem(TAB_KEY);
      return v === "custom" || v === "picker" ? v : "app";
    } catch {
      return "app";
    }
  }
  function saveTab(tab: Tab): void {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // ignore (private mode etc.)
    }
  }

  // --- Picker sub-tabs (OKLCH / HSB) -----------------------------------------
  function setWorking(hex: string): void {
    working = hex;
    preview.style.background = hex;
    // Don't fight the user while they're typing in the hex field.
    if (document.activeElement !== hexInput) hexInput.value = hex;
    // In the focused editor, the picker drives the selected swatch live.
    if (editDraft && editSelected >= 0 && editSelected < editDraft.colors.length) {
      editDraft.colors[editSelected] = hex;
      editSwatchEls[editSelected]?.style.setProperty("background", hex);
    }
  }
  function seedActiveEditor(hex: string): void {
    if (pickerMode === "oklch") oklchEditor.seed(hex);
    else hsbEditor.seed(hex);
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
  function buildOklchEditor(onChange: (hex: string) => void): {
    el: HTMLElement;
    seed: (hex: string) => void;
  } {
    const el = document.createElement("div");
    el.className = "oklch-editor";
    // step "any" keeps the sliders continuous, so seeding from a hex isn't
    // quantized - switching OKLCH <-> HSB then preserves the colour faithfully.
    const lRow = makeSliderRow("L", 0, 1, "any");
    const cRow = makeSliderRow("C", 0, MAXC, "any");
    const hRow = makeSliderRow("H", 0, 360, "any");
    el.append(lRow.row, cRow.row, hRow.row);

    const update = () => {
      const l = lRow.value();
      const c = cRow.value();
      const h = hRow.value();
      lRow.setTrack(sampleGradient((t) => oklchToHex({ l: t, c, h })));
      cRow.setTrack(sampleGradient((t) => oklchToHex({ l, c: t * MAXC, h })));
      hRow.setTrack(sampleGradient((t) => oklchToHex({ l, c, h: t * 360 })));
      lRow.setText(`${Math.round(l * 100)}%`);
      cRow.setText(c.toFixed(3));
      hRow.setText(`${Math.round(h)}°`);
      onChange(oklchToHex({ l, c, h }));
    };
    lRow.onInput(update);
    cRow.onInput(update);
    hRow.onInput(update);

    return {
      el,
      seed(hex: string) {
        const o = hexToOklch(normalizeHex(hex) ?? "#000000");
        lRow.set(o.l);
        cRow.set(o.c);
        hRow.set(o.h);
        update();
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
  function buildHsbEditor(onChange: (hex: string) => void): {
    el: HTMLElement;
    seed: (hex: string) => void;
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

    const update = () => {
      // S/B field for the current hue: white -> hue across, black overlay down.
      sb.style.background =
        `linear-gradient(to top, #000, rgba(0,0,0,0)),` +
        `linear-gradient(to right, #fff, ${hsvToHex(h, 1, 1)})`;
      sbMarker.style.left = `${s * 100}%`;
      sbMarker.style.top = `${(1 - v) * 100}%`;
      hueMarker.style.top = `${(h / 360) * 100}%`;
      onChange(hsvToHex(h, s, v));
    };

    const sbPick = (ev: PointerEvent) => {
      const r = sb.getBoundingClientRect();
      s = clamp01((ev.clientX - r.left) / r.width);
      v = clamp01(1 - (ev.clientY - r.top) / r.height);
      update();
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
      update();
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
      seed(hex: string) {
        const o = hexToHsv(normalizeHex(hex) ?? "#000000");
        h = o.h;
        s = o.s;
        v = o.v;
        update();
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
  // Built-ins default to gradient=on; their live state lives in builtinGradients
  // (the palette objects are regenerated each load). Custom palettes carry it on
  // the object.
  function isGradient(p: Palette): boolean {
    return p.builtin ? (builtinGradients[p.id] ?? true) : !!p.gradient;
  }
  // Persist custom palettes, then notify (after the write commits, so a reload in
  // the listener reads fresh data). Used by every custom-palette mutation so that
  // editing a gradient palette's colours updates consumers (e.g. the connection
  // Color dial) live.
  function saveCustom(): void {
    void saveCustomPalettes(custom).then(() => opts.onGradientsChanged?.());
  }
  function setGradient(p: Palette, on: boolean): void {
    if (p.builtin) {
      builtinGradients[p.id] = on;
      renderBuiltins();
      void saveBuiltinGradients(builtinGradients).then(() => opts.onGradientsChanged?.());
    } else {
      p.gradient = on;
      renderCustom();
      saveCustom();
    }
  }
  function gradientCss(colors: string[]): string {
    if (colors.length === 1) return colors[0];
    return `linear-gradient(to right, ${colors.join(", ")})`;
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
      : { id: makeId(), name: "New palette", colors: [], gradient: false };
    editSelected = editDraft.colors.length ? 0 : -1;
    editNameInput.value = editDraft.name;
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
    applyBtn.style.display = "none"; // changes are live; no Apply in edit mode
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
      appPane.style.display = "none";
      customPane.style.display = "none";
      pickerPane.style.display = "none";
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

  // App tab: read-only swatches. Not editable; each palette has a Gradient toggle
  // (default on).
  function renderBuiltins(): void {
    builtinWrap.replaceChildren();
    for (const p of builtins) {
      const { section, grid } = makeSection(p.name);
      for (const c of p.colors) grid.appendChild(makeSwatch(c, () => pick(c)));
      section.appendChild(makeGradRow(p));
      builtinWrap.appendChild(section);
    }
  }

  // Custom tab: each palette shows its swatches (click to select that colour), an
  // Edit button (opens the focused editor) and a delete button, plus its Gradient
  // toggle.
  function renderCustom(): void {
    customWrap.replaceChildren();
    if (custom.length === 0) {
      const empty = document.createElement("p");
      empty.className = "palette-empty";
      empty.textContent = "No custom palettes yet. Create one or import a .gpl file.";
      customWrap.appendChild(empty);
      return;
    }
    // Float the last-used palette to the top so it's the first thing under the
    // actions - quick re-access to whatever the user was just painting with.
    for (const p of orderedCustom()) {
      const { section, head, grid } = makeSection(p.name);
      section.classList.add("palette-custom");
      // A subtle "Last used" tag (only worth showing when there's more than one).
      if (custom.length > 1 && p.id === lastUsedId) {
        const tag = document.createElement("span");
        tag.className = "palette-lastused-tag";
        tag.textContent = "Last used";
        head.appendChild(tag);
      }
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "palette-icon-btn";
      edit.title = "Edit palette";
      edit.innerHTML = editIcon;
      edit.addEventListener("click", () => enterEdit(p));
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
      acts.append(edit, del);
      head.appendChild(acts);

      for (const c of p.colors)
        grid.appendChild(makeSwatch(c, () => useCustomColor(p, c)));
      section.appendChild(makeGradRow(p));
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

  let statusTimer = 0;
  function setStatus(msg: string): void {
    statusEl.textContent = msg;
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => (statusEl.textContent = ""), 4000);
  }

  // --- Hidden file input (GPL import) ----------------------------------------
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
    custom = [...custom, pal];
    saveCustom();
    renderCustom();
    setStatus(`Imported "${pal.name}" (${pal.colors.length} colours).`);
  });

  panel.appendChild(fileInput);

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
      if (e.key === "Escape") close();
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
  setTab(activeTab);
  renderBuiltins();
  renderCustom();
  renderRecent();
  void loadBuiltinGradients().then((m) => {
    builtinGradients = m;
    renderBuiltins();
  });
  void loadCustomPalettes().then((p) => {
    custom = p;
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

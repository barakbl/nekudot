import { attachMenu } from "./ui/menu";

export type MenuOption<T extends string> = {
  value: T;
  label: string;
  icon?: string;
  shortcut?: string;
};
export type MenuGroup<T extends string> = {
  kind: "group";
  label: string;
  items: MenuOption<T>[];
};
export type MenuEntry<T extends string> = MenuOption<T> | MenuGroup<T>;
export type MenuAction = {
  label: string;
  onClick: () => void;
  icon?: string;
  className?: string; // extra class on the navbar button (e.g. to hide on mobile)
};
export type ColorSlot = { initial: string; onChange: (color: string) => void };
export type ColorControl = {
  main: ColorSlot;
  secondary: ColorSlot;
  // When set, clicking a toolbar swatch opens the colour palette popover next to
  // it for that slot (the popover reaches the OS picker itself). `anchor` is the
  // clicked swatch, so the popover can position itself beside it.
  onOpenPalette?: (target: "main" | "secondary", anchor: HTMLElement) => void;
};

export type HistoryControl = {
  onUndo: () => void;
  onRedo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
};

export type Theme = "auto" | "light" | "dark";

export type CanvasMenuOptions = {
  onShareImage: () => void;
  onExportImage: () => void;
  onRecordClip: () => void;
  onSaveArtwork: () => void;
  onLoadArtwork: () => void;
  // When true (event log on), Record exports a process video, so the row relabels.
  eventLogActive?: () => boolean;
};

// A panel the "Windows" menu can open (revealing it on top), shown with its
// keyboard shortcut.
export type WindowEntry = {
  label: string;
  shortcut: string;
  open: () => void;
};

// The navbar Connecting combo: a grouped dropdown of art-style presets plus a
// gear that opens the Connecting settings box. Mirrors the brush selector, with
// group headers (Custom / Classic / More) shown as a tree.
export type ConnectionOption = {
  value: string;
  label: string;
  icon?: string;
  title?: string;
  custom?: boolean; // a user preset → gets a delete (×)
};
export type ConnectionOptionGroup = { group: string; items: ConnectionOption[] };
export type ConnectingControl = {
  groups: ConnectionOptionGroup[];
  initial: string;
  onChange: (value: string) => void; // pick an art-style preset
  onSettings?: () => void; // gear → open the Connecting box (omit when hosted in-panel)
  onDeleteCustom?: (value: string) => void; // × on a custom preset
  onImport?: () => void; // import (↓) on the Custom group header
  onExport?: () => void; // export (↑) on the Custom group header
};

// The connecting brush's art-style tree, rendered nested under its own entry in
// the Brush combo (so "Web" expands to its Classic / More / Custom styles).
// Selecting a style row selects the brush AND applies the style.
export type BrushStyleTree = {
  brushValue: string; // the connecting brush the styles nest under (e.g. "Round")
  groups: ConnectionOptionGroup[];
  current: string; // active style value (highlighted in the tree)
  onPick: (style: string) => void; // select that brush + apply the style
};

// The navbar Maps quick-access: a single cloud-of-dots icon. Clicking it opens
// the Maps subpanel (see maps-box.ts) anchored under the icon; the icon lights up
// while "Live view" is on so you know a map is showing on the canvas. The active
// map's name + live count live in the tooltip.
export type MapsPillControl = {
  getActiveInfo: () => { name: string; dots: number }; // active map, read live
  onOpen: (anchor: HTMLElement) => void; // click → open/close the Maps subpanel
  pinned: () => boolean; // whether "Live view" (the hot-map highlight) is on
  subscribe: (fn: () => void) => () => void; // refresh when maps change
};

// The navbar Layers quick-access: a single stacked-layers icon that opens the
// Layers subpanel (see layered/box.ts) anchored under it. The tooltip carries the
// active layer's name + count.
export type LayersPillControl = {
  getActiveInfo: () => { name: string; count: number }; // active layer + count
  onOpen: (anchor: HTMLElement) => void; // click → open/close the Layers subpanel
  subscribe: (fn: () => void) => () => void; // refresh when layers change
};

// The navbar Symmetry combo: an icon-only pill (the selected mode's glyph) +
// a gear that opens the Symmetry panel + a dropdown listing each mode as
// icon + name. Mirrors the Connecting combo, minus the collapsed label.
export type SymmetryModeOption = { value: string; label: string; icon: string };
export type SymmetryControl = {
  modes: SymmetryModeOption[];
  initial: string;
  onChange: (value: string) => void; // pick a mode
  onSettings: () => void; // gear → open the Symmetry panel
};

export function createMenu<T extends string>(
  options: MenuEntry<T>[],
  onChange: (value: T) => void,
  actions: MenuAction[] = [],
  colors?: ColorControl,
  initial?: T,
  onBrushSettings?: () => void,
  canvasOptions?: CanvasMenuOptions,
  history?: HistoryControl,
  windows?: WindowEntry[],
  connecting?: ConnectingControl,
  layers?: LayersPillControl,
  maps?: MapsPillControl,
  symmetry?: SymmetryControl,
  brushStyleTree?: BrushStyleTree,
): {
  el: HTMLElement;
  setBrushValue: (value: T) => void;
  setStyleValue: (v: string) => void;
  setStyleOptions: (g: ConnectionOptionGroup[]) => void;
  setConnectingValue: (v: string) => void;
  setConnectingVisible: (v: boolean) => void;
  setConnectingOptions: (groups: ConnectionOptionGroup[]) => void;
  setSymmetryValue: (v: string) => void;
  setMainColor: (v: string) => void;
  setSecondaryColor: (v: string) => void;
  refreshHistoryState: () => void;
  refreshMapsPill: () => void;
  layersPillAnchor: HTMLElement | null; // navbar Layers icon; the subpanel anchors here
  mapsPillAnchor: HTMLElement | null; // navbar Maps icon; the subpanel anchors here
  toggleCanvasMenu: () => void;
} {
  const bar = document.createElement("div");
  bar.className = "toolbar";
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Drawing tools");

  bar.appendChild(makeDragDots(bar));
  let toggleCanvasMenu = () => {};
  if (canvasOptions) {
    const { el, toggle } = makeCanvasMenu(canvasOptions);
    toggleCanvasMenu = toggle;
    bar.appendChild(el);
    // Share promoted onto the bar as its own button; the full set stays in More.
    bar.appendChild(makeShareButton(canvasOptions.onShareImage));
  }
  if (windows && windows.length) bar.appendChild(makeWindowsMenu(windows));
  // Layers icon sits just left of the Maps icon (appended first).
  let layersPillAnchor: HTMLElement | null = null;
  if (layers) {
    const pill = makeLayersPill(layers);
    layersPillAnchor = pill.anchor;
    bar.appendChild(pill.el);
  }
  let refreshMapsPill = () => {};
  let mapsPillAnchor: HTMLElement | null = null;
  if (maps) {
    const pill = makeMapsPill(maps);
    refreshMapsPill = pill.refresh;
    mapsPillAnchor = pill.anchor;
    bar.appendChild(pill.el);
  }
  const swatch = makeColorSwatch(colors);
  bar.appendChild(swatch.el);
  bar.appendChild(makeDivider());
  const flatOptions = flattenMenuEntries(options);
  const { pill, setValue, setStyleValue, setStyleOptions } = makeBrushPill(
    options,
    onChange,
    initial ?? flatOptions[0].value,
    onBrushSettings,
    brushStyleTree,
  );
  bar.appendChild(pill);
  // The Connecting combo sits right after the brush selector. It only shows for
  // brushes that support connecting (toggled via setConnectingVisible).
  let setConnectingValue = (_v: string) => {};
  let setConnectingVisible = (_v: boolean) => {};
  let setConnectingOptions = (_g: ConnectionOptionGroup[]) => {};
  if (connecting) {
    const combo = makeConnectingCombo(connecting);
    setConnectingValue = combo.setValue;
    setConnectingVisible = combo.setVisible;
    setConnectingOptions = combo.setOptions;
    bar.appendChild(combo.el);
  }
  // Symmetry combo sits right after Connecting; always visible (symmetry
  // applies to every brush).
  let setSymmetryValue = (_v: string) => {};
  if (symmetry) {
    const combo = makeSymmetryCombo(symmetry);
    setSymmetryValue = combo.setValue;
    bar.appendChild(combo.el);
  }
  // Undo/redo (+ their leading divider) are tagged so mobile can hide them —
  // on touch, undo/redo are the 2/3-finger tap gestures, so the buttons just
  // take space. Hiding the divider too avoids a doubled separator.
  const historyDivider = makeDivider();
  historyDivider.classList.add("history-divider");
  bar.appendChild(historyDivider);
  const undoBtn = makeSvgButton(undoIcon, "Undo", history?.onUndo);
  const redoBtn = makeSvgButton(redoIcon, "Redo", history?.onRedo);
  undoBtn.classList.add("history-btn");
  redoBtn.classList.add("history-btn");
  bar.appendChild(undoBtn);
  bar.appendChild(redoBtn);
  const refreshHistoryState = () => {
    if (!history) return;
    (undoBtn as HTMLButtonElement).disabled = !history.canUndo();
    (redoBtn as HTMLButtonElement).disabled = !history.canRedo();
  };
  refreshHistoryState();
  bar.appendChild(makeDivider());

  for (const action of actions) {
    const btn = document.createElement("button");
    btn.className = action.className ? `icon-btn ${action.className}` : "icon-btn";
    btn.title = action.label;
    btn.setAttribute("aria-label", action.label);
    if (action.icon) btn.innerHTML = action.icon;
    else btn.textContent = action.label;
    btn.addEventListener("click", action.onClick);
    bar.appendChild(btn);
  }

  return {
    el: bar,
    setBrushValue: setValue,
    setStyleValue,
    setStyleOptions,
    setConnectingValue,
    setConnectingVisible,
    setConnectingOptions,
    setSymmetryValue,
    setMainColor: swatch.setMain,
    setSecondaryColor: swatch.setSecondary,
    refreshHistoryState,
    refreshMapsPill,
    layersPillAnchor,
    mapsPillAnchor,
    toggleCanvasMenu,
  };
}

// The navbar Symmetry combo: icon-only pill + gear + a dropdown of modes
// (icon + name). Selecting a mode calls onChange; the gear opens the panel.
function makeSymmetryCombo(control: SymmetryControl): {
  el: HTMLElement;
  setValue: (v: string) => void;
} {
  const pill = document.createElement("span");
  pill.className = "pill brush-pill sym-combo-pill";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "brush-pill-trigger";

  const iconEl = document.createElement("span");
  iconEl.className = "brush-icon";
  trigger.appendChild(iconEl);

  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.textContent = "⌄";
  chevron.setAttribute("aria-hidden", "true");

  pill.appendChild(trigger);
  pill.appendChild(chevron);

  const popover = document.createElement("div");
  popover.className = "brush-popover";
  pill.appendChild(popover);

  const menu = attachMenu({ trigger, menu: popover, container: pill });

  const optionEls = new Map<string, HTMLElement>();
  let current = control.initial;

  const setValue = (v: string) => {
    current = v;
    const opt = control.modes.find((m) => m.value === v);
    iconEl.innerHTML = opt?.icon ?? "";
    const name = opt ? `Symmetry: ${opt.label}` : "Symmetry";
    trigger.title = name;
    trigger.setAttribute("aria-label", name);
    for (const [k, el] of optionEls) {
      el.classList.toggle("active", k === v);
      el.setAttribute("aria-checked", String(k === v));
    }
  };

  for (const m of control.modes) {
    const optEl = document.createElement("div");
    optEl.className = "brush-option";
    optEl.setAttribute("role", "menuitemradio");
    const optIcon = document.createElement("span");
    optIcon.className = "opt-icon";
    optIcon.innerHTML = m.icon;
    const optLabel = document.createElement("span");
    optLabel.className = "opt-label";
    optLabel.textContent = m.label;
    optEl.append(optIcon, optLabel);
    optEl.addEventListener("click", (e) => {
      e.stopPropagation();
      setValue(m.value);
      control.onChange(m.value);
      menu.close();
    });
    popover.appendChild(optEl);
    optionEls.set(m.value, optEl);
  }

  appendComboSettings(popover, "Symmetry settings", control.onSettings, () => menu.close());

  // The chevron / pill padding open the menu too (the trigger handles itself).
  pill.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".brush-pill-trigger") || t.closest(".brush-gear")) return;
    if (t.closest("[role='menu']")) return;
    menu.toggle();
  });

  setValue(current);
  return { el: pill, setValue };
}

// "Windows" dropdown: toggles each panel, shown as "[key] Label".
function makeWindowsMenu(items: WindowEntry[]): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "canvas-menu-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  btn.title = "Windows";
  btn.setAttribute("aria-label", "Windows");
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="4" width="18" height="16" rx="2"/>' +
    '<path d="M3 9 H21"/>' +
    "</svg>";
  wrap.appendChild(btn);

  const popover = document.createElement("div");
  popover.className = "brush-popover canvas-menu-popover";
  wrap.appendChild(popover);

  const menu = attachMenu({ trigger: btn, menu: popover, container: wrap });

  for (const it of items) {
    const row = document.createElement("div");
    row.className = "brush-option";
    row.setAttribute("role", "menuitem");
    const kbd = document.createElement("span");
    kbd.className = "opt-shortcut";
    kbd.textContent = it.shortcut;
    row.appendChild(kbd);
    const lbl = document.createElement("span");
    lbl.className = "opt-label";
    lbl.textContent = it.label;
    row.appendChild(lbl);
    // Spell the shortcut out for assistive tech (the visible glyph is terse).
    row.setAttribute("aria-label", `${it.label} (${it.shortcut})`);
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      it.open();
      menu.close();
    });
    popover.appendChild(row);
  }

  return wrap;
}

// Navbar Layers quick-access: a single stacked-layers icon that opens the Layers
// subpanel anchored beneath it. Tooltip carries the active layer's name + count,
// kept in sync via control.subscribe (layer add/remove/rename/reorder all emit).
function makeLayersPill(control: LayersPillControl): {
  el: HTMLElement;
  anchor: HTMLElement; // the icon button - the subpanel opens beneath it
  refresh: () => void;
} {
  const wrap = document.createElement("span");
  wrap.className = "pill layers-pill";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn layers-pill-btn";
  // Stacked-sheets glyph - the conventional "layers" icon.
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3 L21 8 L12 13 L3 8 Z"/>' +
    '<path d="M3 12 L12 17 L21 12"/>' +
    '<path d="M3 16 L12 21 L21 16"/>' +
    "</svg>";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    control.onOpen(btn);
  });
  wrap.appendChild(btn);

  const refresh = () => {
    const { name, count } = control.getActiveInfo();
    const c = `${count} ${count === 1 ? "layer" : "layers"}`;
    btn.setAttribute("aria-label", `Layers - ${name}, ${c}`);
    btn.title = `${name} - ${c} (open layers)`;
  };
  control.subscribe(refresh);
  refresh();

  return { el: wrap, anchor: btn, refresh };
}

// Navbar Maps quick-access (card #88): a single cloud-of-dots icon that opens the
// Maps subpanel anchored beneath it. The icon lights up (.is-on) while "Live view"
// is on. Tooltip carries the active map's name + count, kept in sync via
// control.subscribe + a refresh after strokes (Menu.refreshMapsPill).
function makeMapsPill(control: MapsPillControl): {
  el: HTMLElement;
  anchor: HTMLElement; // the icon button - the subpanel opens beneath it
  refresh: () => void;
} {
  const wrap = document.createElement("span");
  wrap.className = "pill maps-pill";

  // The point-cloud glyph (dots joined by faint connections - what a memory map
  // is). One click opens the Maps subpanel; a second click closes it.
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn maps-pill-btn";
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M5.5 16.5 L10 6.5 L18.5 10.5 L14 17.5 Z M10 6.5 L14 17.5" stroke-width="1.1" stroke-opacity="0.55"/>' +
    '<circle cx="5.5" cy="16.5" r="2" fill="currentColor" stroke="none"/>' +
    '<circle cx="10" cy="6.5" r="2" fill="currentColor" stroke="none"/>' +
    '<circle cx="18.5" cy="10.5" r="2" fill="currentColor" stroke="none"/>' +
    '<circle cx="14" cy="17.5" r="2" fill="currentColor" stroke="none"/>' +
    "</svg>";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    control.onOpen(btn);
  });
  wrap.appendChild(btn);

  const refresh = () => {
    const { name, dots } = control.getActiveInfo();
    const live = control.pinned();
    btn.classList.toggle("is-on", live);
    const count = `${dots} ${dots === 1 ? "dot" : "dots"}`;
    btn.setAttribute(
      "aria-label",
      live
        ? `Memory maps (Live view on) - ${name}, ${count}`
        : `Memory maps - ${name}, ${count}`,
    );
    btn.title = live
      ? `${name} - ${count} · Live view on (open memory maps)`
      : `${name} - ${count} (open memory maps)`;
  };
  control.subscribe(refresh);
  refresh();

  return { el: wrap, anchor: btn, refresh };
}

function makeCanvasMenu(opts: CanvasMenuOptions): {
  el: HTMLElement;
  toggle: () => void;
} {
  const wrap = document.createElement("span");
  wrap.className = "canvas-menu-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn canvas-menu-btn";
  btn.title = "More";
  btn.setAttribute("aria-label", "More");
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">' +
    '<circle cx="5" cy="12" r="1.6"/>' +
    '<circle cx="12" cy="12" r="1.6"/>' +
    '<circle cx="19" cy="12" r="1.6"/>' +
    "</svg>";
  wrap.appendChild(btn);

  const popover = document.createElement("div");
  popover.className = "brush-popover canvas-menu-popover";
  wrap.appendChild(popover);

  // Refresh dynamic labels each time the menu opens (assigned once the rows exist).
  let onMenuOpen: () => void = () => {};
  const menu = attachMenu({
    trigger: btn,
    menu: popover,
    container: wrap,
    onOpen: () => onMenuOpen(),
  });

  // Each row is a role="menuitem" with an icon (SVG markup or a glyph) + label.
  const addRow = (icon: string, label: string, onPick: () => void) => {
    const row = document.createElement("div");
    row.className = "brush-option";
    row.setAttribute("role", "menuitem");
    const ic = document.createElement("span");
    ic.className = "opt-icon";
    setIcon(ic, icon, "");
    const lbl = document.createElement("span");
    lbl.className = "opt-label";
    lbl.textContent = label;
    row.append(ic, lbl);
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      onPick();
      menu.close();
    });
    popover.appendChild(row);
    return lbl;
  };

  const SHARE_ICON =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 12 v7 a1 1 0 0 0 1 1 h14 a1 1 0 0 0 1 -1 v-7"/>' +
    '<path d="M12 15 V3"/>' +
    '<path d="M8 7 L12 3 L16 7"/>' +
    "</svg>";
  const GIF_ICON =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="5" width="18" height="14" rx="2"/>' +
    '<circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/>' +
    "</svg>";
  const SAVE_ICON =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M5 3 H16 L19 6 V21 H5 Z"/>' +
    '<path d="M8 3 V8 H15 V3"/>' +
    '<path d="M8 14 H16 V21 H8 Z"/>' +
    "</svg>";
  const LOAD_ICON =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 16 V4"/>' +
    '<path d="M8 8 L12 4 L16 8"/>' +
    '<path d="M4 16 V20 H20 V16"/>' +
    "</svg>";

  addRow(SHARE_ICON, "Share as PNG", opts.onShareImage);
  addRow("⤓", "Export image (.png)", opts.onExportImage);
  // With the event log on, Record exports a process video, not a GIF (label per open).
  const recordLabel = addRow(GIF_ICON, "Record GIF", opts.onRecordClip);
  onMenuOpen = () => {
    recordLabel.textContent = opts.eventLogActive?.() ? "Create process Video" : "Record GIF";
  };
  addRow(SAVE_ICON, "Save artwork (.nekudot)", opts.onSaveArtwork);
  addRow(LOAD_ICON, "Load artwork (.nekudot)", opts.onLoadArtwork);

  // The app's keyboard shortcut toggles the menu; focus the first item on open.
  const toggle = () => menu.toggle(true);
  return { el: wrap, toggle };
}

const undoIcon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="9 14 4 9 9 4"/>' +
  '<path d="M4 9 H14 A6 6 0 0 1 20 15 V20"/>' +
  "</svg>";

const redoIcon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<polyline points="15 14 20 9 15 4"/>' +
  '<path d="M20 9 H10 A6 6 0 0 0 4 15 V20"/>' +
  "</svg>";

const shareIcon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 12 v7 a1 1 0 0 0 1 1 h14 a1 1 0 0 0 1 -1 v-7"/>' +
  '<path d="M12 15 V3"/>' +
  '<path d="M8 7 L12 3 L16 7"/>' +
  "</svg>";

function makeShareButton(onShare: () => void): HTMLElement {
  const btn = makeSvgButton(shareIcon, "Share or save your art", onShare);
  btn.classList.add("share-btn");
  return btn;
}

function makeSvgButton(
  svg: string,
  title: string,
  onClick?: () => void,
): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.innerHTML = svg;
  if (onClick) btn.addEventListener("click", onClick);
  return btn;
}

function makeDragDots(bar: HTMLElement): HTMLElement {
  const el = document.createElement("span");
  el.className = "drag";
  for (let i = 0; i < 6; i++) el.appendChild(document.createElement("span"));

  let offsetX = 0;
  let offsetY = 0;

  el.addEventListener("pointerdown", (e) => {
    el.setPointerCapture(e.pointerId);
    const rect = bar.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    bar.style.transform = "none";
    bar.style.left = `${rect.left}px`;
    bar.style.top = `${rect.top}px`;
    el.classList.add("dragging");
  });

  el.addEventListener("pointermove", (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    bar.style.left = `${e.clientX - offsetX}px`;
    bar.style.top = `${e.clientY - offsetY}px`;
  });

  el.addEventListener("pointerup", (e) => {
    el.releasePointerCapture(e.pointerId);
    el.classList.remove("dragging");
  });

  return el;
}

function makeColorSwatch(
  colors?: ColorControl,
): { el: HTMLElement; setMain: (v: string) => void; setSecondary: (v: string) => void } {
  const wrap = document.createElement("span");
  wrap.className = "swatch-wrap";
  wrap.title = "Right-click or Shift+Enter to swap colors";

  const back = makeColorSlot("swatch-back", colors?.secondary, "secondary", colors?.onOpenPalette);
  const front = makeColorSlot("swatch-front", colors?.main, "main", colors?.onOpenPalette);

  const swap = () => {
    const a = back.getValue();
    const b = front.getValue();
    back.setValue(b);
    front.setValue(a);
  };

  wrap.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    swap();
  });
  // Keyboard equivalent of the right-click swap: the ContextMenu key or
  // Shift+Enter while a swatch button is focused (plain Enter still opens the
  // picker). Caught on the wrap as the keydown bubbles up from the buttons.
  wrap.addEventListener("keydown", (e) => {
    if (e.key === "ContextMenu" || (e.key === "Enter" && e.shiftKey)) {
      e.preventDefault();
      e.stopPropagation();
      swap();
    }
  });

  wrap.appendChild(back.el);
  wrap.appendChild(front.el);
  // setMain/setSecondary update the swatch AND fire the slot's onChange (so callers
  // like the Mandala start option, or the palette panel, drive the live colour).
  return { el: wrap, setMain: front.setValue, setSecondary: back.setValue };
}

type ColorSlotHandle = {
  el: HTMLElement;
  getValue: () => string;
  setValue: (v: string) => void;
};

function makeColorSlot(
  className: string,
  slot: ColorSlot | undefined,
  target?: "main" | "secondary",
  onOpenPalette?: (target: "main" | "secondary", anchor: HTMLElement) => void,
): ColorSlotHandle {
  const initial = slot?.initial ?? "#000000";

  // Without a slot the swatch is inert decoration, so keep it a plain span.
  if (!slot) {
    const span = document.createElement("span");
    span.className = className;
    span.style.background = initial;
    return { el: span, getValue: () => initial, setValue: () => {} };
  }

  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.style.background = initial;

  const name = target === "secondary" ? "Secondary" : "Main";
  const setLabel = (v: string) =>
    el.setAttribute(
      "aria-label",
      `${name} color: ${v}. Enter to change, Shift+Enter to swap`,
    );
  setLabel(initial);

  const input = document.createElement("input");
  input.type = "color";
  input.value = initial;
  input.className = "swatch-input";
  input.tabIndex = -1; // the button is the focus stop, not the hidden input
  input.setAttribute("aria-hidden", "true");
  el.appendChild(input);

  // With a palette panel wired, the swatch opens it (the panel reaches the OS
  // picker on its own); otherwise the swatch is the OS picker directly. The
  // hidden input stays the source of truth for the slot's value either way.
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    if (onOpenPalette && target) onOpenPalette(target, el);
    else input.click();
  });
  input.addEventListener("input", () => {
    el.style.background = input.value;
    setLabel(input.value);
    slot.onChange(input.value);
  });

  return {
    el,
    getValue: () => input.value,
    setValue: (v) => {
      input.value = v;
      el.style.background = v;
      setLabel(v);
      slot.onChange(v);
    },
  };
}

function makeDivider(): HTMLElement {
  const el = document.createElement("span");
  el.className = "divider";
  return el;
}

function setIcon(el: HTMLElement, icon: string | undefined, fallback: string): void {
  const v = icon ?? fallback;
  if (v.startsWith("<")) el.innerHTML = v;
  else el.textContent = v;
}

function flattenMenuEntries<T extends string>(
  entries: MenuEntry<T>[],
): MenuOption<T>[] {
  const flat: MenuOption<T>[] = [];
  for (const e of entries) {
    if ("kind" in e && e.kind === "group") flat.push(...e.items);
    else flat.push(e as MenuOption<T>);
  }
  return flat;
}

function makeBrushPill<T extends string>(
  entries: MenuEntry<T>[],
  onChange: (value: T) => void,
  initial: T,
  onBrushSettings?: () => void,
  styleTree?: BrushStyleTree,
): {
  pill: HTMLElement;
  setValue: (v: T) => void;
  setStyleValue: (v: string) => void;
  setStyleOptions: (g: ConnectionOptionGroup[]) => void;
} {
  const pill = document.createElement("span");
  pill.className = "pill brush-pill";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "brush-pill-trigger";

  const iconEl = document.createElement("span");
  iconEl.className = "brush-icon";

  const labelEl = document.createElement("span");
  labelEl.className = "brush-label";

  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.textContent = "⌄";
  chevron.setAttribute("aria-hidden", "true");

  trigger.appendChild(iconEl);
  trigger.appendChild(labelEl);
  pill.appendChild(trigger);

  pill.appendChild(chevron);

  const popover = document.createElement("div");
  popover.className = "brush-popover";
  pill.appendChild(popover);

  const menu = attachMenu({ trigger, menu: popover, container: pill });

  const optionEls = new Map<T, HTMLElement>();
  const styleEls = new Map<string, HTMLElement>();
  const flatOptions = flattenMenuEntries(entries);
  let currentBrushValue = initial;
  let styleGroups: ConnectionOptionGroup[] = styleTree?.groups ?? [];
  let currentStyle = styleTree?.current ?? "";

  // What the pill's trigger shows: normally the active brush's icon + name, but
  // when the connecting brush is active it mirrors the SELECTED STYLE's icon +
  // name, so the navbar reflects what you're actually drawing.
  const refreshTrigger = () => {
    if (styleTree && currentBrushValue === styleTree.brushValue) {
      const s = styleGroups.flatMap((g) => g.items).find((o) => o.value === currentStyle);
      if (s) {
        setIcon(iconEl, s.icon, "∿");
        labelEl.textContent = s.label;
        trigger.setAttribute("aria-label", `Brush: Web - ${s.label}`);
        return;
      }
    }
    const opt = flatOptions.find((o) => o.value === currentBrushValue);
    if (!opt) return;
    setIcon(iconEl, opt.icon, "∿");
    labelEl.textContent = opt.label;
    trigger.setAttribute("aria-label", `Brush: ${opt.label}`);
  };

  const setValue = (v: T) => {
    currentBrushValue = v;
    for (const [k, el] of optionEls) {
      const active = k === v;
      el.classList.toggle("active", active);
      el.setAttribute("aria-checked", String(active));
    }
    refreshTrigger();
  };

  const setStyleValue = (v: string) => {
    currentStyle = v;
    for (const [k, el] of styleEls) {
      const active = k === v;
      el.classList.toggle("active", active);
      el.setAttribute("aria-checked", String(active));
    }
    refreshTrigger();
  };

  const renderOption = (opt: MenuOption<T>, inGroup: boolean) => {
    const optEl = document.createElement("div");
    optEl.className = inGroup ? "brush-option in-group" : "brush-option";
    optEl.setAttribute("role", "menuitemradio");

    const optIcon = document.createElement("span");
    optIcon.className = "opt-icon";
    setIcon(optIcon, opt.icon, "");

    const optLabel = document.createElement("span");
    optLabel.className = "opt-label";
    optLabel.textContent = opt.label;

    optEl.appendChild(optIcon);
    optEl.appendChild(optLabel);

    if (opt.shortcut) {
      const kbd = document.createElement("span");
      kbd.className = "opt-shortcut";
      kbd.textContent = opt.shortcut;
      optEl.appendChild(kbd);
    }

    optEl.addEventListener("click", (e) => {
      e.stopPropagation();
      setValue(opt.value);
      onChange(opt.value);
      menu.close();
    });

    popover.appendChild(optEl);
    optionEls.set(opt.value, optEl);
  };

  // Empty style groups (e.g. Custom before any preset is saved) are skipped.
  const renderStyleSubtree = () => {
    if (!styleTree) return;
    for (const g of styleGroups) {
      if (!g.items.length) continue;
      const header = document.createElement("div");
      header.className = "brush-subgroup-header";
      header.textContent = g.group;
      popover.appendChild(header);
      for (const opt of g.items) {
        const optEl = document.createElement("div");
        optEl.className = "brush-option in-group style-child";
        optEl.setAttribute("role", "menuitemradio");
        if (opt.title) optEl.title = opt.title;
        const optIcon = document.createElement("span");
        optIcon.className = "opt-icon";
        if (opt.icon) setIcon(optIcon, opt.icon, "");
        const optLabel = document.createElement("span");
        optLabel.className = "opt-label";
        optLabel.textContent = opt.label;
        optEl.append(optIcon, optLabel);
        optEl.addEventListener("click", (e) => {
          e.stopPropagation();
          setStyleValue(opt.value);
          styleTree.onPick(opt.value);
          menu.close();
        });
        popover.appendChild(optEl);
        styleEls.set(opt.value, optEl);
      }
    }
  };

  const renderPopover = () => {
    popover.replaceChildren();
    optionEls.clear();
    styleEls.clear();
    for (const entry of entries) {
      if ("kind" in entry && entry.kind === "group") {
        const header = document.createElement("div");
        header.className = "brush-group-header";
        header.textContent = entry.label;
        popover.appendChild(header);
        for (const opt of entry.items) renderOption(opt, true);
      } else {
        const opt = entry as MenuOption<T>;
        renderOption(opt, false);
        if (styleTree && opt.value === styleTree.brushValue) renderStyleSubtree();
      }
    }
    if (onBrushSettings) {
      appendComboSettings(popover, "Brush settings", onBrushSettings, () => menu.close());
    }
    setValue(currentBrushValue);
    setStyleValue(currentStyle);
  };

  renderPopover();

  // The chevron / pill padding open the menu too (the trigger handles itself).
  pill.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".brush-pill-trigger") || t.closest(".brush-gear")) return;
    if (t.closest("[role='menu']")) return;
    menu.toggle();
  });

  return {
    pill,
    setValue,
    setStyleValue,
    setStyleOptions: (g: ConnectionOptionGroup[]) => {
      styleGroups = g;
      renderPopover();
    },
  };
}

const GEAR_SVG =
  '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="3"/>' +
  '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' +
  "</svg>";

// A "<feature> settings…" row at the foot of a combo dropdown (under a divider),
// replacing the per-combo navbar gear - see card #76.
function appendComboSettings(
  popover: HTMLElement,
  label: string,
  onClick: () => void,
  close: () => void,
): void {
  const sep = document.createElement("div");
  sep.className = "combo-sep";
  sep.setAttribute("role", "separator");
  popover.appendChild(sep);

  const row = document.createElement("button");
  row.type = "button";
  row.className = "combo-settings-row";
  row.setAttribute("role", "menuitem");
  const gear = document.createElement("span");
  gear.className = "combo-settings-gear";
  gear.innerHTML = GEAR_SVG;
  const text = document.createElement("span");
  text.textContent = `${label}…`;
  row.append(gear, text);
  row.addEventListener("click", (e) => {
    e.stopPropagation();
    close();
    onClick();
  });
  popover.appendChild(row);
}

// ↓ into tray = import from a file; ↑ out of tray = export to a file.
const IMPORT_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 13 v5 a1 1 0 0 0 1 1 h14 a1 1 0 0 0 1 -1 v-5"/><path d="M12 3 V15"/><path d="M8 11 L12 15 L16 11"/></svg>';
const EXPORT_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 13 v5 a1 1 0 0 0 1 1 h14 a1 1 0 0 0 1 -1 v-5"/><path d="M12 15 V3"/><path d="M8 7 L12 3 L16 7"/></svg>';

const CONNECT_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="2"/>' +
  '<path d="M12 2 V22 M2 12 H22 M5 5 L19 19 M19 5 L5 19"/>' +
  '<path d="M12 5 A7 7 0 0 1 19 12 M12 5 A7 7 0 0 0 5 12" />' +
  "</svg>";

// The Connecting combo: art-style preset dropdown + a gear for the Connecting
// box. Reuses the brush-pill styling so it sits visually beside the brush
// selector. Hidden (setVisible(false)) for brushes that don't connect.
export function makeConnectingCombo(control: ConnectingControl): {
  el: HTMLElement;
  setValue: (v: string) => void;
  setVisible: (v: boolean) => void;
  setOptions: (groups: ConnectionOptionGroup[]) => void;
} {
  const pill = document.createElement("span");
  pill.className = "pill brush-pill connect-pill";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "brush-pill-trigger";

  const iconEl = document.createElement("span");
  iconEl.className = "brush-icon";

  const labelEl = document.createElement("span");
  labelEl.className = "brush-label";

  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.textContent = "⌄";
  chevron.setAttribute("aria-hidden", "true");

  trigger.appendChild(iconEl);
  trigger.appendChild(labelEl);
  pill.appendChild(trigger);
  pill.appendChild(chevron);

  const popover = document.createElement("div");
  popover.className = "brush-popover";
  pill.appendChild(popover);

  const menu = attachMenu({ trigger, menu: popover, container: pill });

  let groups = control.groups;
  const optionEls = new Map<string, HTMLElement>();
  const flat = () => groups.flatMap((g) => g.items);
  let current = control.initial;

  const setValue = (v: string) => {
    current = v;
    const opt = flat().find((o) => o.value === v);
    // Show the selected style's glyph, falling back to the generic web mark.
    setIcon(iconEl, opt?.icon, CONNECT_ICON);
    labelEl.textContent = opt ? opt.label : v;
    const name = opt ? `Web: ${opt.label}` : "Web";
    trigger.title = opt?.title ?? name;
    trigger.setAttribute("aria-label", name);
    for (const [k, el] of optionEls) {
      el.classList.toggle("active", k === v);
      el.setAttribute("aria-checked", String(k === v));
    }
  };

  const renderOptions = () => {
    popover.replaceChildren();
    optionEls.clear();
    for (const g of groups) {
      const header = document.createElement("div");
      header.className = "brush-group-header";
      header.textContent = g.group;
      // The Custom group header carries import (always) + export (disabled when
      // empty) actions.
      if (g.group === "Custom" && (control.onImport || control.onExport)) {
        header.classList.add("with-actions");
        const acts = document.createElement("div");
        acts.className = "group-actions";
        const mkAction = (icon: string, title: string, disabled: boolean, fn?: () => void) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "group-action";
          b.title = title;
          b.setAttribute("aria-label", title);
          b.setAttribute("role", "menuitem");
          b.innerHTML = icon;
          b.disabled = disabled;
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            menu.close();
            fn?.();
          });
          return b;
        };
        if (control.onImport)
          acts.appendChild(mkAction(IMPORT_ICON, "Import presets (.preset)", false, control.onImport));
        if (control.onExport)
          acts.appendChild(mkAction(EXPORT_ICON, "Export presets", g.items.length === 0, control.onExport));
        header.appendChild(acts);
      }
      popover.appendChild(header);
      for (const opt of g.items) {
        const optEl = document.createElement("div");
        optEl.className = "brush-option in-group";
        optEl.setAttribute("role", "menuitemradio");
        if (opt.title) optEl.title = opt.title;
        const optIcon = document.createElement("span");
        optIcon.className = "opt-icon";
        if (opt.icon) setIcon(optIcon, opt.icon, "");
        const optLabel = document.createElement("span");
        optLabel.className = "opt-label";
        optLabel.textContent = opt.label;
        optEl.append(optIcon, optLabel);
        // User presets get a delete (×). Mouse: the × button. Keyboard: the
        // Delete/Backspace key while the row is focused (the × itself stays out
        // of the arrow-key order so each preset is a single stop).
        if (opt.custom && control.onDeleteCustom) {
          optEl.setAttribute(
            "aria-label",
            `${opt.label} (press Delete to remove)`,
          );
          optEl.setAttribute("aria-keyshortcuts", "Delete");
          const del = document.createElement("button");
          del.type = "button";
          del.className = "opt-remove";
          del.textContent = "×";
          del.title = "Delete preset";
          del.setAttribute("aria-label", `Delete preset ${opt.label}`);
          del.tabIndex = -1;
          del.addEventListener("click", (e) => {
            e.stopPropagation();
            control.onDeleteCustom?.(opt.value);
          });
          optEl.appendChild(del);
          optEl.addEventListener("keydown", (e) => {
            if (e.key === "Delete" || e.key === "Backspace") {
              e.preventDefault();
              e.stopPropagation();
              control.onDeleteCustom?.(opt.value);
            }
          });
        }
        optEl.addEventListener("click", (e) => {
          e.stopPropagation();
          setValue(opt.value);
          control.onChange(opt.value);
          menu.close();
        });
        popover.appendChild(optEl);
        optionEls.set(opt.value, optEl);
      }
    }
    if (control.onSettings)
      appendComboSettings(popover, "Web settings", control.onSettings, () => menu.close());
    setValue(current); // refresh active highlight against the new list
  };

  // The chevron / pill padding open the menu too (the trigger handles itself).
  pill.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".brush-pill-trigger") || t.closest(".brush-gear")) return;
    if (t.closest("[role='menu']")) return;
    menu.toggle();
  });

  renderOptions();

  return {
    el: pill,
    setValue,
    setVisible: (v) => {
      pill.style.display = v ? "" : "none";
    },
    setOptions: (g) => {
      groups = g;
      renderOptions();
    },
  };
}


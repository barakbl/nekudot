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
export type MenuAction = { label: string; onClick: () => void; icon?: string };
export type Tool = "eraser";
export type ColorSlot = { initial: string; onChange: (color: string) => void };
export type ColorControl = { main: ColorSlot; secondary: ColorSlot };

export type HistoryControl = {
  onUndo: () => void;
  onRedo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
};

export type Theme = "auto" | "light" | "dark";

export type CanvasMenuOptions = {
  initialTheme: Theme;
  onThemeChange: (theme: Theme) => void;
  onShareImage: () => void;
  onExportImage: () => void;
  onSaveArtwork: () => void;
  onLoadArtwork: () => void;
};

// A panel the "Windows" menu can toggle, shown with its keyboard shortcut.
export type WindowToggle = {
  label: string;
  shortcut: string;
  toggle: () => void;
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
  onSettings: () => void; // gear → open the Connecting box
  onDeleteCustom?: (value: string) => void; // × on a custom preset
  onImport?: () => void; // import (↓) on the Custom group header
  onExport?: () => void; // export (↑) on the Custom group header
};

// The navbar Maps quick-access: an icon whose popover summarises the memory
// maps (count + active map name/dots) and offers Flash + Open editor.
export type MapsControl = {
  // Read live each time the popover opens (count/dots change as you draw). Lists
  // every map with its live dot count; the active map is flagged (shown bold).
  getInfo: () => { maps: { name: string; dots: number; active: boolean }[] };
  onFlashActive: () => void; // flash the active map's dots (top action row)
  onFlashMap: (index: number) => void; // flash a specific map (per-row icon)
  onAddMap: () => void; // create a new map (made active)
  onRenameMap: (index: number, name: string) => void; // inline rename in the list
  onSelectMap: (index: number) => void; // make a listed map the active one
  onDeleteMap: (index: number) => void; // delete a map (the app confirms first)
};

export function createMenu<T extends string>(
  options: MenuEntry<T>[],
  onChange: (value: T) => void,
  actions: MenuAction[] = [],
  colors?: ColorControl,
  initial?: T,
  onBrushSettings?: () => void,
  canvasOptions?: CanvasMenuOptions,
  onToolChange?: (tool: Tool | null) => void,
  history?: HistoryControl,
  windows?: WindowToggle[],
  connecting?: ConnectingControl,
  maps?: MapsControl,
): {
  el: HTMLElement;
  setBrushValue: (value: T) => void;
  setConnectingValue: (v: string) => void;
  setConnectingVisible: (v: boolean) => void;
  setConnectingOptions: (groups: ConnectionOptionGroup[]) => void;
  refreshHistoryState: () => void;
  toggleCanvasMenu: () => void;
  toggleMaps: () => void;
} {
  const bar = document.createElement("div");
  bar.className = "toolbar";

  bar.appendChild(makeDragDots(bar));
  let toggleCanvasMenu = () => {};
  if (canvasOptions) {
    const { el, toggle } = makeCanvasMenu(canvasOptions);
    toggleCanvasMenu = toggle;
    bar.appendChild(el);
  }
  if (windows && windows.length) bar.appendChild(makeWindowsMenu(windows));
  let toggleMaps = () => {};
  if (maps) {
    const m = makeMapsMenu(maps);
    bar.appendChild(m.el);
    toggleMaps = m.toggle;
  }
  bar.appendChild(makeColorSwatch(colors));
  bar.appendChild(makeDivider());
  const flatOptions = flattenMenuEntries(options);
  const { pill, setValue } = makeBrushPill(
    options,
    onChange,
    initial ?? flatOptions[0].value,
    onBrushSettings,
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
  bar.appendChild(makeToolToggles(onToolChange));
  bar.appendChild(makeDivider());
  const undoBtn = makeSvgButton(undoIcon, "Undo", history?.onUndo);
  const redoBtn = makeSvgButton(redoIcon, "Redo", history?.onRedo);
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
    btn.className = "icon-btn";
    btn.title = action.label;
    if (action.icon) btn.innerHTML = action.icon;
    else btn.textContent = action.label;
    btn.addEventListener("click", action.onClick);
    bar.appendChild(btn);
  }

  return {
    el: bar,
    setBrushValue: setValue,
    setConnectingValue,
    setConnectingVisible,
    setConnectingOptions,
    refreshHistoryState,
    toggleCanvasMenu,
    toggleMaps,
  };
}

// "Windows" dropdown: toggles each panel, shown as "[key] Label".
function makeWindowsMenu(items: WindowToggle[]): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "canvas-menu-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  btn.title = "Windows";
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="4" width="18" height="16" rx="2"/>' +
    '<path d="M3 9 H21"/>' +
    "</svg>";
  wrap.appendChild(btn);

  const popover = document.createElement("div");
  popover.className = "brush-popover canvas-menu-popover";
  wrap.appendChild(popover);

  for (const it of items) {
    const row = document.createElement("div");
    row.className = "brush-option";
    const kbd = document.createElement("span");
    kbd.className = "opt-shortcut";
    kbd.textContent = it.shortcut;
    row.appendChild(kbd);
    const lbl = document.createElement("span");
    lbl.className = "opt-label";
    lbl.textContent = it.label;
    row.appendChild(lbl);
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      it.toggle();
      popover.classList.remove("open");
    });
    popover.appendChild(row);
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    popover.classList.toggle("open");
  });
  document.addEventListener("mousedown", (e) => {
    if (!popover.classList.contains("open")) return;
    if (wrap.contains(e.target as Node)) return;
    popover.classList.remove("open");
  });

  return wrap;
}

// Navbar Maps quick-access: a scattered-dots icon whose popover shows the
// number of memory maps and the active map's name + live dot count, plus rows
// to flash the active map on the canvas or open the full Maps editor.
function makeMapsMenu(control: MapsControl): { el: HTMLElement; toggle: () => void } {
  const wrap = document.createElement("span");
  wrap.className = "canvas-menu-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  btn.title = "Memory maps";
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M9 4 L3 6 V20 L9 18 L15 20 L21 18 V4 L15 6 L9 4 Z"/>' +
    '<path d="M9 4 V18"/><path d="M15 6 V20"/>' +
    "</svg>";
  wrap.appendChild(btn);

  const popover = document.createElement("div");
  popover.className = "brush-popover canvas-menu-popover maps-menu-popover";
  wrap.appendChild(popover);

  const titleEl = document.createElement("div");
  titleEl.className = "maps-menu-title";
  titleEl.textContent = "Memory Maps";
  popover.appendChild(titleEl);

  // The target glyph (matches the Maps box Flash button), reused for the active
  // action and each per-map flash icon.
  const FLASH_ICON =
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">' +
    '<circle cx="8" cy="8" r="5.2"/>' +
    '<circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/>' +
    '<path d="M8 0.5 V2.5 M8 13.5 V15.5 M0.5 8 H2.5 M13.5 8 H15.5" stroke-linecap="round"/>' +
    "</svg>";

  const makeRow = (icon: string, label: string, onClick: () => void, keepOpen = false) => {
    const row = document.createElement("div");
    row.className = "brush-option";
    const ic = document.createElement("span");
    ic.className = "opt-icon";
    ic.innerHTML = icon;
    const lbl = document.createElement("span");
    lbl.className = "opt-label";
    lbl.textContent = label;
    row.append(ic, lbl);
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!keepOpen) popover.classList.remove("open");
      onClick();
    });
    popover.appendChild(row);
  };

  // Actions first. "New map" keeps the popover open and re-renders the list so
  // the freshly-created (now active) map shows immediately, ready to rename.
  makeRow(
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5 V19 M5 12 H19"/></svg>',
    "New map",
    () => { control.onAddMap(); renderInfo(); },
    true,
  );
  makeRow(FLASH_ICON, "Flash Active map on canvas", control.onFlashActive);

  const sep = document.createElement("div");
  sep.className = "canvas-menu-sep";
  popover.appendChild(sep);

  // Maps list at the bottom — rebuilt on open since the list/counts change as
  // you draw. Each row carries its own flash icon; the active map is bold.
  const info = document.createElement("div");
  info.className = "maps-menu-info";
  popover.appendChild(info);
  const countEl = document.createElement("div");
  countEl.className = "maps-menu-count";
  const listEl = document.createElement("div");
  listEl.className = "maps-menu-list";
  info.append(countEl, listEl);

  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const renderInfo = () => {
    const { maps } = control.getInfo();
    countEl.textContent = plural(maps.length, "map");
    listEl.replaceChildren();
    maps.forEach((m, i) => {
      const row = document.createElement("div");
      row.className = "maps-menu-row" + (m.active ? " active" : "");
      const flash = document.createElement("button");
      flash.type = "button";
      flash.className = "maps-menu-flash";
      flash.title = `Flash ${m.name} on canvas`;
      flash.innerHTML = FLASH_ICON;
      flash.addEventListener("click", (e) => {
        e.stopPropagation();
        popover.classList.remove("open"); // close so the flash is unobstructed
        control.onFlashMap(i);
      });
      const name = document.createElement("span");
      name.className = "maps-menu-name";
      name.title = "Click to rename";
      name.textContent = m.name;
      // Click the name to rename inline: swap in an input; Enter/blur commits,
      // Escape cancels. stopPropagation on keys so brush shortcuts don't fire.
      name.addEventListener("click", (e) => {
        e.stopPropagation();
        const input = document.createElement("input");
        input.className = "maps-menu-name-input";
        input.value = m.name;
        row.replaceChild(input, name);
        input.focus();
        input.select();
        let done = false;
        const commit = (save: boolean) => {
          if (done) return;
          done = true;
          if (save) control.onRenameMap(i, input.value.trim());
          renderInfo();
        };
        input.addEventListener("click", (ev) => ev.stopPropagation());
        input.addEventListener("keydown", (ev) => {
          ev.stopPropagation();
          if (ev.key === "Enter") commit(true);
          else if (ev.key === "Escape") commit(false);
        });
        input.addEventListener("blur", () => commit(true));
      });
      // Active map gets an "(Active)" tag; the others get a Select button that
      // makes them active (keeps the popover open so the change is visible).
      let middle: HTMLElement;
      if (m.active) {
        const tag = document.createElement("span");
        tag.className = "maps-menu-tag";
        tag.textContent = "(Active)";
        middle = tag;
      } else {
        const sel = document.createElement("button");
        sel.type = "button";
        sel.className = "maps-menu-select";
        sel.textContent = "Select";
        sel.title = `Make ${m.name} the active map`;
        sel.addEventListener("click", (e) => {
          e.stopPropagation();
          popover.classList.remove("open"); // close so the flash is unobstructed
          control.onSelectMap(i);
        });
        middle = sel;
      }
      const dots = document.createElement("span");
      dots.className = "maps-menu-dots";
      const dotsN = document.createElement("span");
      dotsN.textContent = String(m.dots);
      const dotsU = document.createElement("span");
      dotsU.className = "maps-menu-dots-unit";
      dotsU.textContent = m.dots === 1 ? " dot" : " dots";
      dots.append(dotsN, dotsU);
      row.append(middle, flash, name, dots);
      // Delete is only offered when there's more than one map (at least one must
      // remain). The app shows a confirm modal before actually removing it.
      if (maps.length > 1) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "maps-menu-delete";
        del.title = `Delete ${m.name}`;
        del.innerHTML =
          '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M7 7l1 13h8l1-13"/></svg>';
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          popover.classList.remove("open"); // close behind the confirm modal
          control.onDeleteMap(i);
        });
        row.append(del);
      }
      listEl.appendChild(row);
    });
  };

  const toggle = () => {
    const open = popover.classList.toggle("open");
    if (open) renderInfo();
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });
  document.addEventListener("mousedown", (e) => {
    if (!popover.classList.contains("open")) return;
    if (wrap.contains(e.target as Node)) return;
    popover.classList.remove("open");
  });

  return { el: wrap, toggle };
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

  const sectionLabel = (text: string) => {
    const el = document.createElement("div");
    el.className = "canvas-menu-section";
    el.textContent = text;
    return el;
  };

  // Theme: collapsed to the current choice (icon + name); clicking it opens a
  // submenu to pick a different one, instead of always listing all three.
  popover.appendChild(sectionLabel("Theme"));
  const themes: Theme[] = ["auto", "light", "dark"];
  const themeIcon: Record<Theme, string> = {
    auto: "◐",
    light: "☀",
    dark: "☾",
  };
  let activeTheme = opts.initialTheme;
  const cap = (t: Theme) => t[0].toUpperCase() + t.slice(1);

  // The trigger row, showing the active theme + a chevron.
  const themeHead = document.createElement("div");
  themeHead.className = "brush-option canvas-menu-current";
  const headIc = document.createElement("span");
  headIc.className = "opt-icon";
  const headLbl = document.createElement("span");
  headLbl.className = "opt-label";
  const headChev = document.createElement("span");
  headChev.className = "chevron";
  headChev.textContent = "⌄";
  themeHead.append(headIc, headLbl, headChev);
  popover.appendChild(themeHead);

  // The submenu, collapsed by default.
  const themeSub = document.createElement("div");
  themeSub.className = "canvas-menu-sub";
  popover.appendChild(themeSub);

  const collapse = () => {
    themeSub.classList.remove("open");
    themeHead.classList.remove("open");
  };
  const syncHead = () => {
    headIc.textContent = themeIcon[activeTheme];
    headLbl.textContent = cap(activeTheme);
  };
  // The submenu offers only the *other* themes ("choose a different one"), so the
  // current theme never appears twice (once in the trigger, once in the list).
  // Rebuilt on each pick so the set stays correct.
  const renderSub = () => {
    themeSub.replaceChildren();
    for (const t of themes) {
      if (t === activeTheme) continue;
      const row = document.createElement("div");
      row.className = "brush-option in-group";
      const ic = document.createElement("span");
      ic.className = "opt-icon";
      ic.textContent = themeIcon[t];
      const lbl = document.createElement("span");
      lbl.className = "opt-label";
      lbl.textContent = cap(t);
      row.append(ic, lbl);
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        activeTheme = t;
        syncHead();
        renderSub();
        collapse();
        opts.onThemeChange(t);
      });
      themeSub.appendChild(row);
    }
  };
  themeHead.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = themeSub.classList.toggle("open");
    themeHead.classList.toggle("open", open);
  });
  syncHead();
  renderSub();

  // Divider
  const sep = document.createElement("div");
  sep.className = "canvas-menu-sep";
  popover.appendChild(sep);

  // Share as PNG — flatten + hand to the native share sheet (download +
  // clipboard-caption fallback on desktop).
  const sh = document.createElement("div");
  sh.className = "brush-option";
  const shIc = document.createElement("span");
  shIc.className = "opt-icon";
  shIc.innerHTML =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 12 v7 a1 1 0 0 0 1 1 h14 a1 1 0 0 0 1 -1 v-7"/>' +
    '<path d="M12 15 V3"/>' +
    '<path d="M8 7 L12 3 L16 7"/>' +
    "</svg>";
  sh.appendChild(shIc);
  const shLbl = document.createElement("span");
  shLbl.className = "opt-label";
  shLbl.textContent = "Share as PNG";
  sh.appendChild(shLbl);
  sh.addEventListener("click", (e) => {
    e.stopPropagation();
    opts.onShareImage();
    popover.classList.remove("open");
  });
  popover.appendChild(sh);

  // Export image (.png) — flattened share-ready PNG.
  const exp = document.createElement("div");
  exp.className = "brush-option";
  const expIc = document.createElement("span");
  expIc.className = "opt-icon";
  expIc.textContent = "⤓";
  exp.appendChild(expIc);
  const expLbl = document.createElement("span");
  expLbl.className = "opt-label";
  expLbl.textContent = "Export image (.png)";
  exp.appendChild(expLbl);
  exp.addEventListener("click", (e) => {
    e.stopPropagation();
    opts.onExportImage();
    popover.classList.remove("open");
  });
  popover.appendChild(exp);

  // Save artwork (.nekudot) — editable archive for resuming work later.
  const dl = document.createElement("div");
  dl.className = "brush-option";
  const dlIc = document.createElement("span");
  dlIc.className = "opt-icon";
  dlIc.innerHTML =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M5 3 H16 L19 6 V21 H5 Z"/>' +
    '<path d="M8 3 V8 H15 V3"/>' +
    '<path d="M8 14 H16 V21 H8 Z"/>' +
    "</svg>";
  dl.appendChild(dlIc);
  const dlLbl = document.createElement("span");
  dlLbl.className = "opt-label";
  dlLbl.textContent = "Save artwork (.nekudot)";
  dl.appendChild(dlLbl);
  dl.addEventListener("click", (e) => {
    e.stopPropagation();
    opts.onSaveArtwork();
    popover.classList.remove("open");
  });
  popover.appendChild(dl);

  // Load artwork (.nekudot) — upload + verify an existing archive.
  const ld = document.createElement("div");
  ld.className = "brush-option";
  const ldIc = document.createElement("span");
  ldIc.className = "opt-icon";
  ldIc.innerHTML =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 16 V4"/>' +
    '<path d="M8 8 L12 4 L16 8"/>' +
    '<path d="M4 16 V20 H20 V16"/>' +
    "</svg>";
  ld.appendChild(ldIc);
  const ldLbl = document.createElement("span");
  ldLbl.className = "opt-label";
  ldLbl.textContent = "Load artwork (.nekudot)";
  ld.appendChild(ldLbl);
  ld.addEventListener("click", (e) => {
    e.stopPropagation();
    opts.onLoadArtwork();
    popover.classList.remove("open");
  });
  popover.appendChild(ld);

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    popover.classList.toggle("open");
  });

  document.addEventListener("mousedown", (e) => {
    if (!popover.classList.contains("open")) return;
    if (wrap.contains(e.target as Node)) return;
    popover.classList.remove("open");
  });

  const toggle = () => popover.classList.toggle("open");
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

function makeSvgButton(
  svg: string,
  title: string,
  onClick?: () => void,
): HTMLElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  btn.title = title;
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

function makeColorSwatch(colors?: ColorControl): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "swatch-wrap";
  wrap.title = "Right-click to swap colors";

  const back = makeColorSlot("swatch-back", colors?.secondary);
  const front = makeColorSlot("swatch-front", colors?.main);

  wrap.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const a = back.getValue();
    const b = front.getValue();
    back.setValue(b);
    front.setValue(a);
  });

  wrap.appendChild(back.el);
  wrap.appendChild(front.el);
  return wrap;
}

type ColorSlotHandle = {
  el: HTMLElement;
  getValue: () => string;
  setValue: (v: string) => void;
};

function makeColorSlot(
  className: string,
  slot: ColorSlot | undefined,
): ColorSlotHandle {
  const el = document.createElement("span");
  el.className = className;
  const initial = slot?.initial ?? "#000000";
  el.style.background = initial;

  if (!slot) {
    return { el, getValue: () => initial, setValue: () => {} };
  }

  const input = document.createElement("input");
  input.type = "color";
  input.value = initial;
  input.className = "swatch-input";
  el.appendChild(input);

  el.addEventListener("click", (e) => {
    e.stopPropagation();
    input.click();
  });
  input.addEventListener("input", () => {
    el.style.background = input.value;
    slot.onChange(input.value);
  });

  return {
    el,
    getValue: () => input.value,
    setValue: (v) => {
      input.value = v;
      el.style.background = v;
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
): { pill: HTMLElement; setValue: (v: T) => void } {
  const pill = document.createElement("span");
  pill.className = "pill brush-pill";

  const iconEl = document.createElement("span");
  iconEl.className = "brush-icon";

  const labelEl = document.createElement("span");
  labelEl.className = "brush-label";

  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.textContent = "⌄";

  pill.appendChild(iconEl);
  pill.appendChild(labelEl);

  if (onBrushSettings) {
    pill.appendChild(makeGear("Brush settings", onBrushSettings));
  }

  pill.appendChild(chevron);

  const popover = document.createElement("div");
  popover.className = "brush-popover";
  pill.appendChild(popover);

  const optionEls = new Map<T, HTMLElement>();
  const flatOptions = flattenMenuEntries(entries);

  const setValue = (v: T) => {
    const opt = flatOptions.find((o) => o.value === v);
    if (!opt) return;
    setIcon(iconEl, opt.icon, "∿");
    labelEl.textContent = opt.label;
    for (const [k, el] of optionEls) {
      el.classList.toggle("active", k === v);
    }
  };

  const renderOption = (opt: MenuOption<T>, inGroup: boolean) => {
    const optEl = document.createElement("div");
    optEl.className = inGroup ? "brush-option in-group" : "brush-option";

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
      popover.classList.remove("open");
    });

    popover.appendChild(optEl);
    optionEls.set(opt.value, optEl);
  };

  for (const entry of entries) {
    if ("kind" in entry && entry.kind === "group") {
      const header = document.createElement("div");
      header.className = "brush-group-header";
      header.textContent = entry.label;
      popover.appendChild(header);
      for (const opt of entry.items) renderOption(opt, true);
    } else {
      renderOption(entry as MenuOption<T>, false);
    }
  }

  pill.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.closest(".brush-option")) {
      return;
    }
    popover.classList.toggle("open");
  });

  document.addEventListener("mousedown", (e) => {
    if (!popover.classList.contains("open")) return;
    if (pill.contains(e.target as Node)) return;
    popover.classList.remove("open");
  });

  setValue(initial);
  return { pill, setValue };
}

const GEAR_SVG =
  '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="3"/>' +
  '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' +
  "</svg>";

function makeGear(title: string, onClick: () => void): HTMLElement {
  const gear = document.createElement("span");
  gear.className = "brush-gear";
  gear.title = title;
  gear.innerHTML = GEAR_SVG;
  gear.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return gear;
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
function makeConnectingCombo(control: ConnectingControl): {
  el: HTMLElement;
  setValue: (v: string) => void;
  setVisible: (v: boolean) => void;
  setOptions: (groups: ConnectionOptionGroup[]) => void;
} {
  const pill = document.createElement("span");
  pill.className = "pill brush-pill connect-pill";

  const iconEl = document.createElement("span");
  iconEl.className = "brush-icon";

  const labelEl = document.createElement("span");
  labelEl.className = "brush-label";

  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.textContent = "⌄";

  pill.appendChild(iconEl);
  pill.appendChild(labelEl);
  pill.appendChild(makeGear("Connecting settings", control.onSettings));
  pill.appendChild(chevron);

  const popover = document.createElement("div");
  popover.className = "brush-popover";
  pill.appendChild(popover);

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
    pill.title = opt?.title ?? "";
    for (const [k, el] of optionEls) el.classList.toggle("active", k === v);
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
          b.innerHTML = icon;
          b.disabled = disabled;
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            popover.classList.remove("open");
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
        if (opt.title) optEl.title = opt.title;
        const optIcon = document.createElement("span");
        optIcon.className = "opt-icon";
        if (opt.icon) setIcon(optIcon, opt.icon, "");
        const optLabel = document.createElement("span");
        optLabel.className = "opt-label";
        optLabel.textContent = opt.label;
        optEl.append(optIcon, optLabel);
        // User presets get a delete (×).
        if (opt.custom && control.onDeleteCustom) {
          const del = document.createElement("button");
          del.type = "button";
          del.className = "opt-remove";
          del.textContent = "×";
          del.title = "Delete preset";
          del.addEventListener("click", (e) => {
            e.stopPropagation();
            control.onDeleteCustom?.(opt.value);
          });
          optEl.appendChild(del);
        }
        optEl.addEventListener("click", (e) => {
          e.stopPropagation();
          setValue(opt.value);
          control.onChange(opt.value);
          popover.classList.remove("open");
        });
        popover.appendChild(optEl);
        optionEls.set(opt.value, optEl);
      }
    }
    setValue(current); // refresh active highlight against the new list
  };

  pill.addEventListener("click", (e) => {
    if (e.target instanceof HTMLElement && e.target.closest(".brush-option")) {
      return;
    }
    popover.classList.toggle("open");
  });
  document.addEventListener("mousedown", (e) => {
    if (!popover.classList.contains("open")) return;
    if (pill.contains(e.target as Node)) return;
    popover.classList.remove("open");
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


function makeIconButton(
  glyph: string,
  title: string,
  onClick?: () => void,
): HTMLElement {
  const btn = document.createElement("button");
  btn.className = "icon-btn";
  btn.title = title;
  btn.textContent = glyph;
  if (onClick) btn.addEventListener("click", onClick);
  return btn;
}

const eraserIcon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M15 4 L20 9 L11 18 H6 V13 Z"/>' +
  '<path d="M9 18 H20"/>' +
  "</svg>";

function makeToolToggles(
  onChange?: (tool: Tool | null) => void,
): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "tool-toggles";

  let active: { btn: HTMLButtonElement; tool: Tool } | null = null;

  const makeToggle = (tool: Tool, title: string, icon: string): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-btn tool-toggle";
    btn.title = title;
    btn.innerHTML = icon;
    btn.addEventListener("click", () => {
      if (active?.btn === btn) {
        btn.classList.remove("active");
        active = null;
        onChange?.(null);
        return;
      }
      if (active) active.btn.classList.remove("active");
      btn.classList.add("active");
      active = { btn, tool };
      onChange?.(tool);
    });
    return btn;
  };

  wrap.appendChild(makeToggle("eraser", "Eraser", eraserIcon));
  return wrap;
}

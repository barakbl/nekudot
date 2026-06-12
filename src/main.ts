import "./styles.css";
import {
  BRUSH_DEFS,
  type BrushContext,
  type BrushDef,
} from "./brushes/registry";
import { SymmetryController } from "./symmetry/controller";
import { makeSymmetryProxy } from "./symmetry/proxy";
import { createSymmetryBox } from "./symmetry/box";
import { createMenu, type MenuEntry, type MenuGroup, type Theme } from "./menu";
import { bindShortcuts, createShortcutsPanel } from "./shortcuts";
import { createSettingsPanel } from "./settings-panel";
import { connectionGroups, hasConnection } from "./brushes/connections/registry";
import { DEFAULT_ART_STYLE } from "./brushes/round";
import { showConfirm, showError } from "./confirm";
import { loadArtworkFile, applyArtwork } from "./load-artwork";
import { LocalStorageStore } from "./store/local_storage";
import type { BrushBase } from "./base";
import { LayerManager } from "./layered/manager";
import { createLayersBox } from "./layered/box";
import { createMapsBox } from "./layered/maps-box";
import { createSizePicker } from "./layered/size-picker";
import { exportArt, shareArt } from "./export";
import { saveArtwork } from "./save-artwork";
import { pixelLog } from "./pixel-log";
import type { UndoSnapshot } from "./undo";
import { attachHelp } from "./help";
import { showChip } from "./chip";
import { registerWindow, showWindow } from "./window-stack";
import {
  clampSize,
  fullScreenSize,
  safeLoadSize,
  type CanvasSize,
} from "./canvas-size";
import { Overlay } from "./app/overlay";
import { createMapHighlighter } from "./app/map-highlight";
import { AppHistory } from "./app/history";
import { createMapsControl } from "./app/maps-control";
import { bindDrawingInput } from "./app/drawing-input";
import { createPresetsController } from "./app/presets";
import { buildAppShortcuts } from "./app/app-shortcuts";

const store = new LocalStorageStore();

const BORDER = 2;
const MAX_LAYERS = 5;
const MAX_UNDO = 10;
const CANVAS_SIZE_KEY = "app.canvas.size";

// ---- stage + canvas size ----------------------------------------------------

document.body.style.margin = "0";
document.body.style.overflow = "hidden";
document.body.style.minHeight = "100vh";
document.body.style.display = "flex";
document.body.style.alignItems = "center";
document.body.style.justifyContent = "center";

const dpr = window.devicePixelRatio || 1;
const screenMax = (): CanvasSize => ({
  width: Math.max(1, window.innerWidth - BORDER * 2),
  height: Math.max(1, window.innerHeight - BORDER * 2),
});

const persistedSize = safeLoadSize(store.get<unknown>(CANVAS_SIZE_KEY));
const initialCanvasSize: CanvasSize = (() => {
  const max = screenMax();
  return persistedSize
    ? clampSize(persistedSize, max.width, max.height)
    : fullScreenSize(max.width, max.height);
})();

const stage = document.createElement("div");
stage.className = "stage";
stage.style.position = "relative";
stage.style.border = `${BORDER}px solid #333`;
stage.style.touchAction = "none";
stage.style.cursor = "crosshair"; // drawing-app style precise cursor
document.body.appendChild(stage);

// Apply saved theme before any UI renders
const savedTheme = store.get<Theme>("app.theme") ?? "auto";
if (savedTheme !== "auto") {
  document.documentElement.dataset.theme = savedTheme;
}

// ---- layers + background ----------------------------------------------------

// Legacy migration: previously the canvas bg was stored under app.canvas.bg.
// If present, route it into the new LayersConfig.background defaults below.
const legacyBgColor = store.get<string>("app.canvas.bg");

const initialSize = Math.min(10, Math.max(1, store.get<number>("app.size") ?? 1));
const initialAlpha = store.get<number>("app.opacity") ?? 1;
const initialMainColor = store.get<string>("app.color.main") ?? "#000000";
const initialSecondaryColor =
  store.get<string>("app.color.secondary") ?? "#888888";

const layerManager = new LayerManager({
  container: stage,
  size: initialCanvasSize,
  dpr,
  maxLayers: MAX_LAYERS,
  store,
  rendererInit: {
    lineWidth: initialSize,
    strokeStyle: initialMainColor,
    globalAlpha: initialAlpha,
    lineCap: "round",
    lineJoin: "round",
  },
});

// Migrate the legacy app.canvas.bg color into the manager's background slot
// if the new schema field still holds its default (#fff).
if (legacyBgColor) {
  const cur = layerManager.getBackground();
  if (cur.color === "#ffffff") {
    layerManager.setBackground({ color: legacyBgColor }, { emit: false });
  }
  store.set("app.canvas.bg", undefined);
}

// CSS checkerboard shown wherever a transparent background needs to read as
// "no background" (the stage). Previews draw their own checker on canvas.
const CHECKER_CSS =
  "repeating-conic-gradient(#c8c8c8 0% 25%, #fff 0% 50%) 0 0 / 16px 16px";

const applyStageBackground = () => {
  const bg = layerManager.getBackground();
  stage.style.background = bg.transparent ? CHECKER_CSS : bg.color;
};
applyStageBackground();

// "transparent" sentinel when the background is off, so previews/flatten skip
// the fill. Also the background to flatten against for export/share (the
// export path treats "transparent" as no fill, keeping the PNG's alpha).
const backgroundColorForPreviews = (): string => {
  const bg = layerManager.getBackground();
  return bg.transparent ? "transparent" : bg.color;
};
const exportBackground = (): string => backgroundColorForPreviews();

// ---- overlays ----------------------------------------------------------------

// Transient overlay above all layer canvases — used by InvisibleBrush to
// briefly glow each newly-added pixel without leaving a permanent mark. The
// brush only ever talks to an IRenderer; the Overlay owns the canvas wiring.
const invisibleOverlay = new Overlay(stage, dpr, 9999, initialCanvasSize);

// Static overlay (one z-index below the invisible glow) that shows the symmetry
// guide lines (tile lattice / radial spokes / mirror line) while a symmetry mode
// is active. Visual help, not paint.
const symmetryOverlay = new Overlay(stage, dpr, 9998, initialCanvasSize, {
  hidden: true,
});

// Top-most flash of a neighbors map's dots, asked for by the Maps box/pill.
const highlightNeighborsMap = createMapHighlighter(stage, layerManager, dpr);

// ---- symmetry ------------------------------------------------------------------

// Symmetry (Tile / Radial / Mirror): a proxy around the LayerManager mirrors every mark
// and deposited point at the active mode's transforms, so any brush works under
// symmetry. When the mode is None it forwards untouched.
const symmetry = new SymmetryController(store);
const symmetryProxy = makeSymmetryProxy(
  layerManager,
  () => symmetry.transforms(),
  () => store.get<number>("app.opacity") ?? 1,
);

// Symmetry guide overlay: the tile lattice, radial spokes or mirror line, shown
// whenever a symmetry mode is active. Brush-independent — driven by the controller.
const updateSymmetryOverlay = () => {
  if (symmetry.active()) {
    symmetryOverlay.setVisible(true);
    symmetry.drawGuides(symmetryOverlay.renderer, symmetryOverlay.size);
  } else {
    symmetryOverlay.setVisible(false);
    symmetryOverlay.renderer.clear();
  }
};
symmetry.subscribe(updateSymmetryOverlay);
updateSymmetryOverlay();

// Both overlays track the canvas size (New art / Load artwork).
const resizeOverlays = (size: CanvasSize) => {
  invisibleOverlay.resize(size);
  symmetryOverlay.resize(size);
  updateSymmetryOverlay();
};

// ---- brushes --------------------------------------------------------------------

// Construct every registered brush from one shared context (see brushes/
// registry.ts — the single source of truth for brushes). The host is the
// LayerManager behind the symmetry proxy, so every mark and deposit mirrors.
const brushContext: BrushContext = {
  host: symmetryProxy,
  store,
  getInvisibleOverlay: () => invisibleOverlay.renderer,
};

const brushes: Record<string, BrushBase> = {};
for (const def of BRUSH_DEFS) brushes[def.name] = def.create(brushContext);
for (const b of Object.values(brushes)) {
  b.restore();
  b.attachPixelLog(pixelLog);
}

const storedBrushKey = store.get<string>("app.brush.selected");
const initialBrushKey: string =
  storedBrushKey && storedBrushKey in brushes ? storedBrushKey : "Round";
let brush: BrushBase = brushes[initialBrushKey];

// The connection art style is chosen from the navbar Connecting combo and
// persisted; Round applies it on select (see RoundBrush.onSelect).
let currentArtStyle = store.get<string>("app.artStyle") ?? DEFAULT_ART_STYLE;

// Registry groups → navbar combo option groups, flagging Custom rows (which get
// a delete ×). Rebuilt whenever the custom set changes.
const connectingComboGroups = () =>
  connectionGroups().map((g) => ({
    group: g.group,
    items: g.defs.map((d) => ({
      value: d.name,
      label: d.label,
      icon: d.icon,
      title: d.info,
      custom: g.group === "Custom",
    })),
  }));

// User-saved Custom connection presets (save/update/delete/import/export).
// The host accessors read lazily, so the controller can be wired into panels
// and the navbar that are built below.
const presets = createPresetsController({
  activeConnection: () => brush.activeConnection(),
  currentStyle: () => currentArtStyle,
  applyStyle: (name) => setArtStyle(name),
  defaultStyle: () => DEFAULT_ART_STYLE,
  strokeAlpha: () => store.get<number>("app.opacity") ?? 1,
  refreshMenu: () => menu.setConnectingOptions(connectingComboGroups()),
});

// ---- settings panels ----------------------------------------------------------

// The settings live in two boxes. The Brush box heads with the app-global size
// + opacity stroke controls (they used to be navbar pills), then the brush's
// own params.
const brushSettings = createSettingsPanel({
  scope: "brush",
  brushControls: {
    size: {
      get: () => store.get<number>("app.size") ?? initialSize,
      min: 1,
      max: 10,
      step: 1,
      onChange: (size) => {
        layerManager.setLineWidth(size);
        store.set("app.size", size);
      },
    },
    opacity: {
      get: () => store.get<number>("app.opacity") ?? initialAlpha,
      min: 0,
      max: 1,
      step: 0.05,
      onChange: (a) => {
        layerManager.setGlobalAlpha(a);
        store.set("app.opacity", a);
      },
    },
  },
});
document.body.appendChild(brushSettings.el);
registerWindow(brushSettings.el);

// The Connecting box holds the routing + art-style dials; it's opened from the
// navbar Connecting combo's gear (only Round connects).
const connectingSettings = createSettingsPanel({
  scope: "connecting",
  onSavePreset: () => presets.save(),
  onUpdatePreset: () => presets.update(),
  activeCustomName: () =>
    presets.isCustom(currentArtStyle) ? currentArtStyle : null,
});
document.body.appendChild(connectingSettings.el);
registerWindow(connectingSettings.el);

// The navbar buttons + keyboard shortcuts reveal a window and bring it to the
// front (rather than toggling it shut); each window closes via its × button.
const showSettings = () => showWindow(brushSettings.el);
const showConnecting = () => showWindow(connectingSettings.el);

// Render both boxes for the active brush and sync the Connecting combo's
// visibility + value. `menu` is defined below; this only runs after it exists.
const renderActiveBrush = () => {
  brushSettings.render(brush);
  connectingSettings.render(brush);
  const supports = brush.supportsConnecting();
  menu.setConnectingVisible(supports);
  if (supports) menu.setConnectingValue(currentArtStyle);
};

// Push the active brush's preferred stroke opacity (per connection style — see
// ConnectionSpec.strokeAlpha) to the renderer + Opacity slider. No-op for brushes
// that don't pin one. `force` overrides a saved opacity (used on style switch);
// at load we keep the saved value (which already equals the last style's).
const applyBrushStrokeOpacity = (force: boolean) => {
  if (!force && store.get<number>("app.opacity") !== undefined) return;
  const op = brush.getSelectOpacity();
  if (op === undefined) return;
  layerManager.setGlobalAlpha(op);
  store.set("app.opacity", op);
  brushSettings.render(brush); // reflect the new value in the Opacity slider
};

// Pick an art style from the combo: apply it to the active brush, match its
// Harmony stroke-line opacity, persist it, and refresh the Connecting box.
const setArtStyle = (name: string) => {
  currentArtStyle = name;
  store.set("app.artStyle", name);
  brush.applyArtStylePreset(name);
  applyBrushStrokeOpacity(true);
  connectingSettings.render(brush);
  menu.setConnectingValue(name);
};

// Keep the connecting "Connect to" / "Map" dropdowns in sync when layers or
// neighbors maps are renamed/added/removed. Only re-render while visible.
layerManager.subscribe(() => {
  if (connectingSettings.el.style.display !== "none")
    connectingSettings.render(brush);
  if (brushSettings.el.style.display !== "none") brushSettings.render(brush);
});

// ---- undo + paint persistence ---------------------------------------------------

const history = new AppHistory(layerManager, MAX_UNDO);
const undoManager = history.undoManager;
const pushUndo = (description: string) => history.push(description);
const persistPaint = () => history.persistPaint();

const activeLayerName = (): string =>
  layerManager.all[layerManager.activeIdx]?.config.name ?? "active layer";

const applyUndoSnapshot = async (snap: UndoSnapshot) => {
  layerManager.applyConfig(snap.config);
  await layerManager.applyPaintData(snap.paint);
  applyStageBackground();
  layersBox.refreshPreviews();
  persistPaint();
};

const doUndo = () => {
  const result = undoManager.undo();
  if (!result) return;
  applyUndoSnapshot(result.snap);
  if (result.action) showChip(`Undo: ${result.action}`);
};
const doRedo = () => {
  const result = undoManager.redo();
  if (!result) return;
  applyUndoSnapshot(result.snap);
  if (result.action) showChip(`Redo: ${result.action}`);
};

// ---- boxes: layers / symmetry / maps ----------------------------------------------

const layersBox = createLayersBox(
  layerManager,
  () => backgroundColorForPreviews(),
  (desc) => pushUndo(desc),
  () => {
    applyStageBackground();
    layersBox.refreshPreviews();
  },
);
document.body.appendChild(layersBox.el);
registerWindow(layersBox.el);

const symmetryBox = createSymmetryBox(symmetry);
document.body.appendChild(symmetryBox.el);
registerWindow(symmetryBox.el);

// The memory-maps editor, opened from the navbar Maps pill. Holds all the
// per-map controls; the pill shows the active map's live point count + a
// flash button (the name lives in its tooltips).
const mapsControl = createMapsControl(layerManager, highlightNeighborsMap, pushUndo);
const mapsBox = createMapsBox(mapsControl);
document.body.appendChild(mapsBox.el);
registerWindow(mapsBox.el);

// Show helpers for the boxes created above (see showSettings/showConnecting).
const showLayers = () => showWindow(layersBox.el);
const showSymmetry = () => showWindow(symmetryBox.el);
const showMaps = () => {
  showWindow(mapsBox.el);
  mapsBox.render(); // fresh dot counts each time it opens
};

// Async-restore paint state + undo stack from IDB on startup.
(async () => {
  const paintSnap = await history.loadPaint();
  if (paintSnap) {
    await layerManager.applyPaintData(paintSnap);
    layersBox.refreshPreviews();
  }
  await pixelLog.init();
  await undoManager.init();
  if (undoManager.isEmpty()) {
    pushUndo("Initial state");
  }
})();

// ---- new art / delete canvas / load artwork ------------------------------------

// Shared by Delete canvas + New art: clear every brush's state, reset the
// connecting style + routing to the defaults, and wipe the pixel log.
const resetArtState = () => {
  for (const b of Object.values(brushes)) {
    b.clear();
    b.applyArtStylePreset(DEFAULT_ART_STYLE);
    b.applyRoutingPreset("classic"); // standard routing: selected map, mode "both"
  }
  currentArtStyle = DEFAULT_ART_STYLE;
  store.set("app.artStyle", currentArtStyle);
  void pixelLog.clear();
  renderActiveBrush();
};

const loadFileInput = document.createElement("input");
loadFileInput.type = "file";
loadFileInput.accept = ".nekudot,application/zip";
loadFileInput.style.display = "none";
document.body.appendChild(loadFileInput);

loadFileInput.addEventListener("change", async () => {
  const file = loadFileInput.files?.[0];
  loadFileInput.value = ""; // allow re-picking the same file later
  if (!file) return;

  const result = await loadArtworkFile(file);
  if (!result.ok) {
    showError(result.error);
    return;
  }
  try {
    await applyArtwork(layerManager, pixelLog, result.artwork);
  } catch (e) {
    console.error("applyArtwork failed", e);
    showError("Failed to apply the loaded artwork.");
    return;
  }

  const { size } = result.artwork;
  resizeOverlays(size);
  applyStageBackground();
  layersBox.refreshPreviews();
  renderActiveBrush();
  store.set(CANVAS_SIZE_KEY, size);
  persistPaint();
  undoManager.clear();
  pushUndo("Load artwork");
  showChip("Artwork loaded");
});

const promptLoadArtwork = () => {
  showConfirm({
    title: "Discard current work?",
    message: "Loading artwork will replace all current layers.",
    confirmLabel: "Choose file",
    destructive: true,
    onConfirm: () => loadFileInput.click(),
  });
};

const sizePicker = createSizePicker({
  getScreenMax: screenMax,
  initialManual: layerManager.currentSize,
  onUpload: promptLoadArtwork,
  onConfirm: (size) => {
    showConfirm({
      title: "Discard current work?",
      message: "Creating a new art will erase all layers.",
      confirmLabel: "Create",
      destructive: true,
      onConfirm: () => {
        layerManager.reset(size);
        resizeOverlays(size);
        resetArtState();
        store.set(CANVAS_SIZE_KEY, size);
        persistPaint();
        undoManager.clear();
        pushUndo("New art");
      },
    });
  },
});
document.body.appendChild(sizePicker.el);

// ---- export / share / theme -------------------------------------------------------

const exportImageFn = () => {
  exportArt(layerManager, {
    backgroundColor: exportBackground(),
    prefix: "art",
  });
};

const shareImageFn = async () => {
  const res = await shareArt(layerManager, {
    backgroundColor: exportBackground(),
    prefix: "nekudot",
  });
  if (res === "downloaded")
    showChip("Image saved + caption copied — attach it to share");
  else if (res === "empty") showChip("Nothing to share yet");
};

const applyTheme = (theme: Theme) => {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
};

const canvasMenuOptions = {
  initialTheme: savedTheme,
  onThemeChange: (t: Theme) => {
    applyTheme(t);
    store.set("app.theme", t);
  },
  onShareImage: shareImageFn,
  onExportImage: exportImageFn,
  onSaveArtwork: () => {
    saveArtwork(layerManager).catch((err) => {
      console.error("saveArtwork failed", err);
    });
  },
  onLoadArtwork: promptLoadArtwork,
};

// ---- brush selection + navbar -----------------------------------------------------

const selectBrush = (key: string) => {
  brush = brushes[key];
  menu.setBrushValue(key);
  // The Eraser paints in erase mode; every other brush draws normally.
  layerManager.setEraseMode(brush.erases());
  // Let the brush apply its art style, then push its stroke opacity to the nav.
  brush.onSelect();
  // Brushes that don't pin an opacity paint fully opaque. The `?? 1` also resets
  // the slider after a style like Shading drove it to 0 — otherwise the next
  // brush would inherit 0 and paint nothing.
  const op = brush.getSelectOpacity() ?? 1;
  layerManager.setGlobalAlpha(op);
  store.set("app.opacity", op);
  // renderActiveBrush re-renders both boxes (reading the live opacity) and syncs
  // the navbar Connecting combo's visibility + value for this brush.
  renderActiveBrush();
  store.set("app.brush.selected", key);
};

// Late-bound: the Shortcuts panel is built from the shortcuts array, which
// itself needs `menu`. The Windows menu + "/" call this once it's wired.
let showShortcuts = () => {};

// Turn the brush registry into the toolbar's menu entries: consecutive brushes
// sharing a menuGroup are wrapped into that sub-group; the rest are top-level.
function buildBrushMenu(defs: BrushDef[]): MenuEntry<string>[] {
  const out: MenuEntry<string>[] = [];
  let group: MenuGroup<string> | null = null;
  for (const d of defs) {
    const opt = { value: d.name, label: d.name, icon: d.icon, shortcut: d.shortcut };
    if (d.menuGroup) {
      if (!group || group.label !== d.menuGroup) {
        group = { kind: "group", label: d.menuGroup, items: [] };
        out.push(group);
      }
      group.items.push(opt);
    } else {
      group = null;
      out.push(opt);
    }
  }
  return out;
}

const menu = createMenu(
  buildBrushMenu(BRUSH_DEFS),
  (key) => selectBrush(key),
  [
    {
      label: "Delete canvas",
      icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M3 6 h18"/>
        <path d="M8 6 V4 a2 2 0 0 1 2 -2 h4 a2 2 0 0 1 2 2 v2"/>
        <path d="M19 6 l-1 14 a2 2 0 0 1 -2 2 H8 a2 2 0 0 1 -2 -2 L5 6"/>
        <path d="M10 11 v6 M14 11 v6"/>
      </svg>`,
      onClick: () => {
        showConfirm({
          title: "Delete canvas?",
          message: "This wipes all layers and resets to a single layer.",
          confirmLabel: "Delete",
          destructive: true,
          onConfirm: () => {
            layerManager.reset(layerManager.currentSize);
            resetArtState();
            persistPaint();
            pushUndo("Delete canvas");
          },
        });
      },
    },
    {
      label: "New art",
      icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 3 H14 L19 8 V21 H6 Z"/>
        <path d="M14 3 V8 H19"/>
        <path d="M12 12 V18"/>
        <path d="M9 15 H15"/>
      </svg>`,
      onClick: () => sizePicker.open(),
    },
  ],
  {
    main: {
      initial: initialMainColor,
      onChange: (c) => {
        layerManager.setStrokeStyle(c);
        store.set("app.color.main", c);
      },
    },
    secondary: {
      initial: initialSecondaryColor,
      onChange: (c) => {
        store.set("app.color.secondary", c);
      },
    },
  },
  initialBrushKey,
  showSettings,
  canvasMenuOptions,
  {
    onUndo: () => doUndo(),
    onRedo: () => doRedo(),
    canUndo: () => undoManager.canUndo(),
    canRedo: () => undoManager.canRedo(),
  },
  [
    { label: "Brushes", shortcut: "b", open: showSettings },
    { label: "Connecting", shortcut: "c", open: showConnecting },
    { label: "Layers", shortcut: "l", open: showLayers },
    { label: "Maps", shortcut: "m", open: showMaps },
    { label: "Symmetry", shortcut: "y", open: showSymmetry },
    { label: "Shortcuts", shortcut: "/", open: () => showShortcuts() },
  ],
  {
    groups: connectingComboGroups(),
    initial: currentArtStyle,
    onChange: (name) => setArtStyle(name),
    onSettings: () => showConnecting(),
    onDeleteCustom: (name) => presets.remove(name),
    onImport: () => presets.import(),
    onExport: () => presets.export(),
  },
  {
    getActiveInfo: () => {
      const { maps } = mapsControl.getInfo();
      const active = maps.find((m) => m.active);
      return { name: active?.name ?? "Map", dots: active?.dots ?? 0 };
    },
    onFlashActive: () => highlightNeighborsMap(layerManager.selectedNeighborsMapIdx),
    onOpen: () => showMaps(),
    subscribe: (fn) => layerManager.subscribe(fn),
  },
);
undoManager.subscribe(() => menu.refreshHistoryState());
document.body.appendChild(menu.el);

// Ensure the only connecting brush starts on the persisted art style, then draw
// both boxes and sync the navbar Connecting combo. Apply the style's stroke-line
// opacity on first load (selectBrush() does this on later switches) so the main
// line doesn't paint opaque over the connecting web — the cause of the canvas
// darkening far faster than Harmony.
// Custom presets load async (below), so a persisted custom name isn't known yet
// — fall back to the default until presets.restore() brings it back.
brushes["Round"]?.applyArtStylePreset(
  hasConnection(currentArtStyle) ? currentArtStyle : DEFAULT_ART_STYLE,
);
// Apply the persisted brush's own onSelect (art style) + erase mode. The initial
// brush is assigned directly, not through selectBrush, so do it here. Round is
// already handled above with the custom-preset-safe guard, so skip its (unguarded)
// onSelect to avoid touching a custom style that hasn't loaded yet.
if (brush !== brushes["Round"]) brush.onSelect();
layerManager.setEraseMode(brush.erases());
applyBrushStrokeOpacity(false);
renderActiveBrush();

// Custom presets load async from IDB; once back, a persisted custom art style
// can actually be applied (the fallback above covered the gap).
void presets.restore().then((loaded) => {
  if (loaded && hasConnection(currentArtStyle)) setArtStyle(currentArtStyle);
});

// ---- panels visibility + shortcuts --------------------------------------------------

const shortcuts = buildAppShortcuts({
  // Lazy: the Shortcuts panel below is itself built from this table. The list
  // leads with the navbar — the default restore state shows only it.
  panels: () => [
    menu.el,
    brushSettings.el,
    connectingSettings.el,
    layersBox.el,
    symmetryBox.el,
    mapsBox.el,
    shortcutsPanel.el,
  ],
  showMaps,
  showLayers,
  showSymmetry,
  showSettings,
  showConnecting,
  toggleCanvasMenu: () => menu.toggleCanvasMenu(),
  showShortcuts: () => showShortcuts(),
  selectBrush,
  undo: doUndo,
  redo: doRedo,
});
const shortcutsPanel = createShortcutsPanel(shortcuts);
document.body.appendChild(shortcutsPanel.el);
registerWindow(shortcutsPanel.el);
showShortcuts = () => showWindow(shortcutsPanel.el);
bindShortcuts(shortcuts);

// ---- help hints (press ? to toggle visibility) ---------------------------------------

const attachToHeading = (panel: HTMLElement, text: string) => {
  const h = panel.querySelector("h3");
  if (h instanceof HTMLElement) attachHelp(h, text);
};
attachToHeading(
  layersBox.el,
  "Drawing layers. Each layer holds its own canvas plus its connections sub-layers; the active layer is the target for strokes and connection drawings.",
);
attachToHeading(
  brushSettings.el,
  "Settings for the currently selected brush: its size, opacity and brush-specific options.",
);
attachToHeading(
  connectingSettings.el,
  "How the Round brush weaves its connecting web: where it connects (routing) and the art-style dials. Pick a preset from the navbar Connecting combo.",
);
attachToHeading(
  symmetryBox.el,
  "Repeat every stroke with symmetry: Tile repeats your marks across a lattice, Radial mirrors them around the centre (kaleidoscope), Mirror reflects across one line. Works with any brush.",
);
attachToHeading(
  mapsBox.el,
  "Memory maps remember sets of points so the Round brush can connect to them. Pick the active map (drawn into now), flash any map to see its dots on the canvas, or rename/add/delete maps.",
);

// ---- drawing input ----------------------------------------------------------------------

bindDrawingInput({
  stage,
  brush: () => brush,
  symmetry,
  layerManager,
  onStrokeEnd: (b) => {
    layersBox.refreshPreviews();
    // A stroke may have added points to the active map; refresh the maps box
    // and the navbar pill's point count (strokes add pixels directly without
    // an emit, so neither would otherwise update).
    mapsBox.render();
    menu.refreshMapsPill();
    persistPaint();
    pushUndo(`${b.name()} stroke on ${activeLayerName()}`);
  },
});

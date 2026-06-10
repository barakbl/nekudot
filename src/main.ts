import "./styles.css";
import {
  BRUSH_DEFS,
  type BrushContext,
  type BrushDef,
} from "./brushes/registry";
import { SymmetryController } from "./symmetry/controller";
import { makeSymmetryProxy } from "./symmetry/proxy";
import { createSymmetryBox } from "./symmetry/box";
import { CanvasRenderer, type IRenderer } from "./renderer";
import { createMenu, type MenuEntry, type MenuGroup } from "./menu";
import {
  bindShortcuts,
  createShortcutsPanel,
  type Shortcut,
} from "./shortcuts";
import { createSettingsPanel } from "./settings-panel";
import {
  connectionGroups,
  setCustomPresets,
  hasConnection,
} from "./brushes/connections/registry";
import {
  loadCustomPresets,
  saveCustomPresets,
} from "./brushes/connections/custom-store";
import {
  parsePresetFile,
  downloadPresets,
} from "./brushes/connections/preset-io";
import type { ConnectionSpec } from "./brushes/connections/base";
import { DEFAULT_ART_STYLE } from "./brushes/round";
import { type Theme } from "./menu";
import { showConfirm, showError, showPrompt, showChecklist } from "./confirm";
import { loadArtworkFile, applyArtwork } from "./load-artwork";
import { LocalStorageStore } from "./store/local_storage";
import type { BrushBase } from "./base";
import { LayerManager } from "./layered/manager";
import { createLayersBox } from "./layered/box";
import { createMapsBox, type MapsControl } from "./layered/maps-box";
import { createSizePicker } from "./layered/size-picker";
import { exportArt, shareArt } from "./export";
import { saveArtwork } from "./save-artwork";
import { PaintStore } from "./store/paint";
import { pixelLog } from "./pixel-log";
import { UndoStore } from "./store/undo";
import { UndoManager, type UndoSnapshot } from "./undo";
import { attachHelp, toggleHelpMode } from "./help";
import { showChip } from "./chip";
import {
  clampSize,
  fullScreenSize,
  safeLoadSize,
  type CanvasSize,
} from "./canvas-size";

const store = new LocalStorageStore();

const BORDER = 2;
const MAX_LAYERS = 5;
const MAX_UNDO = 10;
const CANVAS_SIZE_KEY = "app.canvas.size";

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

// Legacy migration: previously the canvas bg was stored under app.canvas.bg.
// If present, route it into the new LayersConfig.background defaults below.
const legacyBgColor = store.get<string>("app.canvas.bg");

const initialSize = Math.min(10, Math.max(1, store.get<number>("app.size") ?? 1));
const initialAlpha = store.get<number>("app.opacity") ?? 1;
let currentMainColor = store.get<string>("app.color.main") ?? "#000000";
const initialMainColor = currentMainColor;
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
// the fill (the export path already treats "transparent" as no fill).
const backgroundColorForPreviews = (): string => {
  const bg = layerManager.getBackground();
  return bg.transparent ? "transparent" : bg.color;
};

// Background to flatten against for export/share: a real colour, or the
// "transparent" sentinel so the PNG keeps an alpha channel.
const exportBackground = (): string => backgroundColorForPreviews();

// Transient overlay above all layer canvases — used by InvisibleBrush to
// briefly glow each newly-added pixel without leaving a permanent mark.
// The brush only ever talks to an IRenderer; this module owns the actual
// canvas/context wiring and rebuilds the renderer when the canvas resizes.
const invisibleOverlay = document.createElement("canvas");
invisibleOverlay.style.position = "absolute";
invisibleOverlay.style.left = "0";
invisibleOverlay.style.top = "0";
invisibleOverlay.style.pointerEvents = "none";
invisibleOverlay.style.zIndex = "9999";

const makeOverlayRenderer = (): IRenderer => {
  const ctx = invisibleOverlay.getContext("2d");
  if (!ctx) throw new Error("invisibleOverlay: failed to get 2d context");
  return new CanvasRenderer(ctx, { dpr });
};

let invisibleOverlayRenderer: IRenderer;
const resizeInvisibleOverlay = (size: CanvasSize) => {
  invisibleOverlay.width = Math.round(size.width * dpr);
  invisibleOverlay.height = Math.round(size.height * dpr);
  invisibleOverlay.style.width = `${size.width}px`;
  invisibleOverlay.style.height = `${size.height}px`;
  // Re-init the renderer: writing canvas.width resets the ctx transform,
  // so the dpr scale set in CanvasRenderer's constructor needs reapplying.
  invisibleOverlayRenderer = makeOverlayRenderer();
};
resizeInvisibleOverlay(initialCanvasSize);
stage.appendChild(invisibleOverlay);

// Static overlay (one z-index below the invisible glow) that shows the symmetry
// guide lines (tile lattice / radial spokes / mirror line) while a symmetry mode
// is active. Visual help, not paint.
const symmetryOverlay = document.createElement("canvas");
symmetryOverlay.style.position = "absolute";
symmetryOverlay.style.left = "0";
symmetryOverlay.style.top = "0";
symmetryOverlay.style.pointerEvents = "none";
symmetryOverlay.style.zIndex = "9998";
symmetryOverlay.style.display = "none";

const makeSymmetryOverlayRenderer = (): IRenderer => {
  const ctx = symmetryOverlay.getContext("2d");
  if (!ctx) throw new Error("symmetryOverlay: failed to get 2d context");
  return new CanvasRenderer(ctx, { dpr });
};

let symmetryOverlayRenderer: IRenderer;
let symmetryOverlayCssSize: CanvasSize = initialCanvasSize;
const resizeSymmetryOverlay = (size: CanvasSize) => {
  symmetryOverlay.width = Math.round(size.width * dpr);
  symmetryOverlay.height = Math.round(size.height * dpr);
  symmetryOverlay.style.width = `${size.width}px`;
  symmetryOverlay.style.height = `${size.height}px`;
  symmetryOverlayCssSize = size;
  symmetryOverlayRenderer = makeSymmetryOverlayRenderer();
};
resizeSymmetryOverlay(initialCanvasSize);
stage.appendChild(symmetryOverlay);

// Transient highlight overlay (top-most): when the Maps box asks, it flashes a
// neighbors map's pixels over the canvas for a couple of seconds — thicker,
// glowing dots that pulse, then fade. Sized on demand to the live canvas.
const highlightOverlay = document.createElement("canvas");
highlightOverlay.style.position = "absolute";
highlightOverlay.style.left = "0";
highlightOverlay.style.top = "0";
highlightOverlay.style.pointerEvents = "none";
highlightOverlay.style.zIndex = "10000";
stage.appendChild(highlightOverlay);

let highlightToken = 0; // bump to cancel any in-flight flash
const HIGHLIGHT_COLOR = "#22d3ee"; // cyan accent — reads on light + dark
const highlightNeighborsMap = (index: number) => {
  const nm = layerManager.allNeighborsMaps[index];
  const ctx = highlightOverlay.getContext("2d");
  if (!nm || !ctx) return;
  const pts = nm.finder.allPixels();
  const size = layerManager.currentSize;
  highlightOverlay.width = Math.round(size.width * dpr);
  highlightOverlay.height = Math.round(size.height * dpr);
  highlightOverlay.style.width = `${size.width}px`;
  highlightOverlay.style.height = `${size.height}px`;

  // Pre-render the glowing dots once at full strength; the loop only flickers
  // overall opacity (cheap even for thousands of points).
  const off = document.createElement("canvas");
  off.width = highlightOverlay.width;
  off.height = highlightOverlay.height;
  const octx = off.getContext("2d");
  if (octx) {
    octx.scale(dpr, dpr);
    octx.fillStyle = HIGHLIGHT_COLOR;
    octx.shadowColor = HIGHLIGHT_COLOR;
    octx.shadowBlur = 6;
    for (const p of pts) {
      octx.beginPath();
      octx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      octx.fill();
    }
  }

  const token = ++highlightToken;
  const DURATION = 2500;
  const start = performance.now();
  const clear = () => ctx.clearRect(0, 0, highlightOverlay.width, highlightOverlay.height);
  const frame = (now: number) => {
    if (token !== highlightToken) return; // a newer flash took over
    const t = (now - start) / DURATION;
    if (t >= 1) {
      clear();
      return;
    }
    const fadeIn = Math.min(1, t / 0.08);
    const fadeOut = t > 0.7 ? (1 - t) / 0.3 : 1;
    const flicker = 0.55 + 0.45 * Math.sin(t * Math.PI * 10); // ~5 pulses
    clear();
    ctx.globalAlpha = Math.max(0, 0.75 * fadeIn * fadeOut * flicker);
    ctx.drawImage(off, 0, 0);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

// Symmetry (Tile / Radial / Mirror): a proxy around the LayerManager mirrors every mark
// and deposited point at the active mode's transforms, so any brush works under
// symmetry. When the mode is None it forwards untouched.
const symmetry = new SymmetryController(store);
const symmetryProxy = makeSymmetryProxy(
  layerManager,
  () => symmetry.transforms(),
  () => store.get<number>("app.opacity") ?? 1,
);

// Construct every registered brush from one shared context (see brushes/
// registry.ts — the single source of truth for brushes).
const brushContext: BrushContext = {
  renderer: symmetryProxy,
  finder: symmetryProxy,
  store,
  getInvisibleOverlay: () => invisibleOverlayRenderer,
};
// Symmetry guide overlay: the tile lattice, radial spokes or mirror line, shown whenever a
// symmetry mode is active. Brush-independent — driven by the controller. Defined
// here (after the overlay + controller exist) so the resize handlers can call it.
const updateSymmetryOverlay = () => {
  if (symmetry.active()) {
    symmetryOverlay.style.display = "";
    symmetry.drawGuides(symmetryOverlayRenderer, symmetryOverlayCssSize);
  } else {
    symmetryOverlay.style.display = "none";
    symmetryOverlayRenderer.clear();
  }
};
symmetry.subscribe(updateSymmetryOverlay);
updateSymmetryOverlay();

const brushes: Record<string, BrushBase> = {};
for (const def of BRUSH_DEFS) brushes[def.name] = def.create(brushContext);
type BrushKey = string;
for (const b of Object.values(brushes)) {
  b.restore();
  b.attachPixelLog(pixelLog);
}

const storedBrushKey = store.get<string>("app.brush.selected");
const initialBrushKey: BrushKey =
  storedBrushKey && storedBrushKey in brushes ? storedBrushKey : "Round";
let brush: BrushBase = brushes[initialBrushKey];

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

// The Connecting box holds the routing + art-style dials; it's opened from the
// navbar Connecting combo's gear (only Round connects).
const connectingSettings = createSettingsPanel({
  scope: "connecting",
  onSavePreset: () => savePresetFn(),
  onUpdatePreset: () => updatePresetFn(),
  activeCustomName: () =>
    customPresets.some((s) => s.name === currentArtStyle) ? currentArtStyle : null,
});
document.body.appendChild(connectingSettings.el);

const toggleSettings = () => {
  brushSettings.el.style.display =
    brushSettings.el.style.display === "none" ? "" : "none";
};
const toggleConnecting = () => {
  connectingSettings.el.style.display =
    connectingSettings.el.style.display === "none" ? "" : "none";
};

// The connection art style is chosen from the navbar Connecting combo and
// persisted; Round applies it on select (see RoundBrush.onSelect).
let currentArtStyle = store.get<string>("app.artStyle") ?? DEFAULT_ART_STYLE;

// User-saved Custom connection presets — the source of truth here, mirrored into
// the registry (createConnection/combo) and persisted to IndexedDB. Loaded async.
let customPresets: ConnectionSpec[] = [];

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

// Late-bound: these handlers need `menu` + setArtStyle (defined below).
let savePresetFn: () => void = () => {};
let updatePresetFn: () => void = () => {};
let deleteCustomFn: (name: string) => void = () => {};
let importPresetsFn: () => void = () => {};
let exportPresetsFn: () => void = () => {};

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

const paintStore = new PaintStore();
const undoStore = new UndoStore<{
  stack: UndoSnapshot[];
  pointer: number;
}>();
const undoManager = new UndoManager(undoStore, MAX_UNDO);

const captureUndoSnapshot = async (
  description: string,
): Promise<UndoSnapshot> => {
  const paint = await layerManager.getPaintData();
  return { config: layerManager.getConfig(), paint, description };
};

let pushChain: Promise<unknown> = Promise.resolve();
const pushUndo = (description: string) => {
  const pending = captureUndoSnapshot(description);
  pushChain = pushChain.then(async () => {
    undoManager.push(await pending);
  });
};

const activeLayerName = (): string =>
  layerManager.all[layerManager.activeIdx]?.config.name ?? "active layer";

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

const symmetryBox = createSymmetryBox(symmetry);
document.body.appendChild(symmetryBox.el);

// The memory-maps editor, opened from the navbar Maps pill. Holds all the
// per-map controls (flash / select / rename / delete + live dot counts); the
// pill only shows the active map's name + a flash button.
const mapsControl: MapsControl = {
  getInfo: () => {
    const activeIdx = layerManager.selectedNeighborsMapIdx;
    return {
      maps: layerManager.allNeighborsMaps.map((m, i) => ({
        name: m.config.name,
        dots: m.finder.livePixelCount(),
        active: i === activeIdx,
      })),
    };
  },
  onFlashActive: () => highlightNeighborsMap(layerManager.selectedNeighborsMapIdx),
  onFlashMap: (i) => highlightNeighborsMap(i),
  onAddMap: () => {
    const nm = layerManager.addNeighborsMap(); // made active by the manager
    pushUndo(`Add ${nm.config.name}`);
  },
  onRenameMap: (i, name) => {
    const prev = layerManager.allNeighborsMaps[i]?.config.name;
    layerManager.setNeighborsMapName(i, name); // no-op if blank/unchanged
    if (prev && layerManager.allNeighborsMaps[i]?.config.name !== prev)
      pushUndo(`Rename ${prev} → ${name}`);
  },
  onSelectMap: (i) => {
    layerManager.selectNeighborsMap(i); // not an undo step
    const name = layerManager.allNeighborsMaps[i]?.config.name ?? "map";
    showChip(`Selected “${name}”`);
    highlightNeighborsMap(i); // flash it so the choice is visible
  },
  onDeleteMap: (i) => {
    const name = layerManager.allNeighborsMaps[i]?.config.name ?? "map";
    showConfirm({
      title: "Delete map?",
      message: `Delete the “${name}” map and the points it remembers?`,
      confirmLabel: "Delete",
      destructive: true,
      onConfirm: () => {
        if (layerManager.removeNeighborsMap(i)) {
          showChip(`Deleted “${name}”`);
          pushUndo(`Delete ${name}`);
        }
      },
    });
  },
  subscribe: (fn) => layerManager.subscribe(fn),
};
const mapsBox = createMapsBox(mapsControl);
document.body.appendChild(mapsBox.el);

const applyUndoSnapshot = async (snap: UndoSnapshot) => {
  layerManager.applyConfig(snap.config);
  await layerManager.applyPaintData(snap.paint);
  applyStageBackground();
  layersBox.refreshPreviews();
  persistPaint();
};

// Async-restore paint state + undo stack from IDB on startup.
(async () => {
  const paintSnap = await paintStore.load();
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

const persistPaint = () => {
  layerManager.getPaintData().then((snap) => paintStore.save(snap));
};

// ---- Load artwork (.nekudot) -----------------------------------------------
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
  resizeInvisibleOverlay(size);
  resizeSymmetryOverlay(size);
  updateSymmetryOverlay();
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
        resizeInvisibleOverlay(size);
        resizeSymmetryOverlay(size);
        updateSymmetryOverlay();
        for (const b of Object.values(brushes)) {
          b.clear();
          b.applyConnectingPreset("classic");
        }
        currentArtStyle = DEFAULT_ART_STYLE;
        store.set("app.artStyle", currentArtStyle);
        void pixelLog.clear();
        renderActiveBrush();
        store.set(CANVAS_SIZE_KEY, size);
        persistPaint();
        undoManager.clear();
        pushUndo("New art");
      },
    });
  },
});
document.body.appendChild(sizePicker.el);

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

const applyTheme = (theme: "auto" | "light" | "dark") => {
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

// Fired after a brush switch. Symmetry guides don't depend on the brush, so
// there's nothing brush-specific to redraw here now.
const onBrushChanged = () => {};

const selectBrush = (key: BrushKey) => {
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
  onBrushChanged();
};

// Late-bound: the Shortcuts panel is built from the shortcuts array, which
// itself needs `menu`. The Windows menu + "/" call this once it's wired.
let toggleShortcuts = () => {};

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
  (key) => {
    brush = brushes[key];
    // The Eraser paints in erase mode; every other brush draws normally.
    layerManager.setEraseMode(brush.erases());
    brush.onSelect();
    // `?? 1`: brushes without a pinned opacity paint opaque, and this resets the
    // slider after Shading (strokeAlpha 0) so the next brush isn't invisible.
    const op = brush.getSelectOpacity() ?? 1;
    layerManager.setGlobalAlpha(op);
    store.set("app.opacity", op);
    renderActiveBrush();
    store.set("app.brush.selected", key);
    onBrushChanged();
  },
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
            for (const b of Object.values(brushes)) {
              b.clear();
              b.applyConnectingPreset("classic");
            }
            currentArtStyle = DEFAULT_ART_STYLE;
            store.set("app.artStyle", currentArtStyle);
            void pixelLog.clear();
            renderActiveBrush();
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
        currentMainColor = c;
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
  toggleSettings,
  canvasMenuOptions,
  {
    onUndo: () => doUndo(),
    onRedo: () => doRedo(),
    canUndo: () => undoManager.canUndo(),
    canRedo: () => undoManager.canRedo(),
  },
  [
    { label: "Brushes", shortcut: "b", toggle: toggleSettings },
    { label: "Connecting", shortcut: "c", toggle: toggleConnecting },
    { label: "Layers", shortcut: "l", toggle: layersBox.toggle },
    { label: "Maps", shortcut: "m", toggle: mapsBox.toggle },
    { label: "Symmetry", shortcut: "y", toggle: symmetryBox.toggle },
    { label: "Shortcuts", shortcut: "/", toggle: () => toggleShortcuts() },
  ],
  {
    groups: connectingComboGroups(),
    initial: currentArtStyle,
    onChange: (name) => setArtStyle(name),
    onSettings: () => toggleConnecting(),
    onDeleteCustom: (name) => deleteCustomFn(name),
    onImport: () => importPresetsFn(),
    onExport: () => exportPresetsFn(),
  },
  {
    getActiveName: () => {
      const { maps } = mapsControl.getInfo();
      return maps.find((m) => m.active)?.name ?? "Map";
    },
    onFlashActive: () => highlightNeighborsMap(layerManager.selectedNeighborsMapIdx),
    onOpen: () => mapsBox.toggle(),
    subscribe: (fn) => layerManager.subscribe(fn),
  },
);
undoManager.subscribe(() => menu.refreshHistoryState());

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
document.body.appendChild(menu.el);
// Ensure the only connecting brush starts on the persisted art style, then draw
// both boxes and sync the navbar Connecting combo. Apply the style's stroke-line
// opacity on first load (selectBrush() does this on later switches) so the main
// line doesn't paint opaque over the connecting web — the cause of the canvas
// darkening far faster than Harmony.
// Custom presets load async (below), so a persisted custom name isn't known yet
// — fall back to the default until loadCustomPresets() restores it.
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
onBrushChanged();

// --- custom connection presets: save / delete / load ------------------------
savePresetFn = () => {
  const conn = brush.activeConnection();
  if (!conn) return;
  // Branching off an active custom preset suggests "<name> copy" so it won't clash.
  const active = customPresets.find((s) => s.name === currentArtStyle);
  showPrompt({
    title: "Save connection preset",
    placeholder: "Preset name",
    initial: active ? `${active.name} copy` : "",
    confirmLabel: "Save",
    onConfirm: (name) => {
      // Capture the dials + the current main-line opacity (the slider value).
      const strokeAlpha = store.get<number>("app.opacity") ?? 1;
      const spec = conn.toCustomSpec(name, strokeAlpha);
      customPresets = [...customPresets.filter((s) => s.name !== name), spec]; // overwrite by name
      setCustomPresets(customPresets);
      void saveCustomPresets(customPresets);
      menu.setConnectingOptions(connectingComboGroups());
      setArtStyle(name); // apply + select the new preset
      showChip(`Saved preset “${name}”`);
    },
  });
};

updatePresetFn = () => {
  const conn = brush.activeConnection();
  const name = currentArtStyle;
  if (!conn || !customPresets.some((s) => s.name === name)) return;
  const strokeAlpha = store.get<number>("app.opacity") ?? 1;
  const spec = conn.toCustomSpec(name, strokeAlpha);
  customPresets = customPresets.map((s) => (s.name === name ? spec : s)); // overwrite in place
  setCustomPresets(customPresets);
  void saveCustomPresets(customPresets);
  menu.setConnectingOptions(connectingComboGroups());
  showChip(`Updated preset “${name}”`);
};

deleteCustomFn = (name: string) => {
  customPresets = customPresets.filter((s) => s.name !== name);
  setCustomPresets(customPresets);
  void saveCustomPresets(customPresets);
  menu.setConnectingOptions(connectingComboGroups());
  if (currentArtStyle === name) setArtStyle(DEFAULT_ART_STYLE);
  showChip(`Deleted preset “${name}”`);
};

importPresetsFn = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".preset,application/json";
  input.style.display = "none";
  document.body.appendChild(input); // connected so the file chooser opens reliably
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    const res = parsePresetFile(await file.text()); // zod-validated, all-or-nothing
    if (!res.ok) {
      showError(res.error, "Couldn't import presets");
      return;
    }
    // Merge into the current set, overwriting any with the same name.
    const byName = new Map(customPresets.map((s) => [s.name, s]));
    for (const p of res.presets) byName.set(p.name, p);
    customPresets = [...byName.values()];
    setCustomPresets(customPresets);
    void saveCustomPresets(customPresets);
    menu.setConnectingOptions(connectingComboGroups());
    const n = res.presets.length;
    showChip(`Imported ${n} preset${n === 1 ? "" : "s"}`);
  });
  input.click();
};

exportPresetsFn = () => {
  if (!customPresets.length) return;
  showChecklist({
    title: "Export presets",
    message: "Choose which custom presets to export.",
    confirmLabel: "Export",
    items: customPresets.map((s) => ({ id: s.name, label: s.name, checked: true })),
    onConfirm: (ids) => {
      const chosen = customPresets.filter((s) => ids.includes(s.name));
      if (!chosen.length) return;
      downloadPresets(chosen);
      showChip(`Exported ${chosen.length} preset${chosen.length === 1 ? "" : "s"}`);
    },
  });
};

void loadCustomPresets().then((loaded) => {
  if (!loaded.length) return;
  customPresets = loaded;
  setCustomPresets(customPresets);
  menu.setConnectingOptions(connectingComboGroups());
  if (hasConnection(currentArtStyle)) setArtStyle(currentArtStyle);
});

let savedPanelState: boolean[] | null = null;

// Shared by the `h` key and the 4-finger swipe-up gesture. Hides every panel
// (remembering which were open) or restores them; flashes a hint when hiding.
const toggleAllPanels = (source: "key" | "touch") => {
  const panels = [
    menu.el,
    brushSettings.el,
    connectingSettings.el,
    layersBox.el,
    symmetryBox.el,
    mapsBox.el,
    shortcutsPanel.el,
  ];
  const isVisible = (el: HTMLElement) => el.style.display !== "none";
  if (panels.some(isVisible)) {
    savedPanelState = panels.map(isVisible);
    for (const el of panels) el.style.display = "none";
    showChip(
      source === "touch"
        ? "Menus hidden · 4-finger swipe up to show"
        : "Menus hidden · press H to show",
    );
  } else {
    const restore = savedPanelState ?? [true, false, false, false, false, false, false];
    panels.forEach((el, i) => {
      el.style.display = restore[i] ? "" : "none";
    });
    savedPanelState = null;
  }
};

const shortcuts: Shortcut[] = [
  {
    key: "h",
    group: "Panels",
    description: "Hide/show all panels",
    onPress: () => toggleAllPanels("key"),
  },
  {
    key: "m",
    group: "Panels",
    description: "Toggle the maps box",
    onPress: mapsBox.toggle,
  },
  {
    key: "l",
    group: "Panels",
    description: "Toggle layers",
    onPress: layersBox.toggle,
  },
  {
    key: "y",
    group: "Panels",
    description: "Toggle symmetry",
    onPress: symmetryBox.toggle,
  },
  {
    key: "b",
    group: "Panels",
    description: "Toggle brush settings",
    onPress: toggleSettings,
  },
  {
    key: "c",
    group: "Panels",
    description: "Toggle connecting settings",
    onPress: toggleConnecting,
  },
  {
    key: "s",
    group: "Panels",
    description: "Toggle more menu",
    onPress: () => menu.toggleCanvasMenu(),
  },
  {
    key: "/",
    group: "Help",
    description: "Show shortcuts",
    onPress: () => toggleShortcuts(),
  },
  {
    key: "?",
    group: "Help",
    description: "Toggle help hints",
    onPress: () => toggleHelpMode(),
  },
  // Brush hotkeys, generated from the registry (e.g. shortcut "1" → Digit1).
  ...BRUSH_DEFS.filter((d) => d.shortcut).map((d) => ({
    code: `Digit${d.shortcut}`,
    shift: false,
    label: d.shortcut as string,
    group: "Brushes",
    description: `${d.name} brush`,
    onPress: () => selectBrush(d.name),
  })),
  {
    key: "z",
    cmdOrCtrl: true,
    shift: false,
    label: "Z",
    group: "Edit",
    description: "Undo",
    onPress: () => doUndo(),
  },
  {
    key: "z",
    cmdOrCtrl: true,
    shift: true,
    label: "Z",
    group: "Edit",
    description: "Redo",
    onPress: () => doRedo(),
  },
  {
    fingers: 2,
    group: "Edit",
    description: "Undo",
    onPress: () => doUndo(),
  },
  {
    fingers: 3,
    group: "Edit",
    description: "Redo",
    onPress: () => doRedo(),
  },
  {
    fingers: 4,
    swipe: "up",
    group: "Panels",
    description: "Hide/show all panels",
    onPress: () => toggleAllPanels("touch"),
  },
];
const shortcutsPanel = createShortcutsPanel(shortcuts);
document.body.appendChild(shortcutsPanel.el);
toggleShortcuts = shortcutsPanel.toggle;
bindShortcuts(shortcuts);

// --- Help hints (press ? to toggle visibility) ---
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

let drawingId: number | null = null;

stage.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  stage.setPointerCapture(e.pointerId);
  drawingId = e.pointerId;
  // Freeze the symmetry transforms for this stroke (Tile anchored to the start,
  // Radial/Mirror centred on the canvas) before any mark is drawn.
  symmetry.beginStroke(e.offsetX, e.offsetY, layerManager.currentSize);
  // Buffer the continuous line (Round) so a faint stroke composites as one
  // uniform alpha instead of dotting at the sample joints. Must start before the
  // first segment is drawn. Skipped under symmetry so each copy keeps its own
  // fade (the buffer would flatten them to one alpha).
  if (brush.bufferedStroke() && !symmetry.active()) layerManager.beginStroke();
  brush.strokeStart(e.offsetX, e.offsetY);
  brush.stroke(e.offsetX, e.offsetY);
});

stage.addEventListener("pointermove", (e) => {
  if (e.pointerId !== drawingId) return;
  const evs = e.getCoalescedEvents();
  const list = evs.length ? evs : [e];
  // Connecting brushes weave the web once per frame (the last coalesced sample),
  // matching Harmony's per-move model. Feeding every coalesced sub-sample to the
  // web made it build up ~quadratically with the pointer's report rate (fast
  // pens/trackpads emit many sub-samples per frame). The visible mark still
  // draws through every sub-sample, so the line stays smooth; non-connecting
  // brushes deposit every sample as before.
  const frameCadence = brush.supportsConnecting();
  for (let i = 0; i < list.length; i++) {
    const ev = list[i];
    brush.stroke(ev.offsetX, ev.offsetY, !frameCadence || i === list.length - 1);
  }
});

const end = (e: PointerEvent) => {
  if (e.pointerId !== drawingId) return;
  drawingId = null;
  brush.strokeEnd();
  // Commit the buffered line onto the active layer (one uniform-alpha composite)
  // before previews/persist read the layer. (Matches the pointerdown guard.)
  if (brush.bufferedStroke() && !symmetry.active()) layerManager.endStroke();
  layersBox.refreshPreviews();
  // A stroke may have added points to the active map; refresh the maps box so
  // its live dot counts reflect them (strokes add pixels directly without an
  // emit, so the box wouldn't otherwise update while open).
  mapsBox.render();
  persistPaint();
  pushUndo(`${brush.name()} stroke on ${activeLayerName()}`);
};

stage.addEventListener("pointerup", end);
stage.addEventListener("pointercancel", end);

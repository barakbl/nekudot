import "./styles.css";
import {
  BRUSH_DEFS,
  type BrushContext,
  type BrushDef,
} from "./brushes/registry";
import { SymmetryController, type SymmetryMode } from "./symmetry/controller";
import { makeSymmetryProxy } from "./symmetry/proxy";
import { createSymmetryBox } from "./symmetry/box";
import { SYMMETRY_MODES } from "./symmetry/menu-section";
import { createMenu, type MenuEntry, type MenuGroup } from "./menu";
import { startClipRecording, notifyClipStrokeStart } from "./clip/record-flow";
import { bindShortcuts, createShortcutsPanel } from "./shortcuts";
import { createSettingsPanel, buildRoutingControls } from "./settings-panel";
import { createBrushPreview } from "./brush-preview";
import { connectionGroups, hasConnection } from "./brushes/connections/registry";
import { saveCustomPresets } from "./brushes/connections/custom-store";
import { resetToDefault as runReset } from "./app/reset";
import { DEFAULT_ART_STYLE } from "./brushes/round";
import { showConfirm, showError, showTypedConfirm } from "./confirm";
import { loadArtworkFile, applyArtwork } from "./load-artwork";
import { LocalStorageStore } from "./store/local_storage";
import type { BrushBase } from "./base";
import { LayerManager } from "./layered/manager";
import { createLayersBox } from "./layered/box";
import { createMapsBox } from "./layered/maps-box";
import { createSizePicker } from "./layered/size-picker";
import { saveArtwork } from "./save-artwork";
import { pixelLog } from "./pixel-log";
import { showChip } from "./chip";
import { registerWindow, showWindow } from "./window-stack";
import { createPalettePanel } from "./colors/panel";
import { clearColorsStore, loadGradientPalettes } from "./colors/store";
import { setGradientPalettes, setGradientSpace } from "./brushes/color-source";
import { fullScreenSize, squareOfScreen } from "./canvas-size";
import { Viewport } from "./app/viewport";
import { bindTouchGestures } from "./app/touch-gestures";
import { bindImagePaste } from "./app/image-paste";
import { createAppSettingsBox } from "./app/app-settings-box";
import { setDiagnostics, dlog } from "./diagnostics";
import { AppHistory } from "./app/history";
import { createMapsControl } from "./app/maps-control";
import { bindDrawingInput } from "./app/drawing-input";
import { opacityStorageKey, recalledOpacity } from "./app/opacity-store";
import { createPresetsController } from "./app/presets";
import { buildAppShortcuts } from "./app/app-shortcuts";
import { registerHelpHints } from "./app/help-hints";
import { bindDurability } from "./app/durability";
import { createStage } from "./app/stage";
import { createExportActions, applyTheme } from "./app/export-actions";
import { bindCameraInput } from "./app/camera-input";
import { createDrawingCore } from "./app/drawing-core";
import { createUndoWiring } from "./app/undo-wiring";
import { createOnboarding, shouldShowOnboarding } from "./onboarding/onboarding";
import {
  applyConnectionColor,
  mandalaConnectionColor,
} from "./onboarding/connection-color";

const store = new LocalStorageStore();

const MAX_LAYERS = 5;
const MAX_UNDO = 10;

// ---- stage + canvas size ----------------------------------------------------

const {
  viewportEl,
  stage,
  dpr,
  screenMax,
  initialCanvasSize,
  CANVAS_SIZE_KEY,
  savedTheme,
} = createStage({ store });

// ---- layers + background ----------------------------------------------------

// Legacy migration: previously the canvas bg was stored under app.canvas.bg.
// If present, route it into the new LayersConfig.background defaults below.
const legacyBgColor = store.get<string>("app.canvas.bg");

// Default stroke width (1–10); the value Reset returns Size to.
const DEFAULT_BRUSH_SIZE = 1;
const initialSize = Math.min(
  10,
  Math.max(1, store.get<number>("app.size") ?? DEFAULT_BRUSH_SIZE),
);
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

// ---- viewport (pan / zoom / rotate camera over the stage) -------------------
// Fires after every camera change; wired below once its dependents exist (the
// image-paste preview re-renders here so its handles stay a constant on-screen
// size while the image itself tracks the camera via the CSS transform).
let onViewportChange = () => {};
const viewport = new Viewport({
  viewportEl,
  stageEl: stage,
  getCanvasSize: () => layerManager.currentSize,
  onChange: () => onViewportChange(),
});
viewport.reset(); // 100% centred, or fit if the canvas is bigger than the window
bindCameraInput({ viewportEl, viewport });

// "transparent" sentinel when the background is off, so previews/flatten skip
// the fill. Also the background to flatten against for export/share (the
// export path treats "transparent" as no fill, keeping the PNG's alpha).
const backgroundColorForPreviews = (): string => {
  const bg = layerManager.getBackground();
  return bg.transparent ? "transparent" : bg.color;
};
const exportBackground = (): string => backgroundColorForPreviews();

// Start a GIF recording (menu item + the "r" shortcut). Arms now; capture
// begins on the first stroke (see clip/record-flow).
const recordClip = () =>
  startClipRecording({
    manager: layerManager,
    getBackgroundColor: exportBackground,
    container: viewportEl,
  });

// ---- overlays + symmetry ----------------------------------------------------

// Symmetry (Tile / Radial / Mirror): the controller owns the active mode + guide
// settings; the proxy (below) mirrors every mark and deposited point at the
// active mode's transforms, so any brush works under symmetry. Constructed
// before the overlays, which read the controller to draw their guides.
const symmetry = new SymmetryController(store);

// On-stage overlays (the invisible-brush glow, the symmetry guides, the map-dot
// highlight), the symmetry-guide wiring, and the new-canvas resize/reframe.
const { invisibleOverlay, mapHighlighter, applyNewCanvasSize } = createDrawingCore(
  {
    stage,
    dpr,
    initialCanvasSize,
    layerManager,
    store,
    symmetry,
    viewport,
  },
);

// The symmetry proxy wraps the LayerManager as the brushes' host (mode None
// forwards untouched). Kept in main so it's constructed right before the brush
// loop that consumes it.
const symmetryProxy = makeSymmetryProxy(
  layerManager,
  () => symmetry.transforms(),
  () => store.get<number>("app.opacity") ?? 1,
  () => symmetry.mirrorsPoints(),
);

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
// Live "active tool" state. The first field of an app-state container that the
// scattered top-level `let`s are migrating onto, so the many panels reading the
// active brush share one source of truth. selectBrush is the only writer.
type AppState = { brush: BrushBase };
const appState: AppState = { brush: brushes[initialBrushKey] };

// The connection art style is chosen from the navbar Connecting combo and
// persisted; Round applies it on select (see RoundBrush.onSelect).
let currentArtStyle = store.get<string>("app.artStyle") ?? DEFAULT_ART_STYLE;

// Pen support (pressure/tilt modulation + the Pen settings section). Toggled
// from the More menu; default on. When off, a stylus draws like a mouse (the
// drawing input feeds neutral samples) and the Pen section is hidden.
let penEnabled = store.get<boolean>("app.penEnabled") ?? true;

// Pixel log writing (the "Pixel log" app setting). Off by default - it is for
// future features and otherwise just grows storage (see pixel-log.ts).
let pixelLogEnabled = store.get<boolean>("app.pixelLog") ?? false;
pixelLog.setEnabled(pixelLogEnabled);

// Brush settings preview: a big window (Preview button in the settings panel)
// with a Playground tab (draw freely) and a Preview tab that replays a scripted
// stroke whenever a setting changes. Both run a THROWAWAY brush of the current
// type, configured from the store (restore + selectArtStyle) so they mirror the
// live brush at its real Size / Opacity / colour, without touching the artwork.
const brushPreview = createBrushPreview({
  makeBrush: (host) => {
    const def = BRUSH_DEFS.find((d) => d.name === appState.brush.name());
    if (!def) return null;
    const b = def.create({ host, store, getInvisibleOverlay: () => host });
    b.restore();
    if (b.supportsConnecting()) {
      b.selectArtStyle(currentArtStyle);
      // The preview ignores map routing (map-only / map+stroke): always weave to
      // both the stroke and the (single) cloud so the web always shows.
      b.applyRoutingPreset("classic");
    }
    return b;
  },
  size: () => store.get<number>("app.size") ?? initialSize,
  alpha: () => store.get<number>("app.opacity") ?? initialAlpha,
  color: () => store.get<string>("app.color.main") ?? initialMainColor,
  background: () => {
    const bg = layerManager.getBackground();
    return bg.transparent ? "#ffffff" : bg.color;
  },
  dpr,
  store,
  registerWindow,
  showWindow,
});

// Opt-in field diagnostics (App settings -> Diagnostics). Enabled early so it
// captures startup errors + an environment snapshot on a reload where it's on.
let diagnosticsEnabled = store.get<boolean>("app.diag") ?? false;
setDiagnostics(diagnosticsEnabled);

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
  activeConnection: () => appState.brush.activeConnection(),
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
// One settings window with Brush + Connecting tabs (the Connecting tab shows
// only for brushes that connect). The Reset button reverts the active brush +
// its art style to defaults.
// Remembered stroke opacity, scoped per (brush, art-style) for connecting brushes
// and per brush otherwise (see opacity-store.ts). `app.opacity` stays the live
// applied value (the renderer + symmetry proxy read it); these just persist +
// recall the per-context value so switching brush/style no longer clobbers it.
const opacityKey = () =>
  opacityStorageKey(appState.brush.name(), appState.brush.supportsConnecting(), currentArtStyle);
const recallOpacity = () =>
  recalledOpacity(store.get<number>(opacityKey()), appState.brush.getSelectOpacity());

const settingsPanel = createSettingsPanel({
  showPen: () => penEnabled,
  onOpenPreview: () => brushPreview.open(),
  onSettingChange: (change) => brushPreview.onSettingChanged(change),
  brushControls: {
    size: {
      get: () => store.get<number>("app.size") ?? initialSize,
      min: 1,
      max: 10,
      step: 1,
      onChange: (size) => {
        layerManager.setLineWidth(size);
        store.set("app.size", size);
        brushPreview.onSettingChanged({
          label: "Size",
          value: String(size),
          help: "How thick the brush's own line is.",
        });
      },
    },
    opacity: {
      get: () => store.get<number>("app.opacity") ?? initialAlpha,
      min: 0,
      max: 1,
      step: 0.05,
      onChange: (a) => {
        layerManager.setGlobalAlpha(a);
        store.set("app.opacity", a); // live applied value
        store.set(opacityKey(), a); // remembered per (brush, art-style)
        brushPreview.onSettingChanged({
          label: "Opacity",
          value: String(a),
          help: "How see-through the stroke is - low values let many overlapping lines build into soft shading.",
        });
      },
    },
  },
  onSavePreset: () => presets.save(),
  onUpdatePreset: () => presets.update(),
  activeCustomName: () =>
    presets.isCustom(currentArtStyle) ? currentArtStyle : null,
  onReset: () => {
    appState.brush.resetSettings(); // brush params + art-style dials
    // Size + opacity are app-global (not part of getSettings), so reset them
    // here: Size to the default, opacity to the brush's preferred value — same
    // as a fresh brush selection (getSelectOpacity ?? 1).
    layerManager.setLineWidth(DEFAULT_BRUSH_SIZE);
    store.set("app.size", DEFAULT_BRUSH_SIZE);
    store.set(opacityKey(), undefined); // forget the remembered opacity for this context
    const op = recallOpacity(); // -> the style's default (strokeAlpha) or 1
    layerManager.setGlobalAlpha(op);
    store.set("app.opacity", op);
    renderActiveBrush();
    brushPreview.onSettingChanged({
      label: "Reset",
      value: "Brush & web to defaults",
      help: "Both the brush settings and the connection art style were returned to their defaults.",
    });
  },
});
document.body.appendChild(settingsPanel.el);
registerWindow(settingsPanel.el);

// The navbar buttons + keyboard shortcuts reveal the window on the right tab
// and bring it to the front (rather than toggling it shut); it closes via its
// × button.
const showSettings = () => {
  settingsPanel.showTab("brush");
  showWindow(settingsPanel.el);
};
const showConnecting = () => {
  settingsPanel.showTab("connecting");
  showWindow(settingsPanel.el);
};

// Render the settings window for the active brush and sync the Connecting
// combo's visibility + value. `menu` is defined below; this only runs after it
// exists.
const renderActiveBrush = () => {
  settingsPanel.render(appState.brush);
  mapsBox.render(); // the routing "Connection" group tracks the active brush
  const supports = appState.brush.supportsConnecting();
  menu.setConnectingVisible(supports);
  if (supports) menu.setConnectingValue(currentArtStyle);
};

// Re-render the open settings window so the Primary/Secondary swatches in the
// Color / Fill selects track the toolbar colours as they change.
const refreshSettingsColors = () => {
  if (settingsPanel.el.style.display !== "none") settingsPanel.render(appState.brush);
};

// Push the active brush's preferred stroke opacity (per connection style — see
// ConnectionSpec.strokeAlpha) to the renderer + Opacity slider. No-op for brushes
// that don't pin one. `force` overrides a saved opacity (used on style switch);
// at load we keep the saved value (which already equals the last style's).
const applyBrushStrokeOpacity = (force: boolean) => {
  if (!force && store.get<number>("app.opacity") !== undefined) return;
  // Recall this (brush, style)'s remembered opacity, falling back to the style's
  // preferred opacity. No-op for brushes with neither (non-connecting on a fresh
  // store), so a plain mouse stroke stays fully opaque.
  if (store.get<number>(opacityKey()) === undefined && appState.brush.getSelectOpacity() === undefined)
    return;
  const op = recallOpacity();
  layerManager.setGlobalAlpha(op);
  store.set("app.opacity", op);
  settingsPanel.render(appState.brush); // reflect the new value in the Opacity slider
};

// Pick an art style from the combo: apply it to the active brush, match its
// Harmony stroke-line opacity, persist it, and refresh the settings window.
const setArtStyle = (name: string) => {
  currentArtStyle = name;
  store.set("app.artStyle", name);
  appState.brush.selectArtStyle(name); // apply + restore this brush's saved dials for it
  applyBrushStrokeOpacity(true);
  settingsPanel.render(appState.brush);
  menu.setConnectingValue(name);
};

// Keep the connecting "Connect to" / "Map" dropdowns in sync when layers or
// neighbors maps are renamed/added/removed. Only re-render while visible.
layerManager.subscribe(() => {
  if (settingsPanel.el.style.display !== "none") settingsPanel.render(appState.brush);
});

// ---- undo + paint persistence ---------------------------------------------------

// AppHistory (the undo stack + paint snapshot) stays here, with its
// init/clear/subscribe below; createUndoWiring owns the thin action wrappers.
// layersBox is read lazily - it's created just below this block.
const history = new AppHistory(layerManager, MAX_UNDO);
const { pushUndo, activeLayerName, doUndo, doRedo } = createUndoWiring({
  history,
  layerManager,
  applyStageBackground,
  getLayersBox: () => layersBox,
});

// ---- boxes: layers / symmetry / maps ----------------------------------------------

const layersBox = createLayersBox(
  layerManager,
  () => backgroundColorForPreviews(),
  (desc) => pushUndo(desc),
  () => {
    applyStageBackground();
    layersBox.refreshPreviews();
  },
  (req) => palettePanel.open(req), // background swatch opens the colour palette
);
document.body.appendChild(layersBox.el);
registerWindow(layersBox.el);

const symmetryBox = createSymmetryBox(symmetry);
document.body.appendChild(symmetryBox.el);
registerWindow(symmetryBox.el);

// The memory-maps editor, opened from the navbar Maps pill. Holds all the
// per-map controls; the pill shows the active map's live point count + a
// flash button (the name lives in its tooltips).
const mapsControl = createMapsControl(
  layerManager,
  mapHighlighter.flash,
  pushUndo,
  () => mapHighlighter.getColor(),
  // Open the colour picker by the swatch; recolour the dots, persist, and update
  // the box's swatch. palettePanel/mapsBox exist by the time this runs (on click).
  (anchor) =>
    palettePanel.open({
      title: "Highlight color",
      anchor,
      getColor: () => mapHighlighter.getColor(),
      onPick: (hex) => {
        mapHighlighter.setColor(hex);
        store.set("app.maps.highlightColor", hex);
        mapsBox.render();
      },
    }),
);
// The routing "Connection" group lives in the Maps box now; build it for the
// current brush (re-read on each render, so it tracks the active brush + maps).
const mapsBox = createMapsBox(mapsControl, (rerender) =>
  buildRoutingControls(appState.brush, rerender),
);
document.body.appendChild(mapsBox.el);
registerWindow(mapsBox.el);

// Show helpers for the boxes created above (see showSettings/showConnecting).
const showLayers = () => showWindow(layersBox.el);
const showSymmetry = () => showWindow(symmetryBox.el);
const showMaps = () => {
  showWindow(mapsBox.el);
  mapsBox.render(); // fresh dot counts each time it opens
};

// Async-restore paint state + undo stack from IDB on startup. Called here
// (during module evaluation) so it's first in the history queue — a stroke
// finished while the load is still running queues behind it.
void history.init(async (paintSnap) => {
  if (paintSnap) {
    await layerManager.applyPaintData(paintSnap);
    layersBox.refreshPreviews();
  }
});
// Deliberately OUTSIDE the history queue: the log's IDB open can stall
// indefinitely (version upgrade blocked by an old tab), and anything awaited
// inside the queue's first op would deadlock every undo/push behind it.
// Ordering is safe — the store is append-only, so a stroke flushed before
// this load completes is simply included in what it returns.
void pixelLog.init();

// ---- new art / delete canvas / load artwork ------------------------------------

// New / cleared canvas: clear CONTENT only - every brush's remembered point cloud
// + the pixel log - and reset routing to the safe default (the canvas's maps are
// fresh, so point at the selected map). The connection art style + dials are
// tools, not content, so they PERSIST across a new canvas like brush / size /
// opacity / colour. Used by New art + Delete canvas.
const clearArtContent = () => {
  for (const b of Object.values(brushes)) {
    b.clear();
    b.applyRoutingPreset("classic"); // routing follows the canvas
  }
  void pixelLog.clear();
  renderActiveBrush();
};

// Content clear PLUS reverting the connecting look to defaults. Used only by the
// guided onboarding starts (mandala / blank), where a known default look is the
// intent - NOT by New art / Delete canvas, which keep the user's tools.
const resetArtState = () => {
  clearArtContent();
  for (const b of Object.values(brushes)) b.resetArtStyle(DEFAULT_ART_STYLE);
  currentArtStyle = DEFAULT_ART_STYLE;
  store.set("app.artStyle", currentArtStyle);
  renderActiveBrush();
};

const loadFileInput = document.createElement("input");
loadFileInput.type = "file";
loadFileInput.accept = ".nekudot,application/zip";
loadFileInput.style.display = "none";
document.body.appendChild(loadFileInput);

// Parse + apply a .nekudot file onto the canvas (shared by the file picker and
// the onboarding "open a saved piece" cards).
const loadArtwork = async (file: File): Promise<void> => {
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
  applyNewCanvasSize(size);
  applyStageBackground();
  layersBox.refreshPreviews();
  renderActiveBrush();
  store.set(CANVAS_SIZE_KEY, size);
  void history.clear();
  pushUndo("Load artwork"); // also persists the loaded paint (the new pointer row)
  showChip("Artwork loaded");
};

loadFileInput.addEventListener("change", async () => {
  const file = loadFileInput.files?.[0];
  loadFileInput.value = ""; // allow re-picking the same file later
  if (file) await loadArtwork(file);
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
        applyNewCanvasSize(size);
        clearArtContent(); // new canvas clears content; keeps connection tools
        store.set(CANVAS_SIZE_KEY, size);
        void history.clear();
        pushUndo("New art");
      },
    });
  },
});
document.body.appendChild(sizePicker.el);

// ---- export / share / theme -------------------------------------------------------

const { exportImage, shareImage } = createExportActions({
  layerManager,
  exportBackground,
  showChip,
});

const canvasMenuOptions = {
  onShareImage: shareImage,
  onExportImage: exportImage,
  onRecordClip: recordClip,
  onSaveArtwork: () => {
    saveArtwork(layerManager).catch((err) => {
      console.error("saveArtwork failed", err);
    });
  },
  onLoadArtwork: promptLoadArtwork,
};

// The global Application settings panel (theme / input / advanced) - the
// app-wide counterpart to the per-brush settings panel. Theme + pen pressure
// moved here from the More menu.
// Gradient blend space (OKLCH "smooth" vs classic sRGB). Default on; applied to
// the colour-source module here and toggled from App settings.
let smoothGradients = store.get<boolean>("app.gradient.oklch") ?? true;
setGradientSpace(smoothGradients ? "oklch" : "srgb");

const appSettingsBox = createAppSettingsBox({
  theme: {
    initial: savedTheme,
    onChange: (t) => {
      applyTheme(t);
      store.set("app.theme", t);
    },
  },
  smoothGradients,
  onToggleSmoothGradients: (on) => {
    smoothGradients = on;
    store.set("app.gradient.oklch", on);
    setGradientSpace(on ? "oklch" : "srgb");
    refreshSettingsColors(); // regenerate the Color dial swatches in the new space
  },
  penEnabled,
  onTogglePen: (on) => {
    penEnabled = on;
    store.set("app.penEnabled", on);
    settingsPanel.render(appState.brush); // show/hide the Pen section live
  },
  pixelLog: pixelLogEnabled,
  onTogglePixelLog: (on) => {
    pixelLogEnabled = on;
    store.set("app.pixelLog", on);
    pixelLog.setEnabled(on);
  },
  diagnostics: diagnosticsEnabled,
  onToggleDiagnostics: (on) => {
    diagnosticsEnabled = on;
    store.set("app.diag", on);
    setDiagnostics(on);
    if (on) {
      // A one-shot snapshot of the current drawing state for context.
      const bg = layerManager.getBackground();
      dlog("app", "state", {
        brush: appState.brush.name(),
        opacity: store.get<number>("app.opacity") ?? 1,
        size: store.get<number>("app.size"),
        main: store.get<string>("app.color.main"),
        secondary: store.get<string>("app.color.secondary"),
        theme: store.get<string>("app.theme") ?? "auto",
        penEnabled,
        background: bg.transparent ? "transparent" : bg.color,
        canvas: `${layerManager.currentSize.width}x${layerManager.currentSize.height}`,
      });
    }
  },
  onResetToDefault: () => {
    showTypedConfirm({
      title: "Reset to default?",
      message:
        'This permanently deletes all settings, layers and saved artwork on this device, then reloads the app. Type "yes" to confirm.',
      requireText: "yes",
      placeholder: "Type yes",
      confirmLabel: "Reset everything",
      onConfirm: () => void resetToDefault(),
    });
  },
});

// Wipe every local data store + settings, then reload to the fresh (onboarding)
// app. See src/app/reset.ts for the orchestration (and its tests).
const resetToDefault = () =>
  runReset({
    clearers: [
      () => history.clear(), // undo stack + paint snapshot (what boot restores)
      () => pixelLog.clear(),
      () => saveCustomPresets([]), // custom connection presets
      () => clearColorsStore(), // palettes + seeded flag, so gradients re-onboard
    ],
    storage: localStorage,
    reload: () => location.reload(),
  });
document.body.appendChild(appSettingsBox.el);
registerWindow(appSettingsBox.el);
const showAppSettings = () => showWindow(appSettingsBox.el);

// ---- brush selection + navbar -----------------------------------------------------

const selectBrush = (key: string) => {
  appState.brush = brushes[key];
  menu.setBrushValue(key);
  // The Eraser paints in erase mode; every other brush draws normally.
  layerManager.setEraseMode(appState.brush.erases());
  // Let the brush apply its art style, then push its stroke opacity to the nav.
  appState.brush.onSelect();
  // Recall the opacity this brush/style was last left at (remembered per context),
  // else the style's preferred opacity, else fully opaque - so switching brushes
  // no longer wipes a manual opacity, and Shading still starts at 0 by default.
  const op = recallOpacity();
  layerManager.setGlobalAlpha(op);
  store.set("app.opacity", op);
  // renderActiveBrush re-renders both boxes (reading the live opacity) and syncs
  // the navbar Connecting combo's visibility + value for this brush.
  renderActiveBrush();
  store.set("app.brush.selected", key);
  dlog("brush", "select", { key, opacity: op, erases: appState.brush.erases() });
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

// The colour palette popover. It's target-agnostic: each opener supplies a
// request (title + anchor + getColor + onPick) and the popover pops up next to the
// anchor and auto-closes on pick. The toolbar swatches drive Primary/Secondary via
// the menu setters (same onChange path as the swatch); the Layers box uses it for
// the background colour (see createLayersBox below).
// Feed the activated gradient palettes into the connection Color dial (replacing
// the old hard-coded sunset/ocean/neon/fire), and refresh the open settings so
// the dial reflects them. Runs at startup and whenever a Gradient toggle changes.
const refreshConnectionGradients = () => {
  void loadGradientPalettes().then((gradients) => {
    setGradientPalettes(
      gradients.map((p) => ({ id: p.id, label: p.name, colors: p.colors })),
    );
    refreshSettingsColors();
  });
};

const palettePanel = createPalettePanel({
  onGradientsChanged: refreshConnectionGradients,
  smoothGradients: () => smoothGradients,
});
document.body.appendChild(palettePanel.el);
refreshConnectionGradients();

// Open the palette as a picker for a toolbar slot (Primary/Secondary), next to the
// clicked swatch.
const openColorPalette = (target: "main" | "secondary", anchor: HTMLElement) =>
  palettePanel.open({
    title: target === "main" ? "Primary color" : "Secondary color",
    anchor,
    getColor: () =>
      store.get<string>(`app.color.${target}`) ??
      (target === "main" ? "#000000" : "#888888"),
    onPick: (hex) =>
      target === "main" ? menu.setMainColor(hex) : menu.setSecondaryColor(hex),
  });

const menu = createMenu(
  buildBrushMenu(BRUSH_DEFS),
  (key) => selectBrush(key),
  [
    {
      label: "Delete canvas",
      className: "nav-action-delete", // hidden on small screens (see styles.css)
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
            clearArtContent(); // delete canvas clears content; keeps connection tools
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
    {
      // Reset the camera to the normal view: no zoom, no rotation, canvas
      // centred (or fit if it's bigger than the window). The one control for
      // the pan/zoom/rotate camera - everything else is gestures/wheel.
      label: "Reset view",
      icon: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M9 4 H5 a1 1 0 0 0 -1 1 V9"/>
        <path d="M15 4 h4 a1 1 0 0 1 1 1 V9"/>
        <path d="M20 15 v4 a1 1 0 0 1 -1 1 h-4"/>
        <path d="M9 20 H5 a1 1 0 0 1 -1 -1 v-4"/>
        <rect x="9.5" y="9.5" width="5" height="5" rx="1"/>
      </svg>`,
      onClick: () => viewport.reset(),
    },
  ],
  {
    main: {
      initial: initialMainColor,
      onChange: (c) => {
        layerManager.setStrokeStyle(c);
        store.set("app.color.main", c);
        refreshSettingsColors();
      },
    },
    secondary: {
      initial: initialSecondaryColor,
      onChange: (c) => {
        store.set("app.color.secondary", c);
        refreshSettingsColors();
      },
    },
    onOpenPalette: (target, anchor) => openColorPalette(target, anchor),
  },
  initialBrushKey,
  showSettings,
  canvasMenuOptions,
  {
    onUndo: () => doUndo(),
    onRedo: () => doRedo(),
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
  },
  [
    { label: "Brushes", shortcut: "b", open: showSettings },
    { label: "Layers", shortcut: "l", open: showLayers },
    { label: "Maps", shortcut: "m", open: showMaps },
    { label: "Symmetry", shortcut: "y", open: showSymmetry },
    { label: "Settings", shortcut: ",", open: showAppSettings },
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
    onOpen: () => showMaps(),
    pinned: () => mapHighlighter.isPinned(),
    onToggleHot: () => {
      const on = !mapHighlighter.isPinned();
      mapHighlighter.setPinned(on);
      store.set("app.maps.pinHighlight", on);
      // Flash once as it turns on, so you immediately see where the dots are.
      if (on) mapHighlighter.flash(layerManager.selectedNeighborsMapIdx);
      menu.refreshMapsPill();
    },
    subscribe: (fn) => layerManager.subscribe(fn),
  },
  {
    modes: SYMMETRY_MODES.map((m) => ({
      value: m.id,
      label: m.label,
      icon: m.icon,
    })),
    initial: symmetry.mode,
    onChange: (m) => symmetry.setMode(m as SymmetryMode),
    onSettings: () => showSymmetry(),
  },
);
history.subscribe(() => menu.refreshHistoryState());
// Keep the navbar Symmetry combo's icon in sync when the mode is changed from
// the Symmetry panel (or anywhere). setMode → notify → here.
symmetry.subscribe(() => menu.setSymmetryValue(symmetry.mode));
document.body.appendChild(menu.el);

// Ensure the only connecting brush starts on the persisted art style, then draw
// both boxes and sync the navbar Connecting combo. Apply the style's stroke-line
// opacity on first load (selectBrush() does this on later switches) so the main
// line doesn't paint opaque over the connecting web — the cause of the canvas
// darkening far faster than Harmony.
// Custom presets load async (below), so a persisted custom name isn't known yet
// — fall back to the default until presets.restore() brings it back.
brushes["Round"]?.selectArtStyle(
  hasConnection(currentArtStyle) ? currentArtStyle : DEFAULT_ART_STYLE,
);
// Apply the persisted brush's own onSelect (art style) + erase mode. The initial
// brush is assigned directly, not through selectBrush, so do it here. Round is
// already handled above with the custom-preset-safe guard, so skip its (unguarded)
// onSelect to avoid touching a custom style that hasn't loaded yet.
if (appState.brush !== brushes["Round"]) appState.brush.onSelect();
layerManager.setEraseMode(appState.brush.erases());
applyBrushStrokeOpacity(false);
renderActiveBrush();

// Custom presets load async from IDB; once back, a persisted custom art style
// can actually be applied (the fallback above covered the gap).
void presets.restore().then((loaded) => {
  if (loaded && hasConnection(currentArtStyle)) setArtStyle(currentArtStyle);
});

// ---- onboarding / start page --------------------------------------------------

const ONBOARDED_KEY = "app.onboarded";
const MANDALA_BG = "#0d0e12"; // deep, near-black canvas for the mandala start

const onboarding = createOnboarding({
  actions: {
    // 1:1 dark canvas + radial symmetry, the connecting brush in a vivid colour,
    // and the symmetry (mandala) panel open - the recommended first run.
    startMandala: (color) => {
      const max = screenMax();
      const size = squareOfScreen(max.width, max.height);
      layerManager.reset(size);
      applyNewCanvasSize(size);
      resetArtState();
      layerManager.setBackground({ color: MANDALA_BG, transparent: false });
      applyStageBackground();
      selectBrush("Round"); // the connecting brush that weaves the kaleidoscope
      menu.setMainColor("#ffffff"); // a light stroke reads on the dark canvas
      symmetry.setMode("radial");
      const round = brushes["Round"];
      if (round) applyConnectionColor(round, mandalaConnectionColor(color));
      store.set(CANVAS_SIZE_KEY, size);
      void history.clear();
      pushUndo("Mandala");
      showSymmetry(); // open the symmetry (mandala) panel
    },
    startBlank: (variant) => {
      const max = screenMax();
      const size =
        variant === "square"
          ? squareOfScreen(max.width, max.height)
          : fullScreenSize(max.width, max.height);
      layerManager.reset(size);
      applyNewCanvasSize(size);
      resetArtState();
      layerManager.setBackground({ color: "#ffffff", transparent: false });
      applyStageBackground();
      menu.setMainColor("#000000");
      symmetry.setMode("none");
      store.set(CANVAS_SIZE_KEY, size);
      void history.clear();
      pushUndo("New art");
    },
    loadArtworkFile: (file) => loadArtwork(file),
  },
  prefs: {
    theme: {
      initial: savedTheme,
      onChange: (t) => {
        applyTheme(t);
        store.set("app.theme", t);
      },
    },
    pen: {
      initial: penEnabled,
      onChange: (on) => {
        penEnabled = on;
        store.set("app.penEnabled", on);
        settingsPanel.render(appState.brush); // show/hide the Pen section live
      },
    },
  },
  onDismiss: () => store.set(ONBOARDED_KEY, true),
});
// Lives INSIDE the viewport so it replaces the canvas area (the toolbar/panels
// stay above it), not the whole page.
viewportEl.appendChild(onboarding.el);

// First run (or right after a data reset): nothing is stored, so show the Start
// page. An existing user with prior data is treated as already onboarded so we
// never hide their canvas behind it.
{
  const onboarded = store.get<boolean>(ONBOARDED_KEY) === true;
  const hasPriorUse =
    store.get<unknown>("app.brush.selected") !== undefined ||
    store.get<unknown>(CANVAS_SIZE_KEY) !== undefined;
  if (shouldShowOnboarding({ onboarded, hasPriorUse })) onboarding.show();
  else if (!onboarded && hasPriorUse) store.set(ONBOARDED_KEY, true);
}
// Opening the Start page mid-session is a deliberate "start over", so confirm
// first (the first-run auto-show below calls onboarding.show() directly).
const showStartPage = () => {
  showConfirm({
    title: "Start a new drawing?",
    message:
      "This opens the Start page to begin a fresh canvas. Picking an option there replaces your current drawing.",
    confirmLabel: "Start page",
    destructive: true,
    onConfirm: () => onboarding.show(),
  });
};

// ---- panels visibility + shortcuts --------------------------------------------------

const shortcuts = buildAppShortcuts({
  // Lazy: the Shortcuts panel below is itself built from this table. The list
  // leads with the navbar — the default restore state shows only it.
  panels: () => [
    menu.el,
    settingsPanel.el,
    layersBox.el,
    symmetryBox.el,
    mapsBox.el,
    appSettingsBox.el,
    shortcutsPanel.el,
  ],
  showMaps,
  showLayers,
  showSymmetry,
  showSettings,
  showConnecting,
  showAppSettings,
  toggleCanvasMenu: () => menu.toggleCanvasMenu(),
  showShortcuts: () => showShortcuts(),
  showStartPage,
  selectBrush,
  undo: doUndo,
  redo: doRedo,
  recordClip,
});
const shortcutsPanel = createShortcutsPanel(shortcuts);
document.body.appendChild(shortcutsPanel.el);
registerWindow(shortcutsPanel.el);
// "/" (and the Windows menu) toggles: open when hidden, dismiss when shown.
showShortcuts = () => {
  if (shortcutsPanel.el.style.display === "none") showWindow(shortcutsPanel.el);
  else shortcutsPanel.el.style.display = "none";
};
bindShortcuts(shortcuts);

// ---- help hints (press ? to toggle visibility) ---------------------------------------

registerHelpHints({
  layersBox: layersBox.el,
  settingsPanel: settingsPanel.el,
  symmetryBox: symmetryBox.el,
  mapsBox: mapsBox.el,
});

// ---- drawing input ----------------------------------------------------------------------

// Two-finger pan/zoom/rotate. Declared first so the drawing input can ask
// whether a gesture owns the touch; assigned just after (it needs to commit the
// active stroke when a 2nd finger lands).
let touchGestures: { active: () => boolean } | null = null;

const drawingInput = bindDrawingInput({
  stage,
  viewport,
  brush: () => appState.brush,
  symmetry,
  layerManager,
  penEnabled: () => penEnabled,
  gestureActive: () => touchGestures?.active() ?? false,
  onStrokeStart: notifyClipStrokeStart, // first stroke starts an armed GIF capture
  onStrokeEnd: (b) => {
    layersBox.refreshPreviews();
    // A stroke may have added points to the active map; refresh the maps box,
    // the navbar pill's point count, and the pinned "hot map" dots (strokes add
    // pixels directly without an emit, so none would otherwise update).
    mapsBox.render();
    menu.refreshMapsPill();
    mapHighlighter.refresh();
    // One capture serves both undo and persistence — the pushed row is the
    // persisted paint, so this is the only blob-encode pass per stroke.
    pushUndo(`${b.name()} stroke on ${activeLayerName()}`);
  },
});

touchGestures = bindTouchGestures({
  viewportEl,
  viewport,
  // A 2nd finger landing cancels the 1-finger stroke: a deferred tap is dropped
  // with no mark (so 2-finger undo / 3-finger redo taps hit the real artwork),
  // and a stroke that already moved is committed (undoable). Either way the
  // leftover finger never keeps drawing.
  onGestureBegin: () => drawingInput.cancelActiveStroke(),
});

// Paste an image (Cmd/Ctrl+V): drop it into a move/resize preview on the canvas,
// then Place to bake it onto the active layer (undoable) or Cancel to drop it.
const imagePaste = bindImagePaste({
  stage,
  viewport,
  layerManager,
  dpr,
  onBaked: () => {
    pushUndo(`Paste image on ${activeLayerName()}`);
    layersBox.refreshPreviews();
  },
});
onViewportChange = () => imagePaste.handleCameraChange();

// ---- durability on hide/close -----------------------------------------------------

// Wired last in boot: it commits the in-progress stroke + flushes the pixel log
// when the tab hides, so it needs the drawing input (assigned above).
bindDurability({ drawingInput, pixelLog });

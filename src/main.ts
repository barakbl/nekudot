import "./styles.css";
import { BRUSH_DEFS, type BrushContext } from "./brushes/registry";
import { SymmetryController } from "./symmetry/controller";
import { makeSymmetryProxy } from "./symmetry/proxy";
import { createSymmetryBox } from "./symmetry/box";
import { startClipRecording, notifyClipStrokeStart } from "./clip/record-flow";
import { openClipPreview } from "./clip/preview-box";
import { produceReplayClip } from "./clip/frame-producer-replay";
import { bindShortcuts, createShortcutsPanel } from "./shortcuts";
import { createZoomReadout } from "./app/zoom-readout";
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
import { NEKUDOT_ARTWORK_SUFFIX } from "./nekudot-schema";
import { pixelLog } from "./pixel-log";
import { EventRecorder } from "./log/recorder";
import { EventLogStore } from "./log/store";
import { BlobStore, hashBlob } from "./log/blobs";
import { RecorderTelemetry } from "./log/telemetry";
import { showChip } from "./chip";
import { registerWindow, showWindow } from "./ui/window-stack";
import { createPalettePanel } from "./colors/panel";
import { clearColorsStore, loadGradientPalettes } from "./colors/store";
import { setGradientPalettes, setGradientSpace } from "./brushes/color-source";
import { fullScreenSize, squareOfScreen } from "./canvas-size";
import { Viewport } from "./app/viewport";
import { bindTouchGestures } from "./app/touch-gestures";
import { bindImagePaste } from "./app/image-paste";
import { createAppSettingsBox } from "./app/app-settings-box";
import { createFolderSync } from "./app/folder-sync";
import { exportSettings, importSettings } from "./app/settings-io";
import { setDiagnostics, dlog } from "./diagnostics";
import { AppHistory } from "./app/history";
import { createTileHost } from "./app/tile-capture";
import { createMapsControl } from "./app/maps-control";
import { bindDrawingInput } from "./app/drawing-input";
import { createOpacityController } from "./app/opacity-controller";
import { opacityStorageKey, recalledOpacity } from "./app/opacity-store";
import { createPresetsController } from "./app/presets";
import { buildAppShortcuts } from "./app/app-shortcuts";
import { createUiVisibility } from "./app/ui-visibility";
import { createHideUiButton } from "./app/hide-ui-button";
import { registerHelpHints } from "./app/help-hints";
import { bindDurability } from "./app/durability";
import { createStage } from "./app/stage";
import { createExportActions, applyTheme } from "./app/export-actions";
import { bindCameraInput } from "./app/camera-input";
import { createDrawingCore } from "./app/drawing-core";
import { CURSOR_STORE_KEY } from "./app/brush-cursor";
import { createUndoWiring } from "./app/undo-wiring";
import { createResetGate } from "./app/reset-gate";
import { buildNavbar } from "./app/navbar";
import { createOnboarding, shouldShowOnboarding } from "./onboarding/onboarding";
import { createFirstRunGuide } from "./onboarding/first-run-guide";
import {
  applyConnectionColor,
  mandalaConnectionColor,
} from "./onboarding/connection-color";
import { neutralCanvasDefaults } from "./onboarding/canvas-defaults";

const store = new LocalStorageStore();

const MAX_LAYERS = 10;
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

// Default stroke width; Size ranges 1-40, the value Reset returns Size to.
const DEFAULT_BRUSH_SIZE = 1;
const initialSize = Math.min(
  40,
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

// The single owner of the live applied opacity ("app.opacity"): set() updates the
// renderer's global alpha and the persisted value together, so the deposited
// points (renderer) and the symmetry proxy + previews (store reads) can never
// drift apart. The per-(brush, art-style) remembered opacity is separate (below).
const appOpacity = createOpacityController({
  layerManager,
  store,
  defaultAlpha: initialAlpha,
});

// Folder sync (Chrome only): connect a local folder once, then save/load the
// settings file and save the current artwork there without download dialogs.
// refreshFolderUI is wired to the Folder panel once it exists; restore()
// re-attaches a previously chosen folder at boot (see below).
let refreshFolderUI = (): void => {};
const folderSync = createFolderSync({
  manager: layerManager,
  onChange: () => refreshFolderUI(),
});

// Migrate the legacy app.canvas.bg color into the manager's background slot
// if the new schema field still holds its default (#fff).
if (legacyBgColor) {
  const cur = layerManager.getBackground();
  if (cur.color === "#ffffff") {
    layerManager.setBackground({ color: legacyBgColor }, { emit: false });
  }
}
// Drop the legacy key once migrated. Unconditionally (not just when truthy) so a
// prior build's `set(key, undefined)` - which wrote the string "undefined" and
// left the key behind - is also cleaned up. removeItem on an absent key no-ops.
store.remove("app.canvas.bg");

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
// Refreshed on every view change (see onViewportChange below).
const zoomReadout = createZoomReadout(viewport);
viewportEl.appendChild(zoomReadout.el);
bindCameraInput({
  viewportEl,
  viewport,
  // Don't hijack the wheel while the Start page is over the canvas - let it
  // scroll. `onboarding` is created below; this only runs on wheel events.
  shouldIgnoreWheel: (e) =>
    onboarding.isOpen() && onboarding.el.contains(e.target as Node),
});

// "transparent" sentinel when the background is off, so previews/flatten skip
// the fill. Also the background to flatten against for export/share (the
// export path treats "transparent" as no fill, keeping the PNG's alpha).
const backgroundColorForPreviews = (): string => {
  const bg = layerManager.getBackground();
  return bg.transparent ? "transparent" : bg.color;
};
const exportBackground = (): string => backgroundColorForPreviews();

// Start a GIF recording (menu item + the "r" shortcut). When the shadow event log
// is on, export the WHOLE recorded session as a process video by replaying the log
// offscreen (vector-replay P3.1) - the first user-visible replay payoff. Otherwise
// (or if nothing's recorded) fall back to the live screen-grab recorder, which
// arms now and captures from the first stroke (see clip/record-flow).
const recordClip = async (): Promise<void> => {
  if (eventRecorder.recording) {
    const events = await eventRecorder.drain();
    // Only replay when this drawing recorded strokes; else fall through to the live
    // screen-grab recorder below.
    if (events.some((e) => (e as { t?: string }).t === "begin")) {
      // The replay is synchronous and can pause the tab, so show a toast first
      // (yield two frames so it paints before the main thread blocks).
      showChip("Rendering process video…");
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
      const clip = await produceReplayClip({
        events,
        size: layerManager.currentSize,
        layers: layerManager.getConfig(),
        dpr,
        background: exportBackground,
      });
      if (clip) {
        openClipPreview(clip);
        return;
      }
    }
  }
  startClipRecording({
    manager: layerManager,
    getBackgroundColor: exportBackground,
    container: viewportEl,
  });
};

// ---- overlays + symmetry ----------------------------------------------------

// Symmetry (Tile / Radial / Mirror): the controller owns the active mode + guide
// settings; the proxy (below) mirrors every mark and deposited point at the
// active mode's transforms, so any brush works under symmetry. Constructed
// before the overlays, which read the controller to draw their guides.
const symmetry = new SymmetryController(store);

// On-stage overlays (the invisible-brush glow, the symmetry guides, the map-dot
// highlight), the symmetry-guide wiring, and the new-canvas resize/reframe.
const { invisibleOverlay, mapHighlighter, brushCursor, applyNewCanvasSize } = createDrawingCore(
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

// Every "the drawing was replaced" path (load / new / mandala / blank) goes
// through here, so the remembered folder-sync filename is forgotten by default -
// the next sync then starts a fresh file instead of overwriting the previous
// drawing's. loadArtwork re-adopts the uploaded name right after.
const replaceArtwork = (size: Parameters<typeof applyNewCanvasSize>[0]): void => {
  applyNewCanvasSize(size);
  folderSync.forgetArtworkFile();
  // A different drawing starts a clean process log (it persists across reloads and
  // isn't otherwise scoped to an artwork).
  void eventRecorder.reset();
};

// The symmetry proxy wraps the LayerManager as the brushes' host (mode None
// forwards untouched). Kept in main so it's constructed right before the brush
// loop that consumes it.
const symmetryProxy = makeSymmetryProxy(
  layerManager,
  () => symmetry.transforms(),
  () => appOpacity.get(),
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
// Live app state: the container the scattered top-level `let`s are migrating
// onto, so the many panels reading these share one source of truth. The toggle
// handlers in App settings / onboarding are the writers (see each field).
type AppState = {
  brush: BrushBase; // selected brush; written by selectBrush
  artStyle: string; // connection art style; written by setArtStyle + onboarding reset
  penEnabled: boolean; // pen pressure/tilt support; off = stylus draws like a mouse, Pen section hidden
  penOnly: boolean; // palm rejection: touch never draws, only pen/mouse; off by default
  pixelLogEnabled: boolean; // pixel-log writing (future features); off by default
  eventLogEnabled: boolean; // shadow event-log recording (vector-replay); off by default
  diagnosticsEnabled: boolean; // opt-in field diagnostics
  smoothGradients: boolean; // OKLCH "smooth" gradient blend space vs sRGB; default on
  singleKeyShortcuts: boolean; // bare-key shortcuts (b/c/y/1-9…); off disables them (WCAG 2.1.4)
  desktopMode: boolean; // tablet: float panels as draggable windows (vs bottom sheets); off by default
};
const appState: AppState = {
  brush: brushes[initialBrushKey],
  artStyle: store.get<string>("app.artStyle") ?? DEFAULT_ART_STYLE,
  penEnabled: store.get<boolean>("app.penEnabled") ?? true,
  penOnly: store.get<boolean>("app.penOnly") ?? false,
  pixelLogEnabled: store.get<boolean>("app.pixelLog") ?? false,
  eventLogEnabled: store.get<boolean>("app.eventLog") ?? false,
  diagnosticsEnabled: store.get<boolean>("app.diag") ?? false,
  smoothGradients: store.get<boolean>("app.gradient.oklch") ?? true,
  singleKeyShortcuts: store.get<boolean>("app.shortcuts.singleKey") ?? true,
  desktopMode: store.get<boolean>("app.desktopMode") ?? false,
};

// Feed the cursor preview the active brush's web reach (0 when it won't weave),
// so its dashed reach ring tracks the current brush + Reach dial.
brushCursor.setReach(() => appState.brush.activeConnection()?.reach() ?? 0);

// "Desktop mode" (App settings, tablet only): the CSS gates the bottom-sheet vs
// floating-window panel layout on body.desktop-mode (see styles.css).
document.body.classList.toggle("desktop-mode", appState.desktopMode);

// Apply the persisted pixel-log setting (App settings; off by default - it is
// for future features and otherwise just grows storage, see pixel-log.ts).
pixelLog.setEnabled(appState.pixelLogEnabled);

// Shadow event-log recorder (vector-replay, record-only). Off by default behind
// app.eventLog; when on it taps the draw loop and writes P1.1 events to IDB. No UI
// toggle yet - enabled via the flag until process-export (Phase 3) surfaces it.
// The telemetry sink collects the Gate 1 numbers (P1.3), surfaced in App settings
// -> Diagnostics; the store feeds it flush-stall timings, the recorder the rest.
const eventTelemetry = new RecorderTelemetry();
const eventRecorder = new EventRecorder({
  store:
    typeof indexedDB === "undefined"
      ? null
      : new EventLogStore({ onWriteCost: (ms) => eventTelemetry.flushCost(ms) }),
  appVersion: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev",
  dpr: () => (typeof window === "undefined" ? 1 : window.devicePixelRatio),
  artworkInit: () => {
    const size = layerManager.currentSize;
    return { width: size.width, height: size.height, layers: layerManager.getConfig() };
  },
  telemetry: eventTelemetry,
});
eventRecorder.setEnabled(appState.eventLogEnabled);

// Content-hash blob store for pasted images (vector-replay): a PasteImage event
// carries only the hash; the bytes live here so replay can redraw them.
const eventBlobs = typeof indexedDB === "undefined" ? null : new BlobStore();
// Record a pasted image: content-hash the bytes, store the blob, emit PasteImage.
const recordPasteEvent = async (
  file: File,
  box: { x: number; y: number; w: number; h: number },
): Promise<void> => {
  if (!eventRecorder.recording || !eventBlobs) return;
  const hash = await hashBlob(file);
  await eventBlobs.put(hash, file);
  eventRecorder.event({
    t: "paste",
    hash,
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    layer: layerManager.activeLayerId(),
  });
};

// Vector-replay test seam (P2.2): when recording is on, expose the live layer
// manager so the replay-equivalence smoke can flatten the live artwork and compare
// it to an offscreen replay of the same log. Gated on app.eventLog (off by
// default), so it never exists in a normal session.
if (appState.eventLogEnabled && typeof window !== "undefined") {
  (window as unknown as { __replay?: { layerManager: LayerManager } }).__replay = { layerManager };
}

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
      b.selectArtStyle(appState.artStyle);
      // The preview ignores map routing (map-only / map+stroke): always weave to
      // both the stroke and the (single) cloud so the web always shows.
      b.applyRoutingPreset("classic");
    }
    return b;
  },
  size: () => store.get<number>("app.size") ?? initialSize,
  alpha: () => appOpacity.get(),
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

// Apply opt-in field diagnostics early (App settings -> Diagnostics) so it
// captures startup errors + an environment snapshot on a reload where it's on.
setDiagnostics(appState.diagnosticsEnabled);

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
  currentStyle: () => appState.artStyle,
  applyStyle: (name) => setArtStyle(name),
  defaultStyle: () => DEFAULT_ART_STYLE,
  strokeAlpha: () => appOpacity.get(),
  refreshMenu: () => {
    const g = connectingComboGroups();
    settingsPanel.setConnectingOptions(g);
    menu.setStyleOptions(g);
  },
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
  opacityStorageKey(appState.brush.name(), appState.brush.supportsConnecting(), appState.artStyle);
const recallOpacity = () =>
  recalledOpacity(store.get<number>(opacityKey()), appState.brush.getSelectOpacity());

const settingsPanel = createSettingsPanel({
  showPen: () => appState.penEnabled,
  onOpenPreview: () => brushPreview.open(),
  onSettingChange: (change) => brushPreview.onSettingChanged(change),
  // No onSettings: a "Web settings" gear would just reopen the panel this picker
  // sits in.
  connecting: {
    groups: connectingComboGroups(),
    initial: appState.artStyle,
    onChange: (name) => setArtStyle(name),
    onDeleteCustom: (name) => presets.remove(name),
    onImport: () => presets.import(),
    onExport: () => presets.export(),
  },
  brushControls: {
    size: {
      get: () => store.get<number>("app.size") ?? initialSize,
      min: 1,
      max: 40,
      step: 1,
      onChange: (size) => {
        layerManager.setLineWidth(size);
        store.set("app.size", size);
        brushCursor.redraw(); // resize the preview ring live
        brushPreview.onSettingChanged({
          label: "Size",
          value: String(size),
          help: "How thick the brush's own line is.",
        });
      },
    },
    opacity: {
      get: () => appOpacity.get(),
      min: 0,
      max: 1,
      step: 0.05,
      onChange: (a) => {
        appOpacity.set(a); // renderer alpha + live persisted value, together
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
    presets.isCustom(appState.artStyle) ? appState.artStyle : null,
  onReset: () => {
    appState.brush.resetSettings(); // brush params + art-style dials
    // Size + opacity are app-global (not part of getSettings), so reset them
    // here: Size to the default, opacity to the brush's preferred value — same
    // as a fresh brush selection (getSelectOpacity ?? 1).
    layerManager.setLineWidth(DEFAULT_BRUSH_SIZE);
    store.set("app.size", DEFAULT_BRUSH_SIZE);
    store.remove(opacityKey()); // forget the remembered opacity for this context
    const op = recallOpacity(); // -> the style's default (strokeAlpha) or 1
    appOpacity.set(op);
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
  settingsPanel.showTab(appState.brush.supportsConnecting() ? "connecting" : "brush");
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
  if (appState.brush.supportsConnecting()) {
    settingsPanel.setConnectingValue(appState.artStyle);
    menu.setStyleValue(appState.artStyle);
  }
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
  if (!force && appOpacity.isSet()) return;
  // Recall this (brush, style)'s remembered opacity, falling back to the style's
  // preferred opacity. No-op for brushes with neither (non-connecting on a fresh
  // store), so a plain mouse stroke stays fully opaque.
  if (store.get<number>(opacityKey()) === undefined && appState.brush.getSelectOpacity() === undefined)
    return;
  const op = recallOpacity();
  appOpacity.set(op);
  settingsPanel.render(appState.brush); // reflect the new value in the Opacity slider
};

// Pick an art style from the combo: apply it to the active brush, match its
// Harmony stroke-line opacity, persist it, and refresh the settings window.
const setArtStyle = (name: string) => {
  appState.artStyle = name;
  store.set("app.artStyle", name);
  appState.brush.selectArtStyle(name); // apply + restore this brush's saved dials for it
  applyBrushStrokeOpacity(true);
  settingsPanel.render(appState.brush);
  settingsPanel.setConnectingValue(name);
  menu.setStyleValue(name);
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
const history = new AppHistory(layerManager, MAX_UNDO, undefined, createTileHost(layerManager));
const { pushUndo: commitUndo, activeLayerName, doUndo, doRedo } = createUndoWiring({
  history,
  layerManager,
  applyStageBackground,
  getLayersBox: () => layersBox,
});

// vector-replay config tap: after ANY undoable action, record a ConfigOp iff the
// layer/map/background/size config actually changed. pushUndo fires on every config
// op (add/remove/reorder/rename/OPACITY layer, background, add/remove/rename map,
// reset/new-canvas) - a superset of manager.subscribe (which misses opacity + the
// Layers-box background). The JSON-diff dedupe makes its stroke-end / paste firings
// a no-op, and ignores active/selected-only cursor moves (replay re-stamps the
// active layer per stroke). Gated on the recorder, so it's free when logging is off.
let lastConfigKey = JSON.stringify({
  ...layerManager.getConfig(),
  activeIndex: 0,
  selectedNeighborsMapIndex: 0,
});
const recordConfigOp = (): void => {
  if (!eventRecorder.recording) return;
  const layers = layerManager.getConfig();
  const key = JSON.stringify({ ...layers, activeIndex: 0, selectedNeighborsMapIndex: 0 });
  if (key === lastConfigKey) return;
  lastConfigKey = key;
  const size = layerManager.currentSize;
  eventRecorder.event({ t: "config", op: "layers", layers, width: size.width, height: size.height });
};
const pushUndo = (desc: string): void => {
  commitUndo(desc);
  recordConfigOp();
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
  (req) => palettePanel.open(req), // background swatch opens the colour palette
);
document.body.appendChild(layersBox.el);

const symmetryBox = createSymmetryBox(symmetry);
document.body.appendChild(symmetryBox.el);
registerWindow(symmetryBox.el);

// The memory-maps editor, opened as a subpanel from the navbar Maps icon. Holds
// all the per-map controls plus the "Live view" toggle; the navbar icon lights
// up while Live view is on (the active map's name/count live in its tooltip).
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
  // "Live view": the persistent hot-map highlight, shared with the navbar icon.
  () => mapHighlighter.isPinned(),
  (on) => {
    mapHighlighter.setPinned(on);
    store.set("app.maps.pinHighlight", on);
    // Flash once as it turns on, so you immediately see where the dots are.
    if (on) mapHighlighter.flash(layerManager.selectedNeighborsMapIdx);
    menu.refreshMapsPill(); // light/unlight the navbar cloud icon
  },
);
// The routing "Connection" group lives in the Maps box now; build it for the
// current brush (re-read on each render, so it tracks the active brush + maps).
const mapsBox = createMapsBox(mapsControl, () =>
  buildRoutingControls(appState.brush),
);
document.body.appendChild(mapsBox.el);

// Show helpers for the boxes created above (see showSettings/showConnecting).
// Layers is a navbar-anchored subpanel (like Maps / the colour picker): open it
// beneath the given anchor, or the navbar Layers icon (the "l" key / Windows
// menu). `menu` is read lazily (built below).
const showLayers = (anchor?: HTMLElement) => {
  const target = anchor ?? menu.layersPillAnchor;
  if (target) layersBox.open(target);
};
const showSymmetry = () => showWindow(symmetryBox.el);
// Maps is a navbar-anchored subpanel (like the colour picker), not a draggable
// window: open it beneath the given anchor, or the navbar Maps icon when opened
// from the "m" key / Windows menu. `menu` is read lazily (built below).
const showMaps = (anchor?: HTMLElement) => {
  const target = anchor ?? menu.mapsPillAnchor;
  if (target) mapsBox.open(target);
};

// Async-restore paint state + undo stack from IDB on startup. Called here
// (during module evaluation) so it's first in the history queue. Drawing input
// is gated on `bootRestored` until this settles, so an early stroke can't be
// drawn and then wiped by applyPaintData mid-flight (bug #1). `finally` (not
// `then`) so a failed restore still unblocks input rather than freezing it.
let bootRestored = false;
void history
  .init(async (paintSnap) => {
    if (paintSnap) {
      await layerManager.applyPaintData(paintSnap);
      layersBox.refreshPreviews();
    }
  })
  .finally(() => {
    bootRestored = true;
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
  appState.artStyle = DEFAULT_ART_STYLE;
  store.set("app.artStyle", appState.artStyle);
  renderActiveBrush();
};

// One gate for every soft reset (New art / Delete canvas / mandala / blank) so no
// path can forget a piece of the wipe (layers, content, sync file, size, undo
// baseline). Undo stays out of it: Delete passes clearHistory:false to remain
// undoable, per the UX/art review.
const resetDrawing = createResetGate({
  resetLayers: (size) => layerManager.reset(size),
  resizeCanvas: applyNewCanvasSize,
  forgetSyncFile: () => folderSync.forgetArtworkFile(),
  resetEventLog: () => void eventRecorder.reset(),
  clearContent: clearArtContent,
  resetArtStyle: resetArtState,
  persistSize: (size) => store.set(CANVAS_SIZE_KEY, size),
  clearHistory: () => void history.clear(),
  pushUndo,
});

const deleteCanvas = (): void =>
  resetDrawing({
    size: layerManager.currentSize,
    undoLabel: "Delete canvas",
    clearHistory: false,
    resetArtStyle: false,
    resize: false,
  });

const loadFileInput = document.createElement("input");
loadFileInput.type = "file";
loadFileInput.accept = `${NEKUDOT_ARTWORK_SUFFIX},application/zip`;
loadFileInput.style.display = "none";
document.body.appendChild(loadFileInput);

// Parse + apply a .nekudot file onto the canvas (shared by the file picker and
// the onboarding "open a saved piece" cards).
const loadArtwork = async (file: File, rememberName = false): Promise<void> => {
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
  replaceArtwork(size);
  applyStageBackground();
  layersBox.refreshPreviews();
  renderActiveBrush();
  store.set(CANVAS_SIZE_KEY, size);
  void history.clear();
  pushUndo("Load artwork"); // also persists the loaded paint (the new pointer row)
  // An uploaded file keeps its name, so a later folder sync overwrites the same
  // file instead of making a duplicate. (replaceArtwork already forgot it for the
  // bundled-sample / non-remember case.)
  if (rememberName) folderSync.setArtworkFile(file.name);
  showChip("Artwork loaded");
};

loadFileInput.addEventListener("change", async () => {
  const file = loadFileInput.files?.[0];
  loadFileInput.value = ""; // allow re-picking the same file later
  if (file) await loadArtwork(file, true); // remember the uploaded name for sync
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
      onConfirm: () =>
        resetDrawing({
          size,
          undoLabel: "New art",
          clearHistory: true,
          resetArtStyle: false,
          resize: true,
        }),
    });
  },
});
document.body.appendChild(sizePicker.el);

// ---- export / share / theme -------------------------------------------------------

const { exportImage, shareImage } = createExportActions({
  layerManager,
  exportBackground,
  showChip,
  showError,
});

// Download the artwork as a .nekudot, with the same success/error feedback the
// folder save gives (it was previously silent on both success and failure).
const downloadArtwork = (): Promise<void> =>
  saveArtwork(layerManager).then(
    () => showChip("Artwork saved"),
    (err) => {
      console.error("saveArtwork failed", err);
      showError("Couldn't save the artwork.", "Save failed");
    },
  );

const canvasMenuOptions = {
  onShareImage: shareImage,
  onExportImage: exportImage,
  onRecordClip: recordClip,
  onSaveArtwork: () => void downloadArtwork(),
  onLoadArtwork: promptLoadArtwork,
  eventLogActive: () => eventRecorder.recording,
};

// The global Application settings panel (theme / input / advanced) - the
// app-wide counterpart to the per-brush settings panel. Theme + pen pressure
// moved here from the More menu.
// Apply the gradient blend space (OKLCH "smooth" vs classic sRGB; App settings)
// to the colour-source module.
setGradientSpace(appState.smoothGradients ? "oklch" : "srgb");

const appSettingsBox = createAppSettingsBox({
  theme: {
    initial: savedTheme,
    onChange: (t) => {
      applyTheme(t);
      store.set("app.theme", t);
    },
  },
  cursor: {
    initial: brushCursor.mode(),
    onChange: (m) => {
      store.set(CURSOR_STORE_KEY, m);
      brushCursor.setMode(m);
    },
  },
  smoothGradients: appState.smoothGradients,
  onToggleSmoothGradients: (on) => {
    appState.smoothGradients = on;
    store.set("app.gradient.oklch", on);
    setGradientSpace(on ? "oklch" : "srgb");
    refreshSettingsColors(); // regenerate the Color dial swatches in the new space
  },
  penEnabled: appState.penEnabled,
  onTogglePen: (on) => {
    appState.penEnabled = on;
    store.set("app.penEnabled", on);
    settingsPanel.render(appState.brush); // show/hide the Pen section live
  },
  penOnlyDraws: appState.penOnly,
  onTogglePenOnlyDraws: (on) => {
    appState.penOnly = on;
    store.set("app.penOnly", on);
  },
  singleKeyShortcuts: appState.singleKeyShortcuts,
  onToggleSingleKeyShortcuts: (on) => {
    appState.singleKeyShortcuts = on;
    store.set("app.shortcuts.singleKey", on);
  },
  desktopMode: appState.desktopMode,
  onToggleDesktopMode: (on) => {
    appState.desktopMode = on;
    store.set("app.desktopMode", on);
    document.body.classList.toggle("desktop-mode", on); // CSS flips sheet <-> window
  },
  pixelLog: appState.pixelLogEnabled,
  onTogglePixelLog: (on) => {
    appState.pixelLogEnabled = on;
    store.set("app.pixelLog", on);
    pixelLog.setEnabled(on);
  },
  diagnostics: appState.diagnosticsEnabled,
  onToggleDiagnostics: (on) => {
    appState.diagnosticsEnabled = on;
    store.set("app.diag", on);
    setDiagnostics(on);
    if (on) {
      // A one-shot snapshot of the current drawing state for context.
      const bg = layerManager.getBackground();
      dlog("app", "state", {
        brush: appState.brush.name(),
        opacity: appOpacity.get(),
        size: store.get<number>("app.size"),
        main: store.get<string>("app.color.main"),
        secondary: store.get<string>("app.color.secondary"),
        theme: store.get<string>("app.theme") ?? "auto",
        penEnabled: appState.penEnabled,
        background: bg.transparent ? "transparent" : bg.color,
        canvas: `${layerManager.currentSize.width}x${layerManager.currentSize.height}`,
      });
    }
  },
  // Process recording (app.eventLog): logs strokes + config/paste so a whole-session
  // process video (GIF) can be exported from Record GIF. Off by default.
  eventLog: appState.eventLogEnabled,
  onToggleEventLog: (on) => {
    appState.eventLogEnabled = on;
    store.set("app.eventLog", on);
    eventRecorder.setEnabled(on);
    if (on) void eventRecorder.reset(); // start a fresh log from the current canvas
  },
  // Gate 1 recording telemetry (P1.3), read on demand when the Diagnostics group
  // is opened. `recording` drives the empty-state hint.
  recorderTelemetry: () => eventTelemetry.snapshot(),
  eventLogRecording: () => eventRecorder.recording,
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
  onExportSettings: () => void exportSettings(),
  onImportSettings: () => importSettings(),
  // The Local-folder feature lives as a "Folder" tab here (was its own window).
  folder: folderSync.supported
    ? {
        isConnected: () => folderSync.isConnected(),
        folderName: () => folderSync.folderName(),
        pendingFolderName: () => folderSync.pendingFolderName(),
        currentFile: () => folderSync.currentArtworkFile(),
        onConnect: () => void folderSync.connect(),
        onDisconnect: () => void folderSync.disconnect(),
        onSaveArtwork: () => void folderSync.syncArtwork(),
        onSaveSettings: () => void folderSync.saveSettings(),
        onLoadSettings: () => void folderSync.loadSettings(),
      }
    : null,
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
      () => folderSync.disconnect(), // forget the connected folder handle too
    ],
    storage: localStorage,
    reload: () => location.reload(),
  });
document.body.appendChild(appSettingsBox.el);
registerWindow(appSettingsBox.el);
const showAppSettings = () => {
  appSettingsBox.showTab("general"); // the generic entry lands on General
  appSettingsBox.refreshTelemetry(); // fresh Gate 1 numbers each time it opens
  showWindow(appSettingsBox.el);
};

// The Local folder feature now lives as the App-settings "Folder" tab (no
// separate window). showFolder (navbar Windows menu, hidden when unsupported)
// opens App settings straight to that tab.
let showFolder: (() => void) | undefined;
if (folderSync.supported) {
  refreshFolderUI = appSettingsBox.refreshFolder;
  showFolder = () => {
    appSettingsBox.showTab("folder");
    appSettingsBox.refreshFolder();
    showWindow(appSettingsBox.el);
  };
}
// Re-attach a previously connected folder at boot (silent if still permitted).
void folderSync.restore();

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
  // no longer wipes a manual opacity, and Shaded still starts at 0 by default.
  const op = recallOpacity();
  appOpacity.set(op);
  // renderActiveBrush re-renders both boxes (reading the live opacity) and syncs
  // the navbar Connecting combo's visibility + value for this brush.
  renderActiveBrush();
  store.set("app.brush.selected", key);
  dlog("brush", "select", { key, opacity: op, erases: appState.brush.erases() });
};

// Late-bound: the Shortcuts panel is built from the shortcuts array, which
// itself needs `menu`. The Windows menu + "/" call this once it's wired.
let showShortcuts = () => {};

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
  smoothGradients: () => appState.smoothGradients,
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

const menu = buildNavbar({
  layerManager,
  viewport,
  history,
  symmetry,
  mapsControl,
  mapHighlighter,
  sizePicker,
  store,
  selectBrush,
  deleteCanvas,
  doUndo,
  doRedo,
  refreshSettingsColors,
  openColorPalette,
  setArtStyle,
  connectingComboGroups,
  showSettings,
  showLayers,
  showMaps,
  showSymmetry,
  showAppSettings,
  showFolder,
  folderSupported: folderSync.supported,
  // Late-bound: read the current `showShortcuts` at click time (it's reassigned
  // once the Shortcuts panel - which itself needs `menu` - is wired below).
  showShortcuts: () => showShortcuts(),
  initialMainColor,
  initialSecondaryColor,
  initialBrushKey,
  initialArtStyle: appState.artStyle,
  canvasMenuOptions,
});

// Ensure the only connecting brush starts on the persisted art style, then draw
// both boxes and sync the navbar Connecting combo. Apply the style's stroke-line
// opacity on first load (selectBrush() does this on later switches) so the main
// line doesn't paint opaque over the connecting web — the cause of the canvas
// darkening far faster than Harmony.
// Custom presets load async (below), so a persisted custom name isn't known yet
// — fall back to the default until presets.restore() brings it back.
brushes["Round"]?.selectArtStyle(
  hasConnection(appState.artStyle) ? appState.artStyle : DEFAULT_ART_STYLE,
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
  if (loaded && hasConnection(appState.artStyle)) setArtStyle(appState.artStyle);
});

// ---- onboarding / start page --------------------------------------------------

const ONBOARDED_KEY = "app.onboarded";
const MANDALA_BG = "#0d0e12"; // deep, near-black canvas for the mandala start

// Shared by the Start-page Mandala tile and the first-run boot. Deliberately
// leaves the symmetry panel closed (sliders hidden by default).
const startMandala = (color?: string): void => {
  const max = screenMax();
  const size = squareOfScreen(max.width, max.height);
  resetDrawing({
    size,
    undoLabel: "Mandala",
    clearHistory: true,
    resetArtStyle: true,
    resize: true,
    beforeUndo: () => {
      layerManager.setBackground({ color: MANDALA_BG, transparent: false });
      applyStageBackground();
      selectBrush("Round"); // the connecting brush that weaves the kaleidoscope
      setArtStyle("shaded"); // soft, distance-faded tone - builds up gently, not a bright bloom
      menu.setMainColor("#ffffff"); // a light stroke reads on the dark canvas
      symmetry.setMode("radial");
      const round = brushes["Round"];
      if (round) applyConnectionColor(round, mandalaConnectionColor(color));
    },
  });
};

const onboarding = createOnboarding({
  actions: {
    startMandala,
    startBlank: (variant) => {
      const max = screenMax();
      const size =
        variant === "square"
          ? squareOfScreen(max.width, max.height)
          : fullScreenSize(max.width, max.height);
      resetDrawing({
        size,
        undoLabel: "New art",
        clearHistory: true,
        resetArtStyle: true,
        resize: true,
        beforeUndo: () => {
          const { background, ink } = neutralCanvasDefaults();
          layerManager.setBackground({ color: background, transparent: false });
          applyStageBackground();
          menu.setMainColor(ink);
          symmetry.setMode("none");
        },
      });
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
      initial: appState.penEnabled,
      onChange: (on) => {
        appState.penEnabled = on;
        store.set("app.penEnabled", on);
        settingsPanel.render(appState.brush); // show/hide the Pen section live
      },
    },
  },
  onDismiss: () => store.set(ONBOARDED_KEY, true),
  onImportSettings: () => importSettings(),
});
// Lives INSIDE the viewport so it replaces the canvas area (the toolbar/panels
// stay above it), not the whole page.
viewportEl.appendChild(onboarding.el);

// The first-run "draw anywhere" cue + post-first-stroke tips strip. Started only
// on the true first-run branch below, so it never shows on later runs.
const firstRunGuide = createFirstRunGuide({ mount: viewportEl });

// First run: open straight into the mandala instead of the Start page (still
// reachable via the G shortcut), with the draw cue over the empty canvas.
// Returning users keep their canvas and see nothing.
{
  const onboarded = store.get<boolean>(ONBOARDED_KEY) === true;
  const hasPriorUse =
    store.get<unknown>("app.brush.selected") !== undefined ||
    store.get<unknown>(CANVAS_SIZE_KEY) !== undefined;
  if (shouldShowOnboarding({ onboarded, hasPriorUse })) {
    startMandala();
    store.set(ONBOARDED_KEY, true);
    firstRunGuide.start();
  } else if (!onboarded && hasPriorUse) store.set(ONBOARDED_KEY, true);
}
// Opening the Start page mid-session is a deliberate "start over", so confirm
// first. (First run goes straight to the mandala canvas above; this page is
// never auto-shown.)
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

// Lazy: shortcutsPanel.el isn't built yet, and the navbar must lead the list so
// the default restore shows only it.
const uiVisibility = createUiVisibility(() => [
  menu.el,
  settingsPanel.el,
  symmetryBox.el,
  // Layers and Maps are transient navbar-anchored subpanels (like the colour
  // picker), so they aren't part of the hide/restore-all-panels set.
  appSettingsBox.el,
  shortcutsPanel.el,
  zoomReadout.el,
]);

const shortcuts = buildAppShortcuts({
  togglePanels: (source) => uiVisibility.toggle(source),
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
  // Cmd/Ctrl+S: save to the connected folder if there is one, otherwise fall
  // back to the regular .nekudot download so Save works everywhere.
  save: () => {
    if (folderSync.isConnected()) void folderSync.syncArtwork();
    else void downloadArtwork();
  },
  recordClip,
  resetView: () => viewport.reset(),
});
const shortcutsPanel = createShortcutsPanel(shortcuts);
document.body.appendChild(shortcutsPanel.el);
registerWindow(shortcutsPanel.el);
// "/" (and the Windows menu) toggles: open when hidden, dismiss when shown.
showShortcuts = () => {
  if (shortcutsPanel.el.style.display === "none") showWindow(shortcutsPanel.el);
  else shortcutsPanel.el.style.display = "none";
};
bindShortcuts(shortcuts, { singleKeyEnabled: () => appState.singleKeyShortcuts });

createHideUiButton({ uiVisibility, store, navbar: menu.el });

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
  penEnabled: () => appState.penEnabled,
  gestureActive: () => touchGestures?.active() ?? false,
  penOnly: () => appState.penOnly, // "Pen only draws" palm rejection (App settings)
  ready: () => bootRestored, // hold input until the boot paint-restore settles
  recorder: eventRecorder, // shadow event log (no-op taps unless app.eventLog is on)
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
    // Use the brush's display label (e.g. "Web"), not its internal name ("Round").
    const label = BRUSH_DEFS.find((d) => d.name === b.name())?.label ?? b.name();
    pushUndo(`${label} stroke on ${activeLayerName()}`);
    // First-run only: surface the tips strip after the first stroke lands.
    firstRunGuide.notifyStrokeEnd();
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
  onBaked: (paste) => {
    pushUndo(`Paste image on ${activeLayerName()}`);
    layersBox.refreshPreviews();
    void recordPasteEvent(paste.file, paste.box); // vector-replay paste tap
  },
});
onViewportChange = () => {
  imagePaste.handleCameraChange();
  brushCursor.redraw(); // keep the ring under the pointer + sized to the new zoom
  zoomReadout.refresh();
};

// ---- durability on hide/close -----------------------------------------------------

// Wired last in boot: it commits the in-progress stroke + flushes the pixel log
// when the tab hides, so it needs the drawing input (assigned above).
bindDurability({ drawingInput, pixelLog, eventLog: eventRecorder, history });

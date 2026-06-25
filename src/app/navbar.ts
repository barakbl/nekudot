import {
  createMenu,
  type MenuEntry,
  type MenuGroup,
  type CanvasMenuOptions,
  type ConnectionOptionGroup,
} from "../menu";
import { BRUSH_DEFS, type BrushDef } from "../brushes/registry";
import { SYMMETRY_MODES } from "../symmetry/menu-section";
import type { SymmetryController, SymmetryMode } from "../symmetry/controller";
import { showConfirm } from "../confirm";
import type { LayerManager } from "../layered/manager";
import type { MapsControl } from "../layered/maps-box";
import type { Viewport } from "./viewport";
import type { AppHistory } from "./history";
import type { MapHighlighter } from "./map-highlight";
import type { PresetsController } from "./presets";
import type { LocalStorageStore } from "../store/local_storage";

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

// The full navbar/toolbar: the big createMenu config slab (brush pill, the three
// nav actions, colour swatches, the canvas menu, undo/redo, the Windows menu, and
// the Connecting/Maps/Symmetry combos) plus the post-build wiring that keeps the
// bar in sync (history + symmetry subscriptions) and mounts it. Returns the menu
// handle main holds for its own setters (setBrushValue, setConnectingValue, ...).
export type NavbarDeps = {
  // Live handles (read by reference - their state is read at call time).
  layerManager: LayerManager;
  viewport: Viewport;
  history: AppHistory;
  symmetry: SymmetryController;
  mapsControl: MapsControl;
  mapHighlighter: MapHighlighter;
  presets: PresetsController;
  sizePicker: { open: () => void };
  store: LocalStorageStore;
  // Stable callbacks defined in main.
  selectBrush: (key: string) => void;
  clearArtContent: () => void;
  pushUndo: (description: string) => void;
  doUndo: () => void;
  doRedo: () => void;
  refreshSettingsColors: () => void;
  openColorPalette: (target: "main" | "secondary", anchor: HTMLElement) => void;
  setArtStyle: (name: string) => void;
  connectingComboGroups: () => ConnectionOptionGroup[];
  showSettings: () => void;
  showLayers: () => void;
  showMaps: () => void;
  showSymmetry: () => void;
  showAppSettings: () => void;
  showConnecting: () => void;
  // Late-bound in main (the Shortcuts panel needs `menu` to be built first), so
  // it's passed as a wrapper that reads the current value at click time.
  showShortcuts: () => void;
  // Snapshots read once at construction.
  initialMainColor: string;
  initialSecondaryColor: string;
  initialBrushKey: string;
  initialArtStyle: string;
  canvasMenuOptions: CanvasMenuOptions;
};

export type Navbar = ReturnType<typeof createMenu>;

export function buildNavbar(deps: NavbarDeps): Navbar {
  const {
    layerManager,
    viewport,
    history,
    symmetry,
    mapsControl,
    mapHighlighter,
    presets,
    sizePicker,
    store,
    selectBrush,
    clearArtContent,
    pushUndo,
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
    showConnecting,
    showShortcuts,
    initialMainColor,
    initialSecondaryColor,
    initialBrushKey,
    initialArtStyle,
    canvasMenuOptions,
  } = deps;

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
      initial: initialArtStyle,
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
  return menu;
}

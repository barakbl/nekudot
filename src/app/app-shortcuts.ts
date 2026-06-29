import { BRUSH_DEFS } from "../brushes/registry";
import type { Shortcut } from "../shortcuts";
import { toggleHelpMode, isHelpModeOn, onHelpModeChange } from "../help";
import { showChip } from "../chip";

// Everything the global shortcut table triggers. The panel list is read lazily
// because the Shortcuts panel itself is built from the table this returns.
export type ShortcutActions = {
  // Hide / show every panel (H key, 4-finger swipe, floating button). See ui-visibility.
  togglePanels: (source: "key" | "touch") => void;
  showMaps: () => void;
  showLayers: () => void;
  showSymmetry: () => void;
  showSettings: () => void;
  showConnecting: () => void;
  showAppSettings: () => void;
  toggleCanvasMenu: () => void;
  showShortcuts: () => void;
  showStartPage: () => void; // reopen the onboarding / Start page
  selectBrush: (name: string) => void;
  undo: () => void;
  redo: () => void;
  save: () => void; // Cmd/Ctrl+S: save to the connected folder, else download
  recordClip: () => void; // start a GIF recording (arms on first stroke)
};

// The app's shortcut table (keyboard + multi-finger gestures). The Brushes
// group is generated from the registry (e.g. shortcut "1" → Digit1).
export function buildAppShortcuts(actions: ShortcutActions): Shortcut[] {
  return [
    {
      key: "h",
      group: "Panels",
      description: "Hide/show all panels",
      onPress: () => actions.togglePanels("key"),
    },
    {
      key: "m",
      group: "Panels",
      description: "Show the maps box",
      onPress: () => actions.showMaps(),
    },
    {
      key: "l",
      group: "Panels",
      description: "Show layers",
      onPress: () => actions.showLayers(),
    },
    {
      key: "y",
      group: "Panels",
      description: "Show symmetry",
      onPress: () => actions.showSymmetry(),
    },
    {
      key: "b",
      group: "Panels",
      description: "Show brush settings",
      onPress: () => actions.showSettings(),
    },
    {
      key: "c",
      group: "Panels",
      description: "Show Web settings",
      onPress: () => actions.showConnecting(),
    },
    {
      key: "s",
      group: "Panels",
      description: "Toggle more menu",
      onPress: () => actions.toggleCanvasMenu(),
    },
    {
      key: ",",
      group: "Panels",
      description: "Application settings",
      onPress: () => actions.showAppSettings(),
    },
    {
      key: "r",
      group: "Capture",
      description: "Record GIF",
      onPress: () => actions.recordClip(),
    },
    {
      key: "/",
      group: "Help",
      description: "Show/hide shortcuts",
      onPress: () => actions.showShortcuts(),
    },
    {
      key: "g",
      group: "Help",
      description: "Start page (new canvas, mandala, open a saved piece)",
      onPress: () => actions.showStartPage(),
    },
    {
      key: "?",
      group: "Help",
      description: "Help hints (? bubbles around the UI)",
      onPress: () => toggleHelpMode(),
      state: () => isHelpModeOn(),
      subscribeState: (cb) => onHelpModeChange(cb),
    },
    ...BRUSH_DEFS.filter((d) => d.shortcut).map((d) => ({
      code: `Digit${d.shortcut}`,
      shift: false,
      label: d.shortcut as string,
      group: "Brushes",
      description: `${d.name} brush`,
      onPress: () => actions.selectBrush(d.name),
    })),
    {
      key: "z",
      cmdOrCtrl: true,
      shift: false,
      label: "Z",
      group: "Edit",
      description: "Undo",
      onPress: () => actions.undo(),
    },
    {
      key: "z",
      cmdOrCtrl: true,
      shift: true,
      label: "Z",
      group: "Edit",
      description: "Redo",
      onPress: () => actions.redo(),
    },
    {
      key: "s",
      cmdOrCtrl: true,
      shift: false,
      label: "S",
      group: "Edit",
      description: "Save artwork (to the folder if connected, else download)",
      onPress: () => actions.save(),
    },
    {
      // Display-only: the actual paste is handled by the native clipboard
      // `paste` event (see app/image-paste), which carries the image data a
      // keydown can't read. With no key/code the matcher never intercepts
      // Cmd/Ctrl+V (which would suppress that paste event); the row just hints
      // how to use it.
      cmdOrCtrl: true,
      label: "V",
      group: "Edit",
      description: "Paste image",
      onPress: () =>
        showChip("Copy an image, then paste (⌘/Ctrl+V) to place it on the canvas"),
    },
    {
      fingers: 2,
      group: "Edit",
      description: "Undo",
      onPress: () => actions.undo(),
    },
    {
      fingers: 3,
      group: "Edit",
      description: "Redo",
      onPress: () => actions.redo(),
    },
    {
      fingers: 4,
      swipe: "up",
      group: "Panels",
      description: "Hide/show all panels",
      onPress: () => actions.togglePanels("touch"),
    },
  ];
}

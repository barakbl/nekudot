import { BRUSH_DEFS } from "../brushes/registry";
import type { Shortcut } from "../shortcuts";
import { toggleHelpMode } from "../help";
import { showChip } from "../chip";

// Everything the global shortcut table triggers. The panel list is read lazily
// because the Shortcuts panel itself is built from the table this returns.
export type ShortcutActions = {
  panels: () => HTMLElement[]; // hidden/restored by `h` + the 4-finger swipe
  showMaps: () => void;
  showLayers: () => void;
  showSymmetry: () => void;
  showSettings: () => void;
  showConnecting: () => void;
  toggleCanvasMenu: () => void;
  showShortcuts: () => void;
  selectBrush: (name: string) => void;
  undo: () => void;
  redo: () => void;
};

// The app's shortcut table (keyboard + multi-finger gestures). The Brushes
// group is generated from the registry (e.g. shortcut "1" → Digit1).
export function buildAppShortcuts(actions: ShortcutActions): Shortcut[] {
  let savedPanelState: boolean[] | null = null;

  // Shared by the `h` key and the 4-finger swipe-up gesture. Hides every panel
  // (remembering which were open) or restores them; flashes a hint when hiding.
  const toggleAllPanels = (source: "key" | "touch") => {
    const panels = actions.panels();
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
      // Default restore: just the navbar (the panels list leads with it).
      const restore = savedPanelState ?? panels.map((_, i) => i === 0);
      panels.forEach((el, i) => {
        el.style.display = restore[i] ? "" : "none";
      });
      savedPanelState = null;
    }
  };

  return [
    {
      key: "h",
      group: "Panels",
      description: "Hide/show all panels",
      onPress: () => toggleAllPanels("key"),
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
      description: "Show connecting settings",
      onPress: () => actions.showConnecting(),
    },
    {
      key: "s",
      group: "Panels",
      description: "Toggle more menu",
      onPress: () => actions.toggleCanvasMenu(),
    },
    {
      key: "/",
      group: "Help",
      description: "Show/hide shortcuts",
      onPress: () => actions.showShortcuts(),
    },
    {
      key: "?",
      group: "Help",
      description: "Toggle help hints",
      onPress: () => toggleHelpMode(),
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
      onPress: () => toggleAllPanels("touch"),
    },
  ];
}

// @vitest-environment happy-dom
//
// Importing app-shortcuts pulls in help.ts/chip.ts, which register document-level
// listeners at module load, so this file runs under happy-dom (like
// brush-preview.test.ts). The test itself only inspects the built shortcut table.
import { describe, it, expect } from "vitest";
import {
  buildAppShortcuts,
  type ShortcutActions,
} from "../src/app/app-shortcuts";

const noop = () => {};
const actions: ShortcutActions = {
  panels: () => [],
  showMaps: noop,
  showLayers: noop,
  showSymmetry: noop,
  showSettings: noop,
  showConnecting: noop,
  showAppSettings: noop,
  toggleCanvasMenu: noop,
  showShortcuts: noop,
  showStartPage: noop,
  selectBrush: noop,
  undo: noop,
  redo: noop,
  recordClip: noop,
};

// The Cmd/Ctrl+V "Paste image" row is deliberately inert: it has no key/code so
// the shortcut matcher never intercepts the keystroke, leaving the browser's
// native clipboard `paste` event to deliver the image (see app/image-paste).
// Giving it a key would preventDefault the paste and silently break image paste.
describe("app shortcuts: the paste row stays inert", () => {
  it("the Paste image row has no key and no code", () => {
    const rows = buildAppShortcuts(actions);
    const paste = rows.find((r) => r.description === "Paste image");

    expect(paste).toBeDefined();
    expect(paste?.key).toBeUndefined();
    expect(paste?.code).toBeUndefined();
    expect(paste?.cmdOrCtrl).toBe(true);
  });
});

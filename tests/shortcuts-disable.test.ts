// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from "vitest";
import { bindShortcuts, type Shortcut } from "../src/shortcuts";

// WCAG 2.1.4: bare character-key shortcuts must be switchable off, while
// Cmd/Ctrl combos (exempt) keep working.
describe("single-key shortcut disabling", () => {
  let unbind: (() => void) | undefined;
  afterEach(() => unbind?.());

  function setup(enabled: boolean) {
    const fired: string[] = [];
    const shortcuts: Shortcut[] = [
      { key: "b", onPress: () => fired.push("b") },
      { key: "z", cmdOrCtrl: true, onPress: () => fired.push("undo") },
    ];
    unbind = bindShortcuts(shortcuts, { singleKeyEnabled: () => enabled });
    return fired;
  }

  it("fires bare character keys when enabled", () => {
    const fired = setup(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
    expect(fired).toContain("b");
  });

  it("suppresses bare character keys when disabled but keeps Cmd/Ctrl ones", () => {
    const fired = setup(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
    expect(fired).not.toContain("b"); // character key ignored
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true }),
    );
    expect(fired).toContain("undo"); // exempt shortcut still works
  });

  it("defaults to enabled when no predicate is given", () => {
    const fired: string[] = [];
    unbind = bindShortcuts([{ key: "b", onPress: () => fired.push("b") }]);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
    expect(fired).toContain("b");
  });
});

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { showPrompt, showConfirm } from "../src/confirm";

// End-to-end behaviour of the dialogs, to confirm the createModal refactor kept
// the per-dialog Escape/Enter and empty/destructive guards intact.
beforeEach(() => {
  document.body.innerHTML = "";
});

const open = () => document.querySelector(".confirm-modal");
const input = () => document.querySelector(".confirm-input") as HTMLInputElement;
const keydown = (key: string) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key }));

describe("confirm dialogs (via createModal)", () => {
  it("showPrompt: empty Enter keeps it open; a value confirms (trimmed) and closes", () => {
    let confirmed: string | null = null;
    showPrompt({ onConfirm: (v) => { confirmed = v; } });

    keydown("Enter"); // empty -> guarded
    expect(confirmed).toBe(null);
    expect(open()).not.toBeNull();

    input().value = "  hello  ";
    keydown("Enter");
    expect(confirmed).toBe("hello"); // trimmed
    expect(open()).toBeNull(); // closed
  });

  it("showPrompt: Escape cancels and closes", () => {
    let cancelled = false;
    showPrompt({ onConfirm: () => {}, onCancel: () => { cancelled = true; } });
    keydown("Escape");
    expect(cancelled).toBe(true);
    expect(open()).toBeNull();
  });

  it("showConfirm destructive: Enter routes to onCancel, never onConfirm", () => {
    let confirmed = false;
    let cancelled = false;
    showConfirm({
      message: "Delete everything?",
      destructive: true,
      onConfirm: () => { confirmed = true; },
      onCancel: () => { cancelled = true; },
    });
    keydown("Enter");
    expect(confirmed).toBe(false);
    expect(cancelled).toBe(true);
    expect(open()).toBeNull();
  });

  it("showConfirm non-destructive: Enter confirms", () => {
    let confirmed = false;
    showConfirm({ message: "Proceed?", onConfirm: () => { confirmed = true; } });
    keydown("Enter");
    expect(confirmed).toBe(true);
    expect(open()).toBeNull();
  });
});

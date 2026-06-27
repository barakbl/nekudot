// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { attachHelp, setHelpMode } from "../src/help";

beforeEach(() => {
  document.body.replaceChildren();
  document.body.className = "";
});

describe("help chips keyboard access", () => {
  it("are focusable buttons with an accessible name", () => {
    const target = document.createElement("span");
    document.body.appendChild(target);
    const icon = attachHelp(target, "Explain");
    expect(icon.getAttribute("role")).toBe("button");
    expect(icon.getAttribute("aria-label")).toBe("Help");
    expect(icon.tabIndex).toBe(0);
  });

  it("Enter toggles the hint when help mode is on", () => {
    const target = document.createElement("span");
    document.body.appendChild(target);
    const icon = attachHelp(target, "Explain this");
    setHelpMode(true);

    icon.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.querySelector(".help-tooltip")?.textContent).toBe("Explain this");

    icon.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(document.querySelector(".help-tooltip")).toBeNull();
    setHelpMode(false);
  });
});

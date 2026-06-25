// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { createPanel } from "../src/ui/panel";

describe("createPanel", () => {
  it("builds a hidden panel whose first child is a .panel-header (h3 title + close)", () => {
    const { panel, header } = createPanel({
      className: "my-panel foo",
      title: "Hello",
    });
    expect(panel.className).toBe("my-panel foo");
    expect(panel.style.display).toBe("none");
    expect(panel.firstChild).toBe(header);
    expect(header.classList.contains("panel-header")).toBe(true);
    // makeDraggable marks the header as the drag handle (same as before the refactor).
    expect(header.classList.contains("drag-handle")).toBe(true);
    expect(header.querySelector("h3")?.textContent).toBe("Hello");
    expect(header.querySelector(".panel-close-btn")).not.toBeNull();
  });

  it("the close button hides the panel by default", () => {
    const { panel, header } = createPanel({ className: "p", title: "T" });
    panel.style.display = "block"; // simulate the panel being opened
    (header.querySelector(".panel-close-btn") as HTMLElement).click();
    expect(panel.style.display).toBe("none");
  });

  it("onClose overrides the default close behaviour", () => {
    let closed = false;
    const { header } = createPanel({
      className: "p",
      title: "T",
      onClose: () => {
        closed = true;
      },
    });
    (header.querySelector(".panel-close-btn") as HTMLElement).click();
    expect(closed).toBe(true);
  });
});

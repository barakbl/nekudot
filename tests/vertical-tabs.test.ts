// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { createVerticalTabs } from "../src/ui/vertical-tabs";

const body = (text: string) => {
  const d = document.createElement("div");
  d.textContent = text;
  return d;
};
const make = () =>
  createVerticalTabs([
    { id: "a", label: "Alpha", content: body("A body") },
    { id: "b", label: "Beta", content: body("B body") },
  ]);
const panels = (root: HTMLElement) =>
  [...root.querySelectorAll(".vtab-panel")] as HTMLElement[];
const tabs = (root: HTMLElement) =>
  [...root.querySelectorAll(".vtab")] as HTMLButtonElement[];

describe("vertical tabs", () => {
  it("shows the first tab by default", () => {
    const t = make();
    expect(t.active()).toBe("a");
    const [pa, pb] = panels(t.el);
    expect(pa.style.display).toBe("");
    expect(pb.style.display).toBe("none");
    expect(tabs(t.el)[0].getAttribute("aria-selected")).toBe("true");
  });

  it("switches the visible panel on show() and on click", () => {
    const t = make();
    t.show("b");
    expect(t.active()).toBe("b");
    const [pa, pb] = panels(t.el);
    expect(pa.style.display).toBe("none");
    expect(pb.style.display).toBe("");
    tabs(t.el)[0].click(); // click the first tab -> back to a
    expect(t.active()).toBe("a");
  });

  it("moves between tabs with the Down arrow (roving focus)", () => {
    const t = make();
    tabs(t.el)[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    expect(t.active()).toBe("b");
  });

  it("ignores an unknown id", () => {
    const t = make();
    t.show("nope");
    expect(t.active()).toBe("a");
  });
});

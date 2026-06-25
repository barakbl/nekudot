// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { closeOnOutsidePointer } from "../src/ui/popover";

function setup() {
  document.body.innerHTML = "";
  const container = document.createElement("div"); // wrapper: trigger + popover
  const trigger = document.createElement("button");
  const popover = document.createElement("div");
  popover.className = "open";
  container.append(trigger, popover);
  const outside = document.createElement("div");
  document.body.append(container, outside);
  closeOnOutsidePointer(container, popover);
  return { trigger, popover, outside };
}

const mousedownOn = (el: Element) =>
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

describe("closeOnOutsidePointer", () => {
  it("closes (removes 'open') on a mousedown outside the container", () => {
    const { popover, outside } = setup();
    expect(popover.classList.contains("open")).toBe(true);
    mousedownOn(outside);
    expect(popover.classList.contains("open")).toBe(false);
  });

  it("keeps the popover open on a mousedown inside the container", () => {
    const { popover, trigger } = setup();
    mousedownOn(trigger);
    expect(popover.classList.contains("open")).toBe(true);
  });

  it("is a no-op while the popover is already closed", () => {
    const { popover, outside } = setup();
    popover.classList.remove("open");
    expect(() => mousedownOn(outside)).not.toThrow();
    expect(popover.classList.contains("open")).toBe(false);
  });
});

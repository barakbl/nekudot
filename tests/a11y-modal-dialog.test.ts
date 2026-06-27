// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { trapFocus, getFocusable } from "../src/ui/focus-trap";
import { createModal } from "../src/ui/modal";
import { createSizePicker } from "../src/layered/size-picker";

beforeEach(() => {
  document.body.innerHTML = "";
});

// queueMicrotask in createModal arms the dialog naming + focus trap; flush it.
const flush = () => Promise.resolve().then(() => Promise.resolve());

const tab = (el: Element, shift = false): void =>
  void el.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: shift,
      bubbles: true,
      cancelable: true,
    }),
  );

const pressEscape = (): void =>
  void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

function dialogWith(n: number): {
  box: HTMLElement;
  btns: HTMLButtonElement[];
} {
  const box = document.createElement("div");
  box.tabIndex = -1;
  const btns: HTMLButtonElement[] = [];
  for (let i = 0; i < n; i++) {
    const b = document.createElement("button");
    b.textContent = `b${i}`;
    box.appendChild(b);
    btns.push(b);
  }
  document.body.appendChild(box);
  return { box, btns };
}

describe("trapFocus", () => {
  it("collects only the tabbable descendants", () => {
    const { box } = dialogWith(2);
    const disabled = document.createElement("button");
    disabled.disabled = true;
    box.appendChild(disabled);
    expect(getFocusable(box)).toHaveLength(2);
  });

  it("moves focus to the first focusable when nothing inside is focused", () => {
    const { box, btns } = dialogWith(2);
    trapFocus(box);
    expect(document.activeElement).toBe(btns[0]);
  });

  it("wraps Tab from the last element back to the first", () => {
    const { box, btns } = dialogWith(3);
    btns[2].focus();
    trapFocus(box);
    tab(btns[2]);
    expect(document.activeElement).toBe(btns[0]);
  });

  it("wraps Shift+Tab from the first element to the last", () => {
    const { box, btns } = dialogWith(3);
    btns[0].focus();
    trapFocus(box);
    tab(btns[0], true);
    expect(document.activeElement).toBe(btns[2]);
  });

  it("restores focus to the trigger on release", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const { box } = dialogWith(2);
    const trap = trapFocus(box); // captures the trigger as restore target
    expect(document.activeElement).not.toBe(trigger);
    trap.release();
    expect(document.activeElement).toBe(trigger);
  });
});

describe("createModal dialog semantics", () => {
  it("marks the card as a modal dialog and names it from its heading", async () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const { card, close } = createModal();
    expect(card.getAttribute("role")).toBe("dialog");
    expect(card.getAttribute("aria-modal")).toBe("true");

    const h = document.createElement("h3");
    h.textContent = "Are you sure?";
    card.appendChild(h);
    const btn = document.createElement("button");
    card.appendChild(btn);

    await flush();
    expect(h.id).toBeTruthy();
    expect(card.getAttribute("aria-labelledby")).toBe(h.id);
    expect(card.contains(document.activeElement)).toBe(true); // focus pulled in

    close();
    expect(document.activeElement).toBe(trigger); // focus handed back
  });
});

describe("size picker accessibility", () => {
  const opts = {
    getScreenMax: () => ({ width: 1000, height: 800 }),
    onConfirm: () => {},
  };

  it("exposes dialog semantics on the card", () => {
    const { el } = createSizePicker(opts);
    const card = el.querySelector(".size-picker-card") as HTMLElement;
    expect(card.getAttribute("role")).toBe("dialog");
    expect(card.getAttribute("aria-modal")).toBe("true");
    expect(card.getAttribute("aria-labelledby")).toBe("size-picker-title");
  });

  it("Escape closes it and focus returns to the trigger", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const { el, open } = createSizePicker(opts);
    document.body.appendChild(el);
    open();
    expect(el.style.display).toBe("flex");

    pressEscape();
    expect(el.style.display).toBe("none");
    expect(document.activeElement).toBe(trigger);
  });
});

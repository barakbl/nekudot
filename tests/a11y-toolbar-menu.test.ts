// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { attachMenu } from "../src/ui/menu";
import { createMenu } from "../src/menu";

const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }));
const click = (el: Element) =>
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

function buildMenu(n = 3) {
  document.body.innerHTML = "";
  const container = document.createElement("div");
  const trigger = document.createElement("button");
  const menu = document.createElement("div");
  for (let i = 0; i < n; i++) {
    const it = document.createElement("button");
    it.setAttribute("role", "menuitem");
    it.textContent = `item ${i}`;
    menu.appendChild(it);
  }
  container.append(trigger, menu);
  document.body.appendChild(container);
  const ctrl = attachMenu({ trigger, menu, container });
  const items = Array.from(menu.querySelectorAll<HTMLElement>("[role=menuitem]"));
  return { container, trigger, menu, ctrl, items };
}

describe("attachMenu - ARIA roles + state", () => {
  it("marks the trigger as a menu button and the popover as a menu", () => {
    const { trigger, menu } = buildMenu();
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(menu.getAttribute("role")).toBe("menu");
  });

  it("a click on the trigger toggles the menu and aria-expanded", () => {
    const { trigger, menu } = buildMenu();
    click(trigger);
    expect(menu.classList.contains("open")).toBe(true);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    click(trigger);
    expect(menu.classList.contains("open")).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("attachMenu - keyboard", () => {
  it("ArrowDown / Enter / Space on the trigger opens and focuses the first item", () => {
    for (const k of ["ArrowDown", "Enter", " "]) {
      const { trigger, menu, items } = buildMenu();
      key(trigger, k);
      expect(menu.classList.contains("open")).toBe(true);
      expect(document.activeElement).toBe(items[0]);
      expect(items[0].tabIndex).toBe(0);
    }
  });

  it("ArrowUp on the trigger opens and focuses the last item", () => {
    const { trigger, items } = buildMenu();
    key(trigger, "ArrowUp");
    expect(document.activeElement).toBe(items[2]);
  });

  it("Up/Down wrap, Home/End jump", () => {
    const { trigger, items } = buildMenu();
    key(trigger, "ArrowDown"); // focus item 0
    key(items[0], "ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    key(items[1], "End");
    expect(document.activeElement).toBe(items[2]);
    key(items[2], "ArrowDown"); // wrap to first
    expect(document.activeElement).toBe(items[0]);
    key(items[0], "ArrowUp"); // wrap to last
    expect(document.activeElement).toBe(items[2]);
    key(items[2], "Home");
    expect(document.activeElement).toBe(items[0]);
  });

  it("Enter / Space activate the focused item by clicking it", () => {
    const { trigger, items } = buildMenu();
    let clicks = 0;
    items[1].addEventListener("click", () => clicks++);
    key(trigger, "ArrowDown");
    key(items[0], "ArrowDown"); // focus item 1
    key(items[1], "Enter");
    expect(clicks).toBe(1);
    key(items[1], " ");
    expect(clicks).toBe(2);
  });

  it("Escape closes and returns focus to the trigger", () => {
    const { trigger, menu, items } = buildMenu();
    key(trigger, "ArrowDown");
    expect(document.activeElement).toBe(items[0]);
    key(items[0], "Escape");
    expect(menu.classList.contains("open")).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it("skips disabled items in the roving order", () => {
    const { trigger, items } = buildMenu();
    (items[1] as HTMLButtonElement).disabled = true;
    key(trigger, "ArrowDown"); // item 0
    key(items[0], "ArrowDown"); // would be item 1, but it is disabled -> item 2
    expect(document.activeElement).toBe(items[2]);
  });
});

describe("attachMenu - mouse dismissal", () => {
  it("closes on a mousedown outside the container", () => {
    const { menu, container } = buildMenu();
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    click(container.firstElementChild as Element); // open via trigger
    expect(menu.classList.contains("open")).toBe(true);
    outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menu.classList.contains("open")).toBe(false);
  });
});

describe("createMenu - toolbar wired through the primitive", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  function makeBar() {
    const changed: string[] = [];
    const menu = createMenu(
      [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }],
      (v) => changed.push(v),
      [],
      {
        main: { initial: "#112233", onChange: () => {} },
        secondary: { initial: "#445566", onChange: () => {} },
      },
      "a",
      () => {},
      {
        onShareImage: () => {},
        onExportImage: () => {},
        onRecordClip: () => {},
        onSaveArtwork: () => {},
        onLoadArtwork: () => {},
      },
    );
    document.body.appendChild(menu.el);
    return { menu, changed };
  }

  it("renders the brush pill as a real menu-button with menuitem rows", () => {
    const { menu } = makeBar();
    const trigger = menu.el.querySelector<HTMLButtonElement>(
      ".brush-pill .brush-pill-trigger",
    );
    expect(trigger).toBeTruthy();
    expect(trigger?.tagName).toBe("BUTTON");
    expect(trigger?.getAttribute("aria-haspopup")).toBe("menu");
    const opts = menu.el.querySelectorAll(".brush-pill .brush-option");
    expect(opts.length).toBe(2);
    for (const o of opts) expect(o.getAttribute("role")).toBe("menuitemradio");
  });

  it("opens the brush menu from the keyboard and selects with Enter", () => {
    const { menu, changed } = makeBar();
    const trigger = menu.el.querySelector<HTMLButtonElement>(
      ".brush-pill .brush-pill-trigger",
    );
    if (!trigger) throw new Error("no brush trigger");
    key(trigger, "ArrowDown");
    const popover = menu.el.querySelector(".brush-pill .brush-popover");
    expect(popover?.classList.contains("open")).toBe(true);
    const focused = document.activeElement as HTMLElement;
    expect(focused.classList.contains("brush-option")).toBe(true);
    key(focused, "ArrowDown"); // move to Beta
    key(document.activeElement as HTMLElement, "Enter");
    expect(changed).toContain("b");
    expect(popover?.classList.contains("open")).toBe(false);
  });

  it("makes the colour swatches accessible buttons", () => {
    const { menu } = makeBar();
    const front = menu.el.querySelector<HTMLButtonElement>(".swatch-front");
    const back = menu.el.querySelector<HTMLButtonElement>(".swatch-back");
    expect(front?.tagName).toBe("BUTTON");
    expect(back?.tagName).toBe("BUTTON");
    expect(front?.getAttribute("aria-label")).toMatch(/Main color/);
    expect(back?.getAttribute("aria-label")).toMatch(/Secondary color/);
  });

  it("swaps colours from the keyboard with Shift+Enter", () => {
    const { menu } = makeBar();
    const front = menu.el.querySelector<HTMLButtonElement>(".swatch-front");
    const back = menu.el.querySelector<HTMLButtonElement>(".swatch-back");
    if (!front || !back) throw new Error("no swatches");
    expect(front.getAttribute("aria-label")).toMatch(/#112233/i);
    expect(back.getAttribute("aria-label")).toMatch(/#445566/i);
    key(front, "Enter", { shiftKey: true });
    expect(front.getAttribute("aria-label")).toMatch(/#445566/i);
    expect(back.getAttribute("aria-label")).toMatch(/#112233/i);
  });

  it("makes the '...' menu a keyboard-reachable menu (Share/Export included)", () => {
    const { menu } = makeBar();
    const btn = menu.el.querySelector<HTMLButtonElement>(".canvas-menu-btn");
    expect(btn?.getAttribute("aria-haspopup")).toBe("menu");
    const rows = Array.from(
      menu.el.querySelectorAll(".canvas-menu-popover .brush-option"),
    );
    const labels = rows.map((r) => r.querySelector(".opt-label")?.textContent);
    expect(labels).toContain("Share as PNG");
    expect(labels).toContain("Export image (.png)");
    for (const r of rows) expect(r.getAttribute("role")).toBe("menuitem");
  });
});

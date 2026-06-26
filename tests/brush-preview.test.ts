// @vitest-environment happy-dom
//
// Behavioural unit test for the brush-preview window: a single free-draw
// Playground (no scene tabs, no replay, no speed dial). open() reveals the
// window; drawing on the canvas runs the current brush; onSettingChanged updates
// the "what changed" hint line but never replays/interrupts; the × closes it.
// happy-dom has no real 2D canvas, so we stub a no-op context.

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createBrushPreview } from "../src/brush-preview";
import type { BrushBase } from "../src/base";
import type { PaintHost } from "../src/paint-host";
import type { Store } from "../src/store/base";

// In-memory store for the persisted background choice.
function memStore(): Store {
  const m = new Map<string, unknown>();
  return {
    get: <T>(k: string) => m.get(k) as T | undefined,
    set: <T>(k: string, v: T) => void m.set(k, v),
  } as Store;
}

function fakeCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  return new Proxy(
    { canvas },
    {
      get: (t, p) => (p === "canvas" ? t.canvas : () => {}),
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      return fakeCtx(this);
    } as never,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function setup(over: Partial<Parameters<typeof createBrushPreview>[0]> = {}) {
  const calls = { make: 0, start: 0, stroke: 0, end: 0 };
  let lastHost: PaintHost | null = null;
  const preview = createBrushPreview({
    makeBrush: (h) => {
      calls.make++;
      lastHost = h;
      return {
        strokeStart: () => calls.start++,
        stroke: () => calls.stroke++,
        strokeEnd: () => calls.end++,
      } as unknown as BrushBase;
    },
    size: () => 5,
    alpha: () => 0.5,
    color: () => "#000000",
    background: () => "#eeeeee",
    dpr: 1,
    store: memStore(),
    ...over,
  });
  return { preview, calls, host: () => lastHost };
}

const win = () => document.querySelector(".brush-preview-window") as HTMLElement | null;
const canvases = () => [...document.querySelectorAll<HTMLCanvasElement>(".brush-preview-canvas")];
const info = () => document.querySelector(".brush-preview-info")?.textContent ?? "";

function draw(): HTMLCanvasElement {
  const pg = canvases()[0];
  pg.dispatchEvent(new MouseEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true }));
  pg.dispatchEvent(new MouseEvent("pointermove", { clientX: 30, clientY: 24, bubbles: true }));
  pg.dispatchEvent(new MouseEvent("pointerup", { clientX: 30, clientY: 24, bubbles: true }));
  return pg;
}

describe("brush preview window (playground only)", () => {
  it("open() reveals a single-canvas window with no tabs, scenes or speed dial", () => {
    const { preview, calls } = setup();
    preview.open();
    expect(win()).not.toBeNull();
    expect(win()!.classList.contains("app-modal")).toBe(true); // disables app shortcuts
    expect(canvases()).toHaveLength(1);
    expect(document.querySelectorAll(".brush-preview-tab")).toHaveLength(0); // no tabs
    expect(document.querySelector(".brush-preview-speed")).toBeNull(); // no speed dial
    expect(calls.make).toBe(0); // nothing auto-plays - a blank playground
    expect(info()).toMatch(/draw here/i);
  });

  it("drawing on the canvas runs the current brush at the live Size / Opacity", () => {
    const { preview, calls, host } = setup();
    preview.open();
    draw();
    expect(calls.make).toBe(1); // one fresh brush for the stroke
    expect(calls.start).toBeGreaterThanOrEqual(1);
    expect(calls.stroke).toBeGreaterThanOrEqual(2); // initial dab + move
    expect(calls.end).toBeGreaterThanOrEqual(1);
    // The demo host carries the live Size / Opacity.
    expect(host()?.strokeWidth()).toBe(5);
    expect(host()?.strokeAlpha()).toBe(0.5);
  });

  it("onSettingChanged updates the hint line only while open, and never draws", () => {
    const { preview, calls } = setup();
    preview.onSettingChanged({ label: "Spread", value: "6", help: "fans the hairs" });
    expect(win()).toBeNull(); // closed -> nothing built

    preview.open();
    expect(info()).toMatch(/draw here/i); // no change shown yet
    preview.onSettingChanged({ label: "Spread", value: "6", help: "fans the hairs" });
    expect(info()).toContain("Spread");
    expect(info()).toContain("6");
    expect(calls.make).toBe(0); // a setting change never replays / interrupts
  });

  it("the × closes the window", () => {
    const { preview } = setup();
    preview.open();
    win()!.querySelector<HTMLButtonElement>(".panel-close-btn")!.click();
    expect(win()!.style.display).toBe("none");
  });

  it("defaults to the canvas background and switches between Canvas/Light/Dark", () => {
    const store = memStore();
    const { preview } = setup({ store, background: () => "#eeeeee" });
    preview.open();
    const bgBtns = [...document.querySelectorAll<HTMLElement>(".brush-preview-bgbtn")];
    expect(bgBtns).toHaveLength(3); // Canvas / Light / Dark
    expect(canvases()[0].style.backgroundColor).toBe("#eeeeee"); // default = artwork bg
    bgBtns[2].click(); // dark
    expect(store.get("app.brushPreview.bg")).toBe("dark");
    expect(canvases()[0].style.backgroundColor).toBe("#16161a");
    bgBtns[0].click(); // back to canvas
    expect(store.get("app.brushPreview.bg")).toBe("canvas");
    expect(canvases()[0].style.backgroundColor).toBe("#eeeeee");
  });

  it("Clear wipes the playground without re-running the brush", () => {
    const { preview, calls } = setup();
    preview.open();
    draw();
    const clear = win()!.querySelector<HTMLButtonElement>(".brush-preview-clear");
    expect(clear).not.toBeNull();
    clear!.click(); // resets the canvas + point cloud
    expect(calls.make).toBe(1); // clearing doesn't run the brush again
  });

  it("shows rotating footer tips with prev/next", () => {
    const { preview } = setup();
    preview.open();
    const text = () => document.querySelector(".brush-preview-tip-text")?.textContent ?? "";
    const navs = [...document.querySelectorAll<HTMLElement>(".brush-preview-tip-nav")];
    expect(navs).toHaveLength(2); // ← prev, → next
    const first = text();
    expect(first.length).toBeGreaterThan(0);
    navs[1].click(); // next
    expect(text()).not.toBe(first);
    navs[0].click(); // prev → back to the first
    expect(text()).toBe(first);
  });
});

// @vitest-environment happy-dom
//
// Behavioural unit test for the brush-preview window controller: open() reveals a
// two-tab window and replays a scripted stroke; onSettingChanged() replays only
// while open; the × closes it; the Playground tab draws with the current brush.
// happy-dom has no real 2D canvas, so we stub a no-op context and force
// reduced-motion (synchronous playback, no rAF).

import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createBrushPreview } from "../src/brush-preview";
import type { BrushBase } from "../src/base";
import type { PaintHost } from "../src/paint-host";
import type { Store } from "../src/store/base";

// In-memory store for the persisted scene tab.
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
  vi.useFakeTimers();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) {
      return fakeCtx(this);
    } as never,
  );
  vi.stubGlobal("matchMedia", () => ({ matches: true }) as never); // reduced motion → synchronous
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
const tabs = () => [...document.querySelectorAll<HTMLElement>(".brush-preview-tab")];
const canvases = () => [...document.querySelectorAll<HTMLCanvasElement>(".brush-preview-canvas")];

describe("brush preview window", () => {
  it("open() reveals scene tabs (+ Playground last) and plays the active scene", () => {
    const { preview, calls, host } = setup();
    preview.open();
    expect(win()).not.toBeNull();
    expect(win()!.classList.contains("app-modal")).toBe(true); // disables app shortcuts
    expect(tabs().map((t) => t.textContent)).toEqual([
      "Wave",
      "Circles",
      "Spiral",
      "Scribble",
      "Playground",
    ]);
    expect(canvases()).toHaveLength(2);
    expect(calls.make).toBeGreaterThanOrEqual(1);
    expect(calls.start).toBeGreaterThanOrEqual(1);
    expect(calls.stroke).toBeGreaterThan(0);
    expect(calls.end).toBeGreaterThanOrEqual(1);
    // The demo host carries the live Size / Opacity.
    expect(host()?.strokeWidth()).toBe(5);
    expect(host()?.strokeAlpha()).toBe(0.5);
  });

  it("switching scene tabs replays that scene and persists it", () => {
    const store = memStore();
    const { preview, calls } = setup({ store });
    preview.open();
    const after = calls.make;
    tabs().find((t) => t.textContent === "Spiral")!.click();
    expect(calls.make).toBe(after + 1); // re-ran for the new scene
    expect(store.get("app.brushPreview.scene")).toBe("spiral");
  });

  it("onSettingChanged replays only while open, and never on Playground", () => {
    const { preview, calls } = setup();
    preview.onSettingChanged();
    vi.advanceTimersByTime(300);
    expect(calls.make).toBe(0); // closed → nothing

    preview.open();
    let after = calls.make;
    preview.onSettingChanged();
    preview.onSettingChanged();
    expect(calls.make).toBe(after); // debounced
    vi.advanceTimersByTime(200);
    expect(calls.make).toBe(after + 1); // one replay for the burst

    tabs().find((t) => t.textContent === "Playground")!.click();
    after = calls.make;
    preview.onSettingChanged();
    vi.advanceTimersByTime(300);
    expect(calls.make).toBe(after); // on Playground → ignored
  });

  it("the × closes the window and stops replays", () => {
    const { preview, calls } = setup();
    preview.open();
    win()!.querySelector<HTMLButtonElement>(".panel-close-btn")!.click();
    expect(win()!.style.display).toBe("none");
    const after = calls.make;
    preview.onSettingChanged();
    vi.advanceTimersByTime(300);
    expect(calls.make).toBe(after); // no replay once closed
  });

  it("defaults to the canvas background and switches between Canvas/Light/Dark", () => {
    const store = memStore();
    const { preview } = setup({ store, background: () => "#eeeeee" });
    preview.open();
    const bgBtns = [...document.querySelectorAll<HTMLElement>(".brush-preview-bgbtn")];
    expect(bgBtns).toHaveLength(3); // Canvas / Light / Dark
    // Default is "canvas" → matches the artwork background.
    for (const cv of canvases()) expect(cv.style.backgroundColor).toBe("#eeeeee");
    bgBtns[2].click(); // dark
    expect(store.get("app.brushPreview.bg")).toBe("dark");
    for (const cv of canvases()) expect(cv.style.backgroundColor).toBe("#16161a");
    bgBtns[0].click(); // back to canvas
    expect(store.get("app.brushPreview.bg")).toBe("canvas");
    for (const cv of canvases()) expect(cv.style.backgroundColor).toBe("#eeeeee");
  });

  it("prompts until a change, then shows the change (with hint) on every tab", () => {
    const { preview } = setup();
    preview.open();
    const info = () => document.querySelector(".brush-preview-info")?.textContent ?? "";
    expect(info()).toMatch(/move a slider/i); // scene, no change yet
    tabs().find((t) => t.textContent === "Playground")!.click();
    expect(info()).toMatch(/draw here/i); // playground invite, still no change
    // A change shows on Playground too, so the hint is readable while drawing.
    preview.onSettingChanged({ label: "Spread", value: "6", help: "fans the hairs" });
    expect(info()).toContain("Spread");
    tabs().find((t) => t.textContent === "Wave")!.click();
    expect(info()).toContain("Spread"); // and on scenes
  });

  it("has a play-speed slider", () => {
    const { preview } = setup();
    preview.open();
    expect(document.querySelector(".brush-preview-speed input[type=range]")).not.toBeNull();
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

  it("the Playground tab draws with the current brush", () => {
    const { preview, calls } = setup();
    preview.open();
    tabs().find((t) => t.textContent === "Playground")!.click();
    const pg = canvases()[1];
    const before = calls.make;
    pg.dispatchEvent(new MouseEvent("pointerdown", { clientX: 10, clientY: 10, bubbles: true }));
    pg.dispatchEvent(new MouseEvent("pointermove", { clientX: 30, clientY: 24, bubbles: true }));
    pg.dispatchEvent(new MouseEvent("pointerup", { clientX: 30, clientY: 24, bubbles: true }));
    expect(calls.make).toBe(before + 1); // one brush for the stroke
    expect(calls.start).toBeGreaterThanOrEqual(1);
    expect(calls.stroke).toBeGreaterThanOrEqual(2); // initial dab + move
    expect(calls.end).toBeGreaterThanOrEqual(1);
  });
});

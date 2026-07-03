// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { buildAppShortcuts, type ShortcutActions } from "../src/app/app-shortcuts";
import { createZoomReadout } from "../src/app/zoom-readout";
import type { Viewport } from "../src/app/viewport";

// The camera (zoom/pan/rotate) was implemented but had no keyboard hints and no
// zoom readout, so testers thought desktop zoom didn't exist. These lock the two
// surfaces the fix adds: a "View" group in the Shortcuts panel, and a click-to-
// reset zoom % pill.

function stubActions(): ShortcutActions {
  const keys = [
    "togglePanels", "showMaps", "showLayers", "showSymmetry", "showSettings",
    "showConnecting", "showAppSettings", "toggleCanvasMenu", "showShortcuts",
    "showStartPage", "selectBrush", "undo", "redo", "save", "recordClip", "resetView",
  ];
  const a = {} as Record<string, ReturnType<typeof vi.fn>>;
  for (const k of keys) a[k] = vi.fn();
  return a as unknown as ShortcutActions;
}

describe("View / camera shortcut rows", () => {
  it("adds a View group covering zoom, pan, rotate and reset", () => {
    const view = buildAppShortcuts(stubActions()).filter((r) => r.group === "View");
    const descs = new Set(view.map((r) => r.description));
    expect(descs.has("Zoom in and out")).toBe(true);
    expect(descs.has("Pan the canvas")).toBe(true);
    expect(descs.has("Rotate the canvas")).toBe(true);
    expect(view.some((r) => r.key === "0")).toBe(true); // reset is a real key
    expect(view.some((r) => r.gesture === "pinch")).toBe(true); // touch documented too
    // mouse/touch controls are gestures (soft badges), never key caps
    const gestureRows = view.filter((r) => r.gesture !== undefined);
    expect(gestureRows.length).toBeGreaterThanOrEqual(5);
    for (const r of gestureRows) expect(r.label).toBeUndefined();
  });

  it("wires the 0 key to resetView", () => {
    const actions = stubActions();
    const zero = buildAppShortcuts(actions).find((r) => r.group === "View" && r.key === "0");
    zero?.onPress();
    expect(actions.resetView).toHaveBeenCalledOnce();
  });

  it("mouse/touch rows are display-only - no key/code/fingers, so they never bind", () => {
    const display = buildAppShortcuts(stubActions()).filter(
      (r) => r.group === "View" && r.description !== "Reset view (fit and recentre)",
    );
    expect(display.length).toBeGreaterThan(0);
    for (const r of display) {
      expect(r.key).toBeUndefined();
      expect(r.code).toBeUndefined();
      expect(r.fingers).toBeUndefined();
    }
  });
});

function fakeViewport(scale: number) {
  const vp = {
    _scale: scale,
    get scale() {
      return this._scale;
    },
  } as { _scale: number; scale: number; zoomTo: (s: number) => void };
  vp.zoomTo = vi.fn((s: number) => {
    vp._scale = s;
  });
  return vp;
}

describe("zoom % readout (transient)", () => {
  it("is hidden at rest and flashes in only on a zoom change, then fades", () => {
    vi.useFakeTimers();
    const vp = fakeViewport(1);
    const r = createZoomReadout(vp as unknown as Viewport);
    expect(r.el.classList.contains("is-visible")).toBe(false); // hidden at rest
    vp._scale = 1.5;
    r.refresh();
    expect(r.el.textContent).toBe("150%");
    expect(r.el.classList.contains("is-visible")).toBe(true); // flashed in
    vi.advanceTimersByTime(800);
    expect(r.el.classList.contains("is-visible")).toBe(false); // faded out
    vi.useRealTimers();
  });

  it("ignores a pan (unchanged %) - stays hidden", () => {
    const vp = fakeViewport(1.5);
    const r = createZoomReadout(vp as unknown as Viewport);
    r.refresh(); // scale unchanged since construction (a pan)
    expect(r.el.classList.contains("is-visible")).toBe(false);
  });

  it("resets zoom to 100% when clicked", () => {
    const vp = fakeViewport(2);
    const r = createZoomReadout(vp as unknown as Viewport);
    r.el.click();
    expect(vp.zoomTo).toHaveBeenCalledWith(1);
  });
});

import { describe, it, expect } from "vitest";

import { CanvasRenderer, type IRenderer } from "../src/renderer";
import { DirtyTracker, TrackingRenderer } from "../src/layered/dirty";
import {
  DIRTY_CLASSIFICATION,
  chiselBounds,
  circleBounds,
  ellipseBounds,
  imageRectBounds,
  lineBounds,
  type Rect,
  rectBounds,
} from "../src/layered/dirty-bounds";

const px = (x: number, y: number) => ({ x, y });

const expectRect = (actual: Rect, expected: Rect) => {
  expect(actual.x).toBeCloseTo(expected.x, 5);
  expect(actual.y).toBeCloseTo(expected.y, 5);
  expect(actual.w).toBeCloseTo(expected.w, 5);
  expect(actual.h).toBeCloseTo(expected.h, 5);
};

// Does `outer` fully contain `inner` (superset check - the property every bound
// must have)?
const contains = (outer: Rect, inner: Rect): boolean =>
  outer.x <= inner.x + 1e-9 &&
  outer.y <= inner.y + 1e-9 &&
  outer.x + outer.w >= inner.x + inner.w - 1e-9 &&
  outer.y + outer.h >= inner.y + inner.h - 1e-9;

// ---- a recording 2D context, to prove forwarding is byte-identical ----------

const fmt = (v: unknown): string => {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(4);
  if (typeof v === "string") return JSON.stringify(v);
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  return "[obj]";
};

function recordingCtx(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const canvas = { width: 200, height: 200, style: {}, toBlob: (cb: (b: Blob | null) => void) => cb(null) };
  const state: Record<string, unknown> = { canvas };
  const ctx = new Proxy(state, {
    get: (t, p) => {
      if (p === "canvas") return canvas;
      if (p in t) return t[p as string];
      return (...args: unknown[]) => {
        calls.push(`${String(p)}(${args.map(fmt).join(",")})`);
      };
    },
    set: (t, p, v) => {
      calls.push(`set ${String(p)}=${fmt(v)}`);
      t[p as string] = v;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

// A no-op ctx (methods do nothing, property sets stick) for tests that only care
// about what the tracker recorded, not the ctx calls.
function noopCtx(): CanvasRenderingContext2D {
  const canvas = { width: 200, height: 200, style: {}, toBlob: (cb: (b: Blob | null) => void) => cb(null) };
  const state: Record<string, unknown> = { canvas };
  return new Proxy(state, {
    get: (t, p) => (p in t ? t[p as string] : () => {}),
    set: (t, p, v) => {
      t[p as string] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const track = (init = {}) => new TrackingRenderer(noopCtx(), init);

describe("dirty-bounds: every bound is a conservative superset", () => {
  it("drawLine (line): segment bbox inflated by half width + pad", () => {
    expectRect(lineBounds(px(0, 0), px(10, 0), "line", 4), {
      x: -3, y: -3, w: 16, h: 6,
    });
  });

  it("drawLine (arc): covered by the chord-midpoint circle", () => {
    // chord (0,0)-(10,0): centre (5,0), r 5 -> circle bbox [0,-5]..[10,5].
    expectRect(lineBounds(px(0, 0), px(10, 0), "arc", 2), {
      x: -2, y: -7, w: 14, h: 14,
    });
  });

  it("drawLine (quadraticCurve): covered by the control-point hull", () => {
    // ctrl = (mx - dy*curve, my + dx*curve) = (5, 3) for curve 0.3.
    expectRect(lineBounds(px(0, 0), px(10, 0), "quadraticCurve", 0, 0.3), {
      x: -1, y: -1, w: 12, h: 5,
    });
  });

  it("drawChisel: the four offset corners inflated by pad", () => {
    // angle PI/2 -> offset (0, +/-2) for width 4.
    const b = chiselBounds(px(0, 0), px(10, 0), Math.PI / 2, 4);
    expectRect(b, { x: -1, y: -3, w: 12, h: 6 });
  });

  it("strokeRect: centred box + half stroke width + pad", () => {
    expectRect(rectBounds(50, 50, 20, 10, undefined, 4), {
      x: 37, y: 42, w: 26, h: 16,
    });
  });

  it("strokeRect (rotated): bounded by the corner circle", () => {
    // any angle -> half-diagonal hypot(20,10)/2 ~= 11.1803.
    const r = Math.hypot(20, 10) / 2;
    expectRect(rectBounds(50, 50, 20, 10, 0.5, 4), {
      x: 50 - r - 3, y: 50 - r - 3, w: 2 * r + 6, h: 2 * r + 6,
    });
  });

  it("fillRect: no stroke width, just pad", () => {
    expectRect(rectBounds(50, 50, 20, 10, undefined, 0), {
      x: 39, y: 44, w: 22, h: 12,
    });
  });

  it("strokeCircle / fillCircle: radius box + half width + pad", () => {
    expectRect(circleBounds(100, 100, 10, 4), { x: 87, y: 87, w: 26, h: 26 });
    expectRect(circleBounds(100, 100, 10, 0), { x: 89, y: 89, w: 22, h: 22 });
  });

  it("ellipse: bounded by the max-radius circle", () => {
    expectRect(ellipseBounds(30, 30, 10, 5, 2), { x: 18, y: 18, w: 24, h: 24 });
  });

  it("drawImageRect: top-left rect inflated by pad", () => {
    expectRect(imageRectBounds(5, 5, 40, 30), { x: 4, y: 4, w: 42, h: 32 });
  });

  it("arc bound contains the true arc extent at the bulge apex", () => {
    // The semicircle apex of chord (0,0)-(20,0) sits at (10, +/-10); the bound
    // must contain a tiny rect there.
    const b = lineBounds(px(0, 0), px(20, 0), "arc", 2);
    expect(contains(b, { x: 9, y: 9, w: 2, h: 2 })).toBe(true);
    expect(contains(b, { x: 9, y: -11, w: 2, h: 2 })).toBe(true);
  });
});

describe("DirtyTracker", () => {
  it("accumulates rects and take() resets", () => {
    const t = new DirtyTracker();
    t.markRect({ x: 0, y: 0, w: 5, h: 5 });
    t.markRect({ x: 10, y: 10, w: 5, h: 5 });
    expect(t.peek().rects).toHaveLength(2);
    const taken = t.take();
    expect(taken.rects).toHaveLength(2);
    expect(taken.all).toBe(false);
    expect(t.peek().rects).toHaveLength(0); // reset
  });

  it("markAll poisons the set and drops pending rects", () => {
    const t = new DirtyTracker();
    t.markRect({ x: 0, y: 0, w: 5, h: 5 });
    t.markAll();
    const set = t.peek();
    expect(set.all).toBe(true);
    expect(set.rects).toHaveLength(0);
    // Once full, further rects are ignored until take() resets it.
    t.markRect({ x: 1, y: 1, w: 1, h: 1 });
    expect(t.peek().rects).toHaveLength(0);
  });

  it("silently() suppresses marks (for restore repaints)", () => {
    const t = new DirtyTracker();
    t.silently(() => {
      t.markRect({ x: 0, y: 0, w: 5, h: 5 });
      t.markAll();
    });
    expect(t.peek()).toEqual({ all: false, rects: [] });
    // Tracking resumes after the scope.
    t.markRect({ x: 0, y: 0, w: 5, h: 5 });
    expect(t.peek().rects).toHaveLength(1);
  });

  it("coalesces to a bounding superset past the rect cap", () => {
    const t = new DirtyTracker();
    for (let i = 0; i < 8200; i++) t.markRect({ x: i, y: 0, w: 1, h: 1 });
    const set = t.peek();
    expect(set.rects.length).toBeLessThanOrEqual(4096); // bounded
    // The union still covers the first and last rect (superset preserved).
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    for (const r of set.rects) {
      minX = Math.min(minX, r.x);
      maxX = Math.max(maxX, r.x + r.w);
    }
    expect(minX).toBeLessThanOrEqual(0);
    expect(maxX).toBeGreaterThanOrEqual(8200);
  });
});

describe("TrackingRenderer records marks", () => {
  it("a bounded draw records exactly its bound", () => {
    const r = track();
    r.fillCircle(100, 100, 10);
    expect(r.tracker.peek().rects).toEqual([circleBounds(100, 100, 10, 0)]);
  });

  it("uses the persistent line width when a draw omits style.width", () => {
    const r = track();
    r.setLineWidth(20);
    r.drawLine(px(0, 0), px(10, 0));
    expect(r.tracker.peek().rects).toEqual([
      lineBounds(px(0, 0), px(10, 0), "line", 20),
    ]);
  });

  it("style.width overrides the persistent width for that draw", () => {
    const r = track({ lineWidth: 20 });
    r.drawLine(px(0, 0), px(10, 0), { width: 2 });
    expect(r.tracker.peek().rects).toEqual([
      lineBounds(px(0, 0), px(10, 0), "line", 2),
    ]);
  });

  it("drawConnection records once (delegates to drawLine, no double-mark)", () => {
    const r = track();
    r.drawConnection(px(0, 0), px(10, 0), undefined, "line");
    expect(r.tracker.peek().rects).toHaveLength(1);
  });

  it("whole-canvas ops poison the set (fail closed)", () => {
    for (const op of [
      (r: TrackingRenderer) => r.clear(),
      (r: TrackingRenderer) => r.fillBackground("#fff"),
      (r: TrackingRenderer) => r.drawBitmap({} as CanvasImageSource),
      (r: TrackingRenderer) => r.stroke(),
    ]) {
      const r = track();
      r.fillCircle(1, 1, 1); // some pending rects first
      op(r);
      expect(r.tracker.peek().all).toBe(true);
    }
  });

  it("drawSource unions a TrackingRenderer source (the wet-stroke commit)", () => {
    const layer = track();
    const wet = track();
    wet.fillCircle(50, 50, 8);
    layer.drawSource(wet); // scale defaults to 1
    expect(layer.tracker.peek().rects).toEqual([circleBounds(50, 50, 8, 0)]);
  });

  it("drawSource marks full for a foreign source or a scaled blit", () => {
    const foreign = new CanvasRenderer(noopCtx());
    const layerA = track();
    layerA.drawSource(foreign);
    expect(layerA.tracker.peek().all).toBe(true);

    const layerB = track();
    const wet = track();
    wet.fillCircle(50, 50, 8);
    layerB.drawSource(wet, 1, 2); // scale != 1 -> can't map the source set
    expect(layerB.tracker.peek().all).toBe(true);
  });
});

describe("TrackingRenderer forwards draws byte-identically", () => {
  it("issues the same ctx calls as a plain CanvasRenderer", () => {
    const draw = (r: IRenderer) => {
      r.setLineWidth(3);
      r.setStrokeStyle("#123456");
      r.drawLine(px(0, 0), px(10, 5), { width: 4, cap: "square" }, "line");
      r.drawConnection(px(2, 2), px(8, 9), undefined, "arc");
      r.drawChisel(px(1, 1), px(9, 1), 0.7, { color: "#abc" });
      r.strokeRect(20, 20, 10, 6, { width: 2 }, 0.4);
      r.fillRect(30, 30, 8, 8, "#0f0");
      r.strokeCircle(40, 40, 5, { width: 1 });
      r.fillCircle(50, 50, 6, "#00f", 0.5);
      r.strokeEllipse(60, 60, 7, 3, 0.2, { width: 2 });
      r.fillEllipse(70, 70, 4, 9, 0.9, "#ff0");
      r.drawImageRect({} as CanvasImageSource, 5, 5, 40, 30);
      r.fillBackground("#eee");
      r.clear();
    };
    const plain = recordingCtx();
    const tracked = recordingCtx();
    draw(new CanvasRenderer(plain.ctx, { dpr: 2 }));
    draw(new TrackingRenderer(tracked.ctx, { dpr: 2 }));
    expect(tracked.calls).toEqual(plain.calls);
  });
});

// ---- exhaustiveness fence (symmetry-coverage.test.ts style) ------------------

// CanvasRenderer methods that are not on IRenderer, so are absent from
// DIRTY_CLASSIFICATION by design.
const NON_IRENDERER = new Set([
  "constructor",
  "debugProbe", // diagnostic readback
  "applyLineStyle", // private helpers (still on the prototype)
  "styled",
  "filled",
  "tracePath",
]);

const rendererMethods = Object.getOwnPropertyNames(
  CanvasRenderer.prototype,
).filter(
  (n) =>
    typeof Object.getOwnPropertyDescriptor(CanvasRenderer.prototype, n)?.value ===
    "function",
);

const trackingOverrides = new Set(
  Object.getOwnPropertyNames(TrackingRenderer.prototype).filter(
    (n) =>
      typeof Object.getOwnPropertyDescriptor(TrackingRenderer.prototype, n)
        ?.value === "function",
  ),
);

describe("dirty classification is exhaustive", () => {
  it("classifies every CanvasRenderer method as bounded / full / none", () => {
    for (const name of rendererMethods) {
      const classified =
        name in DIRTY_CLASSIFICATION || NON_IRENDERER.has(name);
      expect(
        classified,
        `CanvasRenderer.${name} is unclassified — add it to DIRTY_CLASSIFICATION ` +
          `in dirty-bounds.ts (and override it in TrackingRenderer if it paints), ` +
          `or to NON_IRENDERER in this test if it never deposits paint`,
      ).toBe(true);
    }
  });

  it("overrides every bounded/full method in TrackingRenderer", () => {
    for (const [name, cls] of Object.entries(DIRTY_CLASSIFICATION)) {
      if (cls === "none") continue;
      expect(
        trackingOverrides.has(name),
        `${name} is classified "${cls}" but TrackingRenderer does not override ` +
          `it — its dirty region would go unrecorded`,
      ).toBe(true);
    }
  });

  it("lists only real CanvasRenderer methods in DIRTY_CLASSIFICATION", () => {
    for (const name of Object.keys(DIRTY_CLASSIFICATION)) {
      expect(
        rendererMethods.includes(name),
        `DIRTY_CLASSIFICATION lists "${name}" but CanvasRenderer has no such method`,
      ).toBe(true);
    }
  });
});

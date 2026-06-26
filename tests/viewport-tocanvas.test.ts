// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { Viewport } from "../src/app/viewport";

// B7: toCanvas must be the exact inverse of the *rendered* stage transform - the
// CSS matrix the viewport writes, with transform-origin 0 0. If the applied
// transform and the matrix toCanvas inverts ever drift (or the origin isn't
// 0 0), every stroke mis-maps under pan/zoom/rotate. This forward-maps canvas
// points through the actual CSS transform, then asserts toCanvas recovers them.

const RECT = { left: 30, top: 20, width: 800, height: 600 };

function makeViewport() {
  const style: Record<string, string> = {};
  const stageEl = { style } as unknown as HTMLElement;
  const viewportEl = {
    getBoundingClientRect: () => ({
      left: RECT.left,
      top: RECT.top,
      width: RECT.width,
      height: RECT.height,
      right: RECT.left + RECT.width,
      bottom: RECT.top + RECT.height,
      x: RECT.left,
      y: RECT.top,
      toJSON() {},
    }),
  } as unknown as HTMLElement;
  const vp = new Viewport({
    viewportEl,
    stageEl,
    getCanvasSize: () => ({ width: 1000, height: 700 }),
  });
  return { vp, style };
}

// The matrix actually written to the stage (canvas -> screen), parsed from the
// CSS transform string the viewport set. Handles the 2D matrix() form (and the
// matrix3d() fallback) so the test never depends on a specific serialization.
function appliedMatrix(style: { transform: string }): DOMMatrix {
  const s = style.transform;
  const m2 = s.match(/matrix\(([^)]+)\)/);
  if (m2) {
    const [a, b, c, d, e, f] = m2[1].split(",").map(Number);
    return new DOMMatrix([a, b, c, d, e, f]);
  }
  const m3 = s.match(/matrix3d\(([^)]+)\)/);
  if (m3) {
    const n = m3[1].split(",").map(Number);
    return new DOMMatrix([n[0], n[1], n[4], n[5], n[12], n[13]]);
  }
  throw new Error(`unexpected stage transform: ${JSON.stringify(s)}`);
}

const SAMPLES = [
  { x: 0, y: 0 },
  { x: 1000, y: 700 },
  { x: 250, y: 480 },
  { x: 999, y: 1 },
];

const DRIVES: { name: string; drive: (vp: Viewport) => void }[] = [
  { name: "reset (1:1)", drive: (vp) => vp.reset() },
  { name: "fit", drive: (vp) => vp.fit() },
  {
    name: "zoomed",
    drive: (vp) => {
      vp.reset();
      vp.zoomAt(430, 320, 2.3);
    },
  },
  {
    name: "panned",
    drive: (vp) => {
      vp.reset();
      vp.panBy(-140, 75);
    },
  },
  {
    name: "rotated",
    drive: (vp) => {
      vp.reset();
      vp.rotateBy(0.7, 430, 320);
    },
  },
  {
    name: "zoom + pan + rotate",
    drive: (vp) => {
      vp.reset();
      vp.zoomAt(400, 300, 1.7);
      vp.panBy(60, -30);
      vp.rotateBy(-0.5, 500, 280);
    },
  },
];

describe("Viewport.toCanvas inverts the rendered stage transform (B7)", () => {
  it("pins transform-origin to 0 0", () => {
    const { vp, style } = makeViewport();
    vp.reset();
    expect(style.transformOrigin).toBe("0 0");
  });

  for (const { name, drive } of DRIVES) {
    it(`round-trips canvas -> client -> toCanvas (${name})`, () => {
      const { vp, style } = makeViewport();
      drive(vp);
      const css = appliedMatrix(style);
      for (const s of SAMPLES) {
        // canvas point -> screen (relative to the stage/viewport origin) -> client
        const screen = new DOMPoint(s.x, s.y).matrixTransform(css);
        const back = vp.toCanvas(screen.x + RECT.left, screen.y + RECT.top);
        expect(back.x).toBeCloseTo(s.x, 4);
        expect(back.y).toBeCloseTo(s.y, 4);
      }
    });
  }
});

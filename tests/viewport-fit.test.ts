import { describe, it, expect } from "vitest";
import {
  fitPlacement,
  resetPlacement,
  MIN_SCALE,
  MAX_SCALE,
  type Placement,
} from "../src/app/viewport";

// The framing math behind "Reset view" and (post-fix) every freshly-opened
// canvas. The whole bug was that opening a canvas reused the camera laid out for
// the PREVIOUS size, so the new canvas landed off-centre / off-screen. These
// tests pin the user-facing property: the framing is centred, on-screen, and
// depends only on the current viewport + canvas size - never on history.

// On-screen bounding box of a canvasW×canvasH canvas under a Placement.
function box(p: Placement, cw: number, ch: number) {
  return {
    left: p.tx,
    top: p.ty,
    right: p.tx + cw * p.scale,
    bottom: p.ty + ch * p.scale,
  };
}

function expectCentred(p: Placement, viewW: number, viewH: number, cw: number, ch: number) {
  const b = box(p, cw, ch);
  expect((b.left + b.right) / 2).toBeCloseTo(viewW / 2, 6);
  expect((b.top + b.bottom) / 2).toBeCloseTo(viewH / 2, 6);
}

function expectOnScreen(p: Placement, viewW: number, viewH: number, cw: number, ch: number) {
  const b = box(p, cw, ch);
  const eps = 1e-6;
  expect(b.left).toBeGreaterThanOrEqual(-eps);
  expect(b.top).toBeGreaterThanOrEqual(-eps);
  expect(b.right).toBeLessThanOrEqual(viewW + eps);
  expect(b.bottom).toBeLessThanOrEqual(viewH + eps);
}

// (label, viewport, canvas) — desktop, phone (portrait + landscape), oversized,
// tiny. Covers "open size X after size Y": each row is one freshly-opened size.
const SCENARIOS: [string, number, number, number, number][] = [
  ["desktop landscape, full-screen canvas", 1100, 720, 1096, 716],
  ["desktop landscape, square canvas", 1100, 720, 716, 716],
  ["iPhone portrait, full-screen canvas", 390, 844, 386, 840],
  ["iPhone portrait, square canvas", 390, 844, 386, 386],
  ["iPhone landscape, square canvas", 844, 390, 386, 386],
  ["iPad-ish, tall canvas", 1024, 1366, 800, 1300],
  ["oversized canvas (bigger than viewport)", 1100, 720, 4000, 3000],
];
// (Canvases so huge that fitting would need scale < MIN_SCALE can't fully fit -
// they clamp at the floor and the user pans; that floor is covered separately
// in the fitPlacement clamp test, which only asserts the framing stays centred.)

describe("resetPlacement — every freshly-opened canvas is framed", () => {
  for (const [name, vw, vh, cw, ch] of SCENARIOS) {
    it(`centres and keeps on-screen: ${name}`, () => {
      const p = resetPlacement(vw, vh, cw, ch);
      expectCentred(p, vw, vh, cw, ch);
      expectOnScreen(p, vw, vh, cw, ch);
      expect(p.scale).toBeGreaterThanOrEqual(MIN_SCALE - 1e-9);
      expect(p.scale).toBeLessThanOrEqual(MAX_SCALE + 1e-9);
    });
  }

  it("shows a canvas that fits at 100% at scale 1 (no shrinking)", () => {
    expect(resetPlacement(1100, 720, 716, 716).scale).toBe(1);
    expect(resetPlacement(390, 844, 386, 840).scale).toBe(1);
  });

  it("shrinks an oversized canvas to fit (so it stays reachable)", () => {
    const p = resetPlacement(1100, 720, 4000, 3000);
    expect(p.scale).toBeLessThan(1);
    // Limited by the tighter (height) axis: 720/3000.
    expect(p.scale).toBeCloseTo(720 / 3000, 6);
  });
});

describe("resetPlacement — framing is independent of previous size (the bug)", () => {
  // The regression: a stale camera made the framing depend on whatever canvas
  // came before. resetPlacement is a pure function of (viewport, canvas), so the
  // framing for canvas X is identical no matter what canvas Y preceded it.
  it("gives the same framing for size X regardless of the size before it", () => {
    const X: [number, number] = [716, 716];
    const direct = resetPlacement(1100, 720, X[0], X[1]);
    for (const [, , , cwPrev, chPrev] of SCENARIOS) {
      // Pretend we just framed some other size Y, then open X. No shared state,
      // so the result must match the direct framing exactly.
      void resetPlacement(1100, 720, cwPrev, chPrev);
      const after = resetPlacement(1100, 720, X[0], X[1]);
      expect(after).toEqual(direct);
    }
    // And the centred square is genuinely off the left edge, not pinned to it:
    expect(direct.tx).toBeCloseTo((1100 - 716) / 2, 6);
  });
});

describe("fitPlacement — centre + scale-to-fill with margin and clamping", () => {
  it("centres with the requested margin", () => {
    const margin = 24;
    const p = fitPlacement(1100, 720, 716, 716, margin);
    expectCentred(p, 1100, 720, 716, 716);
    // Scaled to the tighter axis minus margins: (720 - 48) / 716.
    expect(p.scale).toBeCloseTo((720 - margin * 2) / 716, 6);
    expectOnScreen(p, 1100, 720, 716, 716);
  });

  it("clamps tiny canvases to MAX_SCALE (still centred)", () => {
    const p = fitPlacement(1100, 720, 10, 10, 0);
    expect(p.scale).toBe(MAX_SCALE);
    expectCentred(p, 1100, 720, 10, 10);
  });

  it("clamps enormous canvases to MIN_SCALE", () => {
    const p = fitPlacement(1100, 720, 100000, 100000, 0);
    expect(p.scale).toBe(MIN_SCALE);
    expectCentred(p, 1100, 720, 100000, 100000);
  });
});

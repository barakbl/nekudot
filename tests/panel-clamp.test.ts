import { describe, expect, it } from "vitest";
import { clampHandleVisible, clampToViewport } from "../src/ui/drag";
import { nextCascadeOffset } from "../src/ui/window-stack";

const VP = { w: 1000, h: 800 };
const SIZE = { w: 240, h: 300 };

describe("clampToViewport (open / full-containment)", () => {
  it("leaves an in-bounds box untouched", () => {
    expect(clampToViewport({ x: 100, y: 80 }, SIZE, VP, 8)).toEqual({
      x: 100,
      y: 80,
    });
  });

  it("pulls a box back from the right/bottom edges by the margin", () => {
    // far off the bottom-right -> last fully-visible top-left
    expect(clampToViewport({ x: 5000, y: 5000 }, SIZE, VP, 8)).toEqual({
      x: VP.w - SIZE.w - 8, // 752
      y: VP.h - SIZE.h - 8, // 492
    });
  });

  it("pulls a box back from the left/top edges to the margin", () => {
    expect(clampToViewport({ x: -200, y: -200 }, SIZE, VP, 8)).toEqual({
      x: 8,
      y: 8,
    });
  });

  it("pins a box larger than the viewport to the top-left margin", () => {
    const huge = { w: 2000, h: 2000 };
    expect(clampToViewport({ x: 400, y: 400 }, huge, VP, 8)).toEqual({
      x: 8,
      y: 8,
    });
  });
});

describe("clampHandleVisible (drag / resize strip)", () => {
  const strip = 48;

  it("leaves an in-bounds box untouched", () => {
    expect(clampHandleVisible({ x: 100, y: 80 }, SIZE, VP, strip)).toEqual({
      x: 100,
      y: 80,
    });
  });

  it("keeps a strip on screen when dragged far left", () => {
    const { x } = clampHandleVisible({ x: -5000, y: 100 }, SIZE, VP, strip);
    expect(x).toBe(strip - SIZE.w); // -192: 48px of the right edge remain
  });

  it("keeps a strip on screen when dragged far right", () => {
    const { x } = clampHandleVisible({ x: 5000, y: 100 }, SIZE, VP, strip);
    expect(x).toBe(VP.w - strip); // 952: 48px of the left edge remain
  });

  it("never lets the header rise above the top edge", () => {
    const { y } = clampHandleVisible({ x: 100, y: -5000 }, SIZE, VP, strip);
    expect(y).toBe(0);
  });

  it("keeps a header strip above the bottom edge", () => {
    const { y } = clampHandleVisible({ x: 100, y: 5000 }, SIZE, VP, strip);
    expect(y).toBe(VP.h - strip); // 752
  });
});

describe("nextCascadeOffset", () => {
  it("starts at the origin and steps 24px down-right", () => {
    expect(nextCascadeOffset(0)).toEqual({ x: 0, y: 0 });
    expect(nextCascadeOffset(1)).toEqual({ x: 24, y: 24 });
    expect(nextCascadeOffset(5)).toEqual({ x: 120, y: 120 });
  });

  it("wraps back to the origin so the staircase stays bounded", () => {
    expect(nextCascadeOffset(6)).toEqual(nextCascadeOffset(0));
    expect(nextCascadeOffset(7)).toEqual(nextCascadeOffset(1));
  });

  it("handles negative indices without going off-axis", () => {
    const off = nextCascadeOffset(-1);
    expect(off.x).toBeGreaterThanOrEqual(0);
    expect(off.x % 24).toBe(0);
    expect(off).toEqual({ x: off.x, y: off.y });
  });
});

import { describe, it, expect } from "vitest";
import {
  concentricTransforms,
  mirrorTransforms,
  spiralTransforms,
  applyPoint,
} from "../src/symmetry/transforms";
import { SymmetryController } from "../src/symmetry/controller";

// Concentric (#5), movable centre + arbitrary mirror angle (#6), Spiral (#4).

describe("concentricTransforms", () => {
  it("emits `rings` copies; the first is the identity, the rest scale about the centre", () => {
    const ts = concentricTransforms({ rings: 3, scalePct: 50, twist: 0 }, 100, 100);
    expect(ts.length).toBe(3);
    expect(applyPoint(ts[0], 200, 100)).toEqual({ x: 200, y: 100 }); // master
    const p1 = applyPoint(ts[1], 200, 100); // scale 0.5 about (100,100)
    expect(p1.x).toBeCloseTo(150);
    expect(p1.y).toBeCloseTo(100);
    const p2 = applyPoint(ts[2], 200, 100); // scale 0.25
    expect(p2.x).toBeCloseTo(125);
    expect(p2.y).toBeCloseTo(100);
  });

  it("twist rotates each ring about the centre", () => {
    const ts = concentricTransforms({ rings: 2, scalePct: 100, twist: 90 }, 0, 0);
    const p = applyPoint(ts[1], 10, 0); // scale 1, rotate 90 about origin
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });
});

describe("mirrorTransforms (arbitrary angle)", () => {
  it("vertical (90) reflects left/right across the centre", () => {
    const ts = mirrorTransforms({ angle: 90 }, 100, 100);
    expect(ts.length).toBe(2);
    const p = applyPoint(ts[1], 120, 50);
    expect(p.x).toBeCloseTo(80);
    expect(p.y).toBeCloseTo(50);
  });

  it("horizontal (0) reflects top/bottom across the centre", () => {
    const ts = mirrorTransforms({ angle: 0 }, 100, 100);
    const p = applyPoint(ts[1], 50, 120);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(80);
  });

  it("diagonal (45) reflects across y=x through the centre", () => {
    const ts = mirrorTransforms({ angle: 45 }, 0, 0);
    const p = applyPoint(ts[1], 10, 0);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });
});

describe("spiralTransforms", () => {
  it("rotates by angleStep per copy about the centre (first is identity)", () => {
    const ts = spiralTransforms({ copies: 3, arms: 1, angleStep: 90, scalePct: 100 }, 0, 0);
    expect(ts.length).toBe(3);
    expect(applyPoint(ts[0], 10, 0)).toEqual({ x: 10, y: 0 }); // master
    const p1 = applyPoint(ts[1], 10, 0); // rotate 90
    expect(p1.x).toBeCloseTo(0);
    expect(p1.y).toBeCloseTo(10);
    const p2 = applyPoint(ts[2], 10, 0); // rotate 180
    expect(p2.x).toBeCloseTo(-10);
    expect(p2.y).toBeCloseTo(0);
  });

  it("scales each copy by scalePct (a log spiral)", () => {
    const ts = spiralTransforms({ copies: 2, arms: 1, angleStep: 0, scalePct: 50 }, 0, 0);
    const p = applyPoint(ts[1], 10, 0); // scale 0.5
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(0);
  });

  it("spreads `arms` copies evenly around the centre", () => {
    const ts = spiralTransforms({ copies: 1, arms: 4, angleStep: 0, scalePct: 100 }, 0, 0);
    expect(ts.length).toBe(4); // one copy per arm, at 0/90/180/270
    const p = applyPoint(ts[1], 10, 0); // arm 1 = +90
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });

  it("caps the total copies so big settings can't explode the redraw", () => {
    const ts = spiralTransforms({ copies: 999, arms: 6, angleStep: 10, scalePct: 100 }, 0, 0);
    expect(ts.length).toBeLessThanOrEqual(120);
  });
});

describe("SymmetryController centre + new modes", () => {
  const ctrl = () =>
    new SymmetryController({ get: () => undefined, set() {} } as never);

  it("mirror reflects across the MOVED centre", () => {
    const c = ctrl();
    c.setMode("mirror");
    c.setMirror({ angle: 90 }); // vertical
    c.setCenter({ x: 0.25, y: 0.5 }); // centre x = 50 on a 200-wide canvas
    c.beginStroke(0, 0, { width: 200, height: 200 });
    const ts = c.transforms();
    expect(ts.length).toBe(2);
    const p = applyPoint(ts[1], 70, 30); // reflect across x=50
    expect(p.x).toBeCloseTo(30);
    expect(p.y).toBeCloseTo(30);
  });

  it("concentric mode produces `rings` scaled copies about the centre", () => {
    const c = ctrl();
    c.setMode("concentric");
    c.setConcentric({ rings: 4, scalePct: 50, twist: 0 });
    c.setCenter({ x: 0.5, y: 0.5 }); // (100,100) on 200x200
    c.beginStroke(0, 0, { width: 200, height: 200 });
    expect(c.transforms().length).toBe(4);
    const p = applyPoint(c.transforms()[1], 200, 100); // scale 0.5 about (100,100)
    expect(p.x).toBeCloseTo(150);
    expect(c.active()).toBe(true);
  });

  it("migrates the legacy mirror axis to an angle", () => {
    const store: Record<string, unknown> = { "app.symmetry.mirror.axis": "horizontal" };
    const c = new SymmetryController({
      get: (k: string) => store[k],
      set: (k: string, v: unknown) => void (store[k] = v),
    } as never);
    expect(c.mirror.angle).toBe(0); // horizontal -> 0 degrees
  });
});

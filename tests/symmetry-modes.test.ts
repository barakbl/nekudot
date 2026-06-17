import { describe, it, expect } from "vitest";
import {
  applyPoint,
  rotateReflect,
  reflectAcrossLine,
  scaleRotateAbout,
} from "../src/symmetry/transforms";
import { SymmetryController } from "../src/symmetry/controller";

// Two layers: the shared affine BUILDERS (a tiny matrix library), and each
// tool's COMPOSITION of them, exercised through the controller (the real path -
// the per-mode logic now lives in the tool, not in a detached function).

describe("affine builders", () => {
  it("rotateReflect rotates about the centre (flip off)", () => {
    const p = applyPoint(rotateReflect(Math.PI / 2, false, 0, 0), 10, 0);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
  });
  it("rotateReflect with flip reflects across the x-axis through the centre", () => {
    const p = applyPoint(rotateReflect(0, true, 100, 100), 50, 120);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(80);
  });
  it("reflectAcrossLine: 90 = vertical, 0 = horizontal, 45 = diagonal", () => {
    expect(applyPoint(reflectAcrossLine(Math.PI / 2, 100, 100), 120, 50).x).toBeCloseTo(80);
    expect(applyPoint(reflectAcrossLine(0, 100, 100), 50, 120).y).toBeCloseTo(80);
    const d = applyPoint(reflectAcrossLine(Math.PI / 4, 0, 0), 10, 0);
    expect(d.x).toBeCloseTo(0);
    expect(d.y).toBeCloseTo(10);
  });
  it("scaleRotateAbout scales (and rotates) about the centre", () => {
    const p = applyPoint(scaleRotateAbout(0.5, 0, 100, 100), 200, 100);
    expect(p.x).toBeCloseTo(150);
    expect(p.y).toBeCloseTo(100);
  });
});

describe("symmetry tools (composition, via the controller)", () => {
  const ctrl = () =>
    new SymmetryController({ get: () => undefined, set() {} } as never);
  const SIZE = { width: 200, height: 200 }; // centre at (100,100)

  it("loads the five tools from the registry; None is the framework default", () => {
    const c = ctrl();
    expect(c.toolDefs().map((d) => d.name)).toEqual([
      "radial",
      "mirror",
      "concentric",
      "spiral",
      "tile",
    ]);
    expect(c.mode).toBe("none");
    expect(c.active()).toBe(false);
    expect(c.transforms()).toEqual([{ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, aMul: 1 }]);
  });

  it("radial: N rotations about the centre (first is identity)", () => {
    const c = ctrl();
    c.setMode("radial");
    c.setActiveSetting("mirror", false);
    c.setActiveSetting("segments", 4);
    c.beginStroke(0, 0, SIZE);
    const ts = c.transforms();
    expect(ts.length).toBe(4);
    const p = applyPoint(ts[1], 110, 100); // rotate 90 about (100,100)
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(110);
  });

  it("mirror: reflects across the MOVED centre, at any angle", () => {
    const c = ctrl();
    c.setMode("mirror"); // default angle 90 = vertical
    c.setCenter({ x: 0.25, y: 0.5 }); // centre x = 50
    c.beginStroke(0, 0, SIZE);
    expect(applyPoint(c.transforms()[1], 70, 30).x).toBeCloseTo(30);
    c.setCenter({ x: 0.5, y: 0.5 });
    c.setActiveSetting("angle", 45); // diagonal
    c.beginStroke(0, 0, SIZE);
    const p = applyPoint(c.transforms()[1], 110, 100); // reflect across y=x through centre
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(110);
  });

  it("concentric: `rings` scaled copies about the centre", () => {
    const c = ctrl();
    c.setMode("concentric");
    c.setActiveSetting("rings", 4);
    c.setActiveSetting("scalePct", 50);
    c.beginStroke(0, 0, SIZE);
    expect(c.transforms().length).toBe(4);
    expect(applyPoint(c.transforms()[1], 200, 100).x).toBeCloseTo(150); // scale 0.5
  });

  it("spiral: copies × arms, rotated/scaled, capped at 120", () => {
    const c = ctrl();
    c.setMode("spiral");
    c.setActiveSetting("arms", 1);
    c.setActiveSetting("copies", 3);
    c.setActiveSetting("angleStep", 90);
    c.setActiveSetting("scalePct", 100);
    c.beginStroke(0, 0, SIZE);
    expect(c.transforms().length).toBe(3);
    const p = applyPoint(c.transforms()[1], 110, 100); // rotate 90 about (100,100)
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(110);
    // The cap lives in the tool now.
    c.setActiveSetting("arms", 6);
    c.setActiveSetting("copies", 40);
    c.beginStroke(0, 0, SIZE);
    expect(c.transforms().length).toBeLessThanOrEqual(120);
  });

  it("tile opts out of the centre; Fill canvas stops mirroring points", () => {
    const c = ctrl();
    c.setMode("tile");
    expect(c.usesCentre()).toBe(false);
    c.setActiveSetting("fillCanvas", true);
    expect(c.mirrorsPoints()).toBe(false);
    c.setActiveSetting("fillCanvas", false);
    expect(c.mirrorsPoints()).toBe(true);
  });

  it("persists + restores a tool's params under its own key namespace", () => {
    const store = new Map<string, unknown>();
    const api = {
      get: (k: string) => store.get(k),
      set: (k: string, v: unknown) => void store.set(k, v),
    } as never;
    const a = new SymmetryController(api);
    a.setMode("spiral");
    a.setActiveSetting("arms", 3);
    expect(store.get("app.symmetry.spiral.arms")).toBe(3);
    const b = new SymmetryController(api);
    b.setMode("spiral");
    expect(b.activeSettings().find((s) => s.key === "arms")?.value).toBe(3);
  });
});

import { describe, it, expect } from "vitest";
import { SymmetryController } from "../src/symmetry/controller";

// Fill mode draws a copy in every tile but must NOT deposit the mirrored copies
// into the searchable point cloud — a full-canvas stroke would blow past the
// neighbor-finder cap (MAX_PIXELS) and evict older points, corrupting the
// connecting web (the bug: the web faded across the canvas). mirrorsPoints()
// gates that: false only for tile + fillCanvas; true for every other mode so
// the web still spans the symmetry.
function makeStore() {
  const m = new Map<string, unknown>();
  return {
    get<T>(k: string): T | undefined {
      return m.get(k) as T | undefined;
    },
    set(k: string, v: unknown) {
      m.set(k, v);
    },
  };
}

describe("SymmetryController.mirrorsPoints", () => {
  it("does NOT mirror points in tile fill mode", () => {
    const c = new SymmetryController(makeStore());
    c.setMode("tile");
    c.setTile({ fillCanvas: true });
    expect(c.mirrorsPoints()).toBe(false);
  });

  it("mirrors points in tile reach mode (fill off)", () => {
    const c = new SymmetryController(makeStore());
    c.setMode("tile");
    c.setTile({ fillCanvas: false });
    expect(c.mirrorsPoints()).toBe(true);
  });

  it("mirrors points for radial and mirror modes", () => {
    const c = new SymmetryController(makeStore());
    c.setMode("radial");
    expect(c.mirrorsPoints()).toBe(true);
    c.setMode("mirror");
    expect(c.mirrorsPoints()).toBe(true);
  });

  it("turning fill off again re-enables mirroring", () => {
    const c = new SymmetryController(makeStore());
    c.setMode("tile");
    c.setTile({ fillCanvas: true });
    expect(c.mirrorsPoints()).toBe(false);
    c.setTile({ fillCanvas: false });
    expect(c.mirrorsPoints()).toBe(true);
  });
});

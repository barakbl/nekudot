import { describe, it, expect } from "vitest";
import { SymmetryController } from "../src/symmetry/controller";

const SIZE = { width: 200, height: 200 };
const ctrl = () =>
  new SymmetryController({ get: () => undefined, set() {} } as never);

// beginStroke() FREEZES the per-stroke transform list: transforms() returns the
// snapshot taken at pointerdown, so changing the centre or a tool setting
// mid-stroke can't warp geometry already being drawn. The list re-evaluates only
// on the next beginStroke.
describe("symmetry: beginStroke freezes the transform list", () => {
  it("mid-stroke config changes do not alter the active transforms", () => {
    const c = ctrl();
    c.setMode("radial");
    c.setActiveSetting("mirror", false);
    c.setActiveSetting("segments", 4);
    c.beginStroke(0, 0, SIZE);

    const frozen = c.transforms();
    expect(frozen.length).toBe(4);

    // Mutate the config mid-stroke - the active snapshot must not move.
    c.setActiveSetting("segments", 8);
    c.setCenter({ x: 0.1, y: 0.9 });
    expect(c.transforms()).toEqual(frozen);
    expect(c.transforms().length).toBe(4);

    // The next stroke picks up the new config.
    c.beginStroke(0, 0, SIZE);
    expect(c.transforms().length).toBe(8);
  });
});

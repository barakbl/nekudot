import { describe, it, expect } from "vitest";
import { createBareHost } from "../src/paint-host";
import { RoundBrush } from "../src/brushes/round";
import { createNeighborFinder } from "../src/neighbor-finder";
import type { IRenderer } from "../src/renderer";
import { cursorModeParts, type BrushCursorMode } from "../src/app/brush-cursor";

const noopRenderer = () =>
  new Proxy({}, { get: () => () => {} }) as unknown as IRenderer;
const round = () =>
  new RoundBrush(
    createBareHost(noopRenderer(), createNeighborFinder("quadtree", [])),
    1,
  );

// The App-settings cursor picker maps to three independent draw parts; the size
// ring and the crosshair are the two mutually exclusive "primary" indicators.
describe("cursorModeParts", () => {
  it("maps each mode to the right parts", () => {
    expect(cursorModeParts("size-reach")).toEqual({ size: true, reach: true, cross: false });
    expect(cursorModeParts("cross-reach")).toEqual({ size: false, reach: true, cross: true });
    expect(cursorModeParts("size")).toEqual({ size: true, reach: false, cross: false });
    expect(cursorModeParts("cross")).toEqual({ size: false, reach: false, cross: true });
  });

  it("always has exactly one primary indicator (size XOR cross)", () => {
    const all: BrushCursorMode[] = ["size-reach", "cross-reach", "size", "cross"];
    for (const m of all) {
      const p = cursorModeParts(m);
      expect(p.size !== p.cross).toBe(true);
    }
  });
});

// reach() is the source the dashed reach ring reads: the Reach dial while the
// web weaves, and 0 when it won't - so a non-connecting brush draws no ring.
describe("ConnectionBase.reach() (web-reach ring source)", () => {
  it("reports the Reach dial while the web weaves", () => {
    const brush = round();
    brush.activeConnection()!.applyFlat({ radius: 123 });
    expect(brush.activeConnection()!.reach()).toBe(123);
  });

  it("is 0 under no-connect routing (nothing to reach for)", () => {
    const brush = round();
    brush.activeConnection()!.applyFlat({ radius: 123 });
    brush.applyRoutingPreset("no_connect");
    expect(brush.activeConnection()!.reach()).toBe(0);
  });
});

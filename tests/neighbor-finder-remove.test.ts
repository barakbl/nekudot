import { describe, it, expect } from "vitest";
import {
  createNeighborFinder,
  type NeighborFinder,
  type Pixel,
} from "../src/neighbor-finder";

const coords = (pixels: Pixel[]) => pixels.map((p) => `${p.x},${p.y}`).sort();

// removeNear is the eraser's "forget dots" primitive: a spatial delete on the
// point cloud so a wiped area stops attracting web lines. It must delete only
// what's inside the radius, drop the points from the tree (not just the backing
// array) so later lookups don't see them, and leave the stroke cutoff (nextId)
// alone so id-based mode filtering stays deterministic - the CODE-MAP
// monotonic-id invariant the card flags as a risk.
describe("NeighborFinder.removeNear (eraser forget-dots)", () => {
  const seed = (): NeighborFinder => {
    const finder = createNeighborFinder("quadtree", []);
    finder.addPixel(0, 0); // id 0
    finder.addPixel(1, 1); // id 1, dist ~1.41 from origin
    finder.addPixel(3, 0); // id 2, dist 3
    finder.addPixel(10, 10); // id 3, far away
    return finder;
  };

  it("removes only the points within the radius and returns them", () => {
    const finder = seed();
    const removed = finder.removeNear!(0, 0, 2);

    expect(coords(removed)).toEqual(["0,0", "1,1"]);
    expect(coords(finder.allPixels())).toEqual(["10,10", "3,0"]);
  });

  it("drops removed points from the tree, so findNeighbors no longer sees them", () => {
    const finder = seed();
    finder.removeNear!(0, 0, 2);

    const stillThere = finder.findNeighbors({ id: -1, x: 0, y: 0 }, 5);
    expect(coords(stillThere)).toEqual(["3,0"]);
  });

  it("leaves nextId (the stroke cutoff) untouched, so new points keep monotonic ids", () => {
    const finder = seed();
    const before = finder.pixelCount(); // nextId == 4
    finder.removeNear!(0, 0, 2); // drops 2 points

    expect(finder.pixelCount()).toBe(before); // cutoff unchanged by the delete
    expect(finder.livePixelCount()).toBe(2); // live count reflects the delete

    const added = finder.addPixel(5, 5);
    expect(added.id).toBe(before); // continues past the highest id, no reuse
  });

  it("is a no-op when nothing is in range", () => {
    const finder = seed();
    const removed = finder.removeNear!(100, 100, 1);

    expect(removed).toEqual([]);
    expect(finder.livePixelCount()).toBe(4);
  });
});

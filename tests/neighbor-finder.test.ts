import { describe, it, expect } from "vitest";
import { createNeighborFinder, type Pixel } from "../src/neighbor-finder";

const ids = (pixels: Pixel[]) => pixels.map((p) => p.id).sort((a, b) => a - b);
const coords = (pixels: Pixel[]) =>
  pixels.map((p) => `${p.x},${p.y}`).sort();

describe("NeighborFinder (quadtree)", () => {
  it("seeds a pixel for every non-zero cell in the grid", () => {
    const finder = createNeighborFinder("quadtree",[
      [1, 0, 2],
      [0, 0, 0],
      [3, 0, 0],
    ]);

    const all = finder.findNeighbors({ id: -1, x: 1, y: 1 }, 10);

    expect(coords(all)).toEqual(["0,0", "0,2", "2,0"]);
  });

  it("treats an empty grid as having no pixels", () => {
    const finder = createNeighborFinder("quadtree",[]);
    expect(finder.findNeighbors({ id: -1, x: 0, y: 0 }, 100)).toEqual([]);
  });

  it("addPixel returns a pixel with the requested coords and a unique id", () => {
    const finder = createNeighborFinder("quadtree",[[1]]);

    const a = finder.addPixel(5, 7);
    const b = finder.addPixel(5, 7);

    expect(a).toMatchObject({ x: 5, y: 7 });
    expect(b.id).not.toBe(a.id);
  });

  it("findNeighbors returns pixels within radius and excludes the query pixel", () => {
    const finder = createNeighborFinder("quadtree",[]);
    const center = finder.addPixel(0, 0);
    const near = finder.addPixel(1, 1); // dist ~1.41
    const edge = finder.addPixel(3, 0); // dist 3
    finder.addPixel(5, 0); // dist 5, outside

    const neighbors = finder.findNeighbors(center, 3);

    expect(ids(neighbors)).toEqual(ids([near, edge]));
  });

  it("finds pixels added after construction", () => {
    const finder = createNeighborFinder("quadtree",[[1]]); // seeds (0,0)
    const added = finder.addPixel(1, 0);

    const neighbors = finder.findNeighbors(added, 2);

    expect(coords(neighbors)).toEqual(["0,0"]);
  });
});

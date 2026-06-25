import { describe, it, expect } from "vitest";
import { createNeighborFinder } from "../src/neighbor-finder";

// The cloud is bounded: past the cap it drops the OLDEST live points, but two
// things must survive that eviction or connected strokes break silently:
//   - Pixel.id stays strictly monotonic (it is the per-stroke cutoff marker that
//     id-based mode filtering relies on).
//   - pixelCount() is the monotonic total-ever-added (the marker source), NOT
//     decremented by eviction; only livePixelCount() shrinks.
describe("NeighborFinder cap eviction", () => {
  it("keeps ids monotonic and pixelCount un-decremented while the live cloud is capped", () => {
    const max = 8;
    const finder = createNeighborFinder("quadtree", [], max);

    const addedIds: number[] = [];
    for (let i = 0; i < 20; i++) addedIds.push(finder.addPixel(i, 0).id);

    // Strictly increasing 0..19 - never reused or reset by eviction.
    expect(addedIds).toEqual([...Array(20).keys()]);

    // The monotonic total survives eviction...
    expect(finder.pixelCount()).toBe(20);
    // ...while the live cloud is actually capped (oldest points dropped).
    expect(finder.livePixelCount()).toBeLessThanOrEqual(max);
    expect(finder.livePixelCount()).toBeLessThan(20);
  });
});

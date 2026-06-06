import {
  createNeighborFinder,
  type NeighborFinder,
} from "../neighbor-finder";
import type { NeighborsMapConfig } from "./schema";

// Top-level neighbors map — owns the point cloud (finder). No stage canvas;
// it's purely a data + thumbnail concept. Selected map is the target for
// addPixel / findNeighbors regardless of which layer is active.
export class NeighborsMap {
  readonly finder: NeighborFinder;

  constructor(public config: NeighborsMapConfig) {
    this.finder = createNeighborFinder("quadtree", []);
  }

  setName(name: string): void {
    this.config.name = name;
  }
}

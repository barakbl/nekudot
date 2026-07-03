import { quadtree, type Quadtree } from "d3-quadtree";

// `color` is optional and rarely set: a brush (the Color Pen) can tag the point
// it deposits with the hue it drew, so a connecting brush weaving toward it can
// inherit that colour (the "From mark" web colour source) instead of computing
// one from the line angle. Most points leave it undefined.
export type Pixel = { id: number; x: number; y: number; color?: string };

export type FinderType = "quadtree";

export interface NeighborFinder {
  findNeighbors(px: Pixel, radius: number): Pixel[];
  addPixel(x: number, y: number): Pixel;
  clear(): void;
  // Remove every point within `radius` of (x, y) and return them (the eraser's
  // forget-dots). Optional: only the quadtree finder implements it, so a caller
  // falls back to a no-op. Leaves nextId untouched so the stroke cutoff holds.
  removeNear?(x: number, y: number, radius: number): Pixel[];
  allPixels(): Pixel[];
  // The next id to be assigned (ids are 0-based and monotonic), i.e. the total
  // number of points ever added since the last clear. Used as a stroke cutoff
  // marker; unaffected by cap eviction (which drops oldest points but not ids).
  pixelCount(): number;
  // The number of points currently held — the live count, O(1). Unlike
  // pixelCount() this tracks cap eviction (oldest points dropped past MAX_PIXELS),
  // so it's the right number to show as "dots in this map".
  livePixelCount(): number;
}

// Upper bound on points kept per cloud. Bounds findNeighbors traversal cost and
// memory so the cloud can't grow without limit across long/persisted sessions.
export const MAX_PIXELS = 50_000;

abstract class NeighborFinderBase implements NeighborFinder {
  protected pixels: Pixel[] = [];
  protected nextId = 0;

  constructor(grid: number[][]) {
    for (let y = 0; y < grid.length; y++) {
      const row = grid[y];
      for (let x = 0; x < row.length; x++) {
        if (row[x] !== 0) this.addPixel(x, y);
      }
    }
  }

  abstract findNeighbors(px: Pixel, radius: number): Pixel[];
  abstract addPixel(x: number, y: number): Pixel;
  abstract clear(): void;
  abstract allPixels(): Pixel[];

  pixelCount(): number {
    return this.nextId;
  }

  livePixelCount(): number {
    return this.pixels.length;
  }
}

class QuadtreeFinder extends NeighborFinderBase {
  private tree: Quadtree<Pixel>;
  private readonly maxPixels: number;

  constructor(grid: number[][], maxPixels: number = MAX_PIXELS) {
    super(grid);
    this.maxPixels = maxPixels;
    this.tree = quadtree<Pixel>()
      .x((p) => p.x)
      .y((p) => p.y)
      .addAll(this.pixels);
  }

  private rebuildTree(): void {
    this.tree = quadtree<Pixel>()
      .x((p) => p.x)
      .y((p) => p.y)
      .addAll(this.pixels);
  }

  addPixel(x: number, y: number): Pixel {
    const pixel: Pixel = { id: this.nextId++, x, y };
    this.pixels.push(pixel);
    this.tree?.add(pixel);
    // Bounded cloud: once it overshoots the cap by 25%, drop the oldest points
    // in one batch and rebuild. Amortizes to O(log n) per add. nextId (the
    // stroke cutoff) is unaffected, so id-based mode filtering stays correct.
    if (this.maxPixels > 0 && this.pixels.length > this.maxPixels * 1.25) {
      this.pixels = this.pixels.slice(this.pixels.length - this.maxPixels);
      this.rebuildTree();
    }
    return pixel;
  }

  clear(): void {
    this.pixels = [];
    this.nextId = 0;
    this.tree = quadtree<Pixel>()
      .x((p) => p.x)
      .y((p) => p.y);
  }

  allPixels(): Pixel[] {
    return this.pixels.slice();
  }

  removeNear(x: number, y: number, radius: number): Pixel[] {
    const hits = this.findNeighbors({ id: -1, x, y }, radius);
    if (!hits.length) return [];
    // Drop the hits from both the d3-tree and the backing array; nextId stays put
    // (deletes just leave id gaps). findNeighbors returns live objects -> identity.
    this.tree.removeAll(hits);
    const gone = new Set(hits);
    this.pixels = this.pixels.filter((p) => !gone.has(p));
    return hits;
  }

  findNeighbors(px: Pixel, radius: number): Pixel[] {
    const found: Pixel[] = [];
    const r2 = radius * radius;
    const x0 = px.x - radius;
    const y0 = px.y - radius;
    const x1 = px.x + radius;
    const y1 = px.y + radius;

    this.tree.visit((node, nx0, ny0, nx1, ny1) => {
      if (nx0 > x1 || ny0 > y1 || nx1 < x0 || ny1 < y0) return true;
      if (!node.length) {
        // d3-quadtree chains co-located points through `.next`; walk that list.
        // biome-ignore lint/suspicious/noExplicitAny: leaf node has no narrowed public type (.data/.next)
        for (let leaf: any = node; leaf; leaf = leaf.next) {
          const p = leaf.data as Pixel;
          if (p.id !== px.id) {
            const dx = p.x - px.x;
            const dy = p.y - px.y;
            if (dx * dx + dy * dy <= r2) found.push(p);
          }
        }
      }
      return false;
    });

    return found;
  }
}

export function createNeighborFinder(
  type: FinderType,
  grid: number[][],
  maxPixels: number = MAX_PIXELS,
): NeighborFinder {
  switch (type) {
    case "quadtree":
      return new QuadtreeFinder(grid, maxPixels);
  }
}

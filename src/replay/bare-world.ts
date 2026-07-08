import { BRUSH_DEFS } from "../brushes/registry";
import type { CanvasSize } from "../canvas-size";
import type { NeighborFinder, Pixel } from "../neighbor-finder";
import { createBareHost, type PaintHost } from "../paint-host";
import type { IRenderer } from "../renderer";
import { Store } from "../store/base";
import type { ReplaySymmetry, ReplayWorld } from "./engine";

// A headless ReplayWorld over a BARE host (vector-replay P2.1): one renderer + one
// finder, no layer stack, no maps, no symmetry - the world the unit-stream
// equivalence gate drives. It reproduces the deposited point cloud + draw calls a
// direct brush drive makes, with zero DOM. (Real layered PIXEL output is the
// offscreen-LayerManager world, P2.2.)

// An in-memory Store for the frozen colours captureStrokeContext reads - just a
// Map, so replay needs no localStorage.
export class MemoryStore extends Store {
  private readonly m = new Map<string, unknown>();
  get<T>(key: string): T | undefined {
    return this.m.has(key) ? (this.m.get(key) as T) : undefined;
  }
  set<T>(key: string, value: T extends undefined ? never : T): void {
    this.m.set(key, value);
  }
  remove(key: string): void {
    this.m.delete(key);
  }
}

// A discarding renderer - permanent marks aren't part of the point-cloud gate.
export function noopRenderer(): IRenderer {
  return new Proxy({}, { get: () => () => {} }) as unknown as IRenderer;
}

// A deterministic in-memory neighbor finder: ids in deposit order, plain distance
// filter - the same shape as the Phase-0 harness finder, so a bare replay
// reproduces the point cloud a direct drive builds.
export function createMemoryFinder(): NeighborFinder {
  const pts: Pixel[] = [];
  let n = 0;
  return {
    addPixel(x, y) {
      const p = { id: n++, x, y };
      pts.push(p);
      return p;
    },
    findNeighbors(px, radius) {
      return pts.filter((q) => q.id !== px.id && Math.hypot(q.x - px.x, q.y - px.y) <= radius);
    },
    allPixels: () => [...pts],
    pixelCount: () => n,
    livePixelCount: () => pts.length,
    clear() {
      pts.length = 0;
    },
  };
}

// "none"-mode symmetry: never mirrors. A symmetric replay needs the real
// SymmetryController (offscreen world).
const NO_SYMMETRY: ReplaySymmetry = {
  beginStroke: () => {},
  setMode: () => {},
  setCenter: () => {},
  active: () => false,
};

// Build a bare replay world. Inject `host` to observe the brush's calls (the
// equivalence test wraps a recording proxy); otherwise it builds a discarding
// bare host over a fresh memory finder.
export function createBareReplayWorld(opts?: {
  host?: PaintHost;
  store?: Store;
  size?: CanvasSize;
  // Inject a finder for a compute-only bench (e.g. the real quadtree) - defaults to
  // the simple in-memory finder. Ignored when `host` is supplied.
  finder?: NeighborFinder;
}): ReplayWorld {
  const store = opts?.store ?? new MemoryStore();
  const host = opts?.host ?? createBareHost(noopRenderer(), opts?.finder ?? createMemoryFinder());
  const size = opts?.size ?? { width: 1920, height: 1080 };
  return {
    host,
    store,
    createBrush(name) {
      const def = BRUSH_DEFS.find((d) => d.name === name);
      if (!def) throw new Error(`replay: unknown brush "${name}"`);
      return def.create({ host, store, getInvisibleOverlay: () => noopRenderer() });
    },
    currentSize: () => size,
    symmetry: NO_SYMMETRY,
  };
}

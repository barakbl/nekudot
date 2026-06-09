import type { IRenderer } from "../renderer";
import type { CanvasSize } from "../canvas-size";
import {
  type Transform,
  type TileParams,
  type RadialParams,
  type MirrorParams,
  IDENTITY,
  tileTransforms,
  radialTransforms,
  mirrorTransforms,
} from "./transforms";

export type SymmetryMode = "none" | "tile" | "radial" | "mirror";

// Minimal store shape (the app's persistent key/value store).
type Store = {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
};

const K = {
  mode: "app.symmetry.mode",
  tileX: "app.symmetry.tile.x",
  tileY: "app.symmetry.tile.y",
  tileReach: "app.symmetry.tile.reach",
  tileFalloff: "app.symmetry.tile.falloff",
  radialSegments: "app.symmetry.radial.segments",
  radialMirror: "app.symmetry.radial.mirror",
  mirrorAxis: "app.symmetry.mirror.axis",
};

const GUIDE = { color: "#888", width: 0.5, alpha: 0.35 } as const;

// Owns the symmetry mode + params, computes the per-stroke transform list, and
// draws the on-canvas guide lines. The render/finder proxy reads transforms()
// to mirror every mark and point.
export class SymmetryController {
  mode: SymmetryMode;
  tile: TileParams;
  radial: RadialParams;
  mirror: MirrorParams;
  private current: readonly Transform[] = [IDENTITY];
  private listeners = new Set<() => void>();

  constructor(private store: Store) {
    this.mode = store.get<SymmetryMode>(K.mode) ?? "none";
    this.tile = {
      xSpacing: store.get<number>(K.tileX) ?? 40,
      ySpacing: store.get<number>(K.tileY) ?? 40,
      reach: store.get<number>(K.tileReach) ?? 140,
      falloffPct: store.get<number>(K.tileFalloff) ?? 70,
    };
    this.radial = {
      segments: store.get<number>(K.radialSegments) ?? 8,
      mirror: store.get<boolean>(K.radialMirror) ?? true,
    };
    this.mirror = {
      axis: store.get<MirrorParams["axis"]>(K.mirrorAxis) ?? "vertical",
    };
  }

  active(): boolean {
    return this.mode !== "none";
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  setMode(m: SymmetryMode): void {
    this.mode = m;
    this.store.set(K.mode, m);
    this.notify();
  }
  setTile(patch: Partial<TileParams>): void {
    this.tile = { ...this.tile, ...patch };
    this.store.set(K.tileX, this.tile.xSpacing);
    this.store.set(K.tileY, this.tile.ySpacing);
    this.store.set(K.tileReach, this.tile.reach);
    this.store.set(K.tileFalloff, this.tile.falloffPct);
    this.notify();
  }
  setRadial(patch: Partial<RadialParams>): void {
    this.radial = { ...this.radial, ...patch };
    this.store.set(K.radialSegments, this.radial.segments);
    this.store.set(K.radialMirror, this.radial.mirror);
    this.notify();
  }
  setMirror(patch: Partial<MirrorParams>): void {
    this.mirror = { ...this.mirror, ...patch };
    this.store.set(K.mirrorAxis, this.mirror.axis);
    this.notify();
  }

  // Called on pointerdown: freeze the transform list for the whole stroke (Tile
  // is anchored to the start; Radial/Mirror are centred on the canvas).
  beginStroke(x: number, y: number, size: CanvasSize): void {
    this.current = this.computeTransforms(x, y, size);
  }
  transforms(): readonly Transform[] {
    return this.current;
  }

  private computeTransforms(x: number, y: number, size: CanvasSize): readonly Transform[] {
    const cx = size.width / 2;
    const cy = size.height / 2;
    if (this.mode === "tile") return tileTransforms(this.tile, x, y);
    if (this.mode === "radial") return radialTransforms(this.radial, cx, cy);
    if (this.mode === "mirror") return mirrorTransforms(this.mirror, cx, cy);
    return [IDENTITY];
  }

  // Draw the guide lines (tile lattice, radial spokes or the mirror line).
  drawGuides(r: IRenderer, size: CanvasSize): void {
    r.clear();
    if (this.mode === "tile") this.drawTileGuides(r, size);
    else if (this.mode === "radial") this.drawRadialGuides(r, size);
    else if (this.mode === "mirror") this.drawMirrorGuide(r, size);
  }

  private drawMirrorGuide(r: IRenderer, size: CanvasSize): void {
    const cx = size.width / 2;
    const cy = size.height / 2;
    if (this.mirror.axis === "vertical")
      r.drawLine({ id: 0, x: cx, y: 0 }, { id: 0, x: cx, y: size.height }, GUIDE);
    else r.drawLine({ id: 0, x: 0, y: cy }, { id: 0, x: size.width, y: cy }, GUIDE);
  }

  private drawTileGuides(r: IRenderer, size: CanvasSize): void {
    const sx = this.tile.xSpacing;
    const sy = this.tile.ySpacing;
    if (sx <= 0 || sy <= 0) return;
    const { width: w, height: h } = size;
    for (let x = 0; x <= w; x += sx)
      r.drawLine({ id: 0, x, y: 0 }, { id: 0, x, y: h }, GUIDE);
    for (let y = 0; y <= h; y += sy)
      r.drawLine({ id: 0, x: 0, y }, { id: 0, x: w, y }, GUIDE);
  }

  private drawRadialGuides(r: IRenderer, size: CanvasSize): void {
    const cx = size.width / 2;
    const cy = size.height / 2;
    const reach = Math.hypot(size.width, size.height); // past the corners
    const n = Math.max(1, Math.floor(this.radial.segments));
    const spokes = this.radial.mirror ? n * 2 : n; // mirror doubles the lines
    const step = (2 * Math.PI) / spokes;
    for (let k = 0; k < spokes; k++) {
      const a = k * step;
      r.drawLine(
        { id: 0, x: cx, y: cy },
        { id: 0, x: cx + Math.cos(a) * reach, y: cy + Math.sin(a) * reach },
        GUIDE,
      );
    }
  }
}

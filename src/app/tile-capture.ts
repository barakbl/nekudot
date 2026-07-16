import type { DirtySet, DirtyTracker } from "../layered/dirty";
import type { LayerManager } from "../layered/manager";
import type { DeviceRect } from "../renderer";
import type { LayersConfig } from "../layered/schema";
import type { MapJournalSnapshot, MapOp, MapPoint } from "../layered/map-journal";
import { replayMapPoints } from "../layered/map-journal";
import { type PatchPixels, decodePatch, encodePatch } from "../store/patch-codec";
import type { LayerPaint, NeighborsMapPaint, PaintSnapshot } from "../store/paint";
import type { StoredBase, StoredChain, StoredEntry, TileEpoch } from "../store/undo-tiled";

// Shadow-mode tile capture (tile-undo PR9). Alongside today's full-snapshot undo,
// this captures a delta TileEntry per push and, after each history step, verifies
// that base + deltas reconstructs the live state. It proves the PR4/PR5 dirty
// bounds are correct on real usage before any restore depends on them. Nothing
// here drives a restore yet; the live path is untouched.

const TILE = 256; // device px per undo-tile
const DEGRADE_FRACTION = 0.4; // > this fraction of the grid dirty -> full-layer patch
const MAX_SPANS = 8; // > this many merged spans -> full-layer patch

const FLAG_KEY = "nekudot.undoTiles";
export type UndoTilesMode = "off" | "shadow" | "on";

// Default is "shadow": capture + verify for everyone, live path unchanged (the
// soak). "on" is reserved for the real restore swap (a later PR) and behaves as
// shadow here. Read once at boot; guarded for the bare test env.
export function readUndoTilesMode(): UndoTilesMode {
  try {
    if (typeof localStorage === "undefined") return "shadow";
    const raw = localStorage.getItem(FLAG_KEY)?.toLowerCase();
    if (raw === "off") return "off";
    if (raw === "on") return "on";
    return "shadow";
  } catch {
    return "shadow";
  }
}

export type RawImage = PatchPixels; // { data, width, height } in device px
export type Cloud = { mapId: string; points: MapPoint[] };

export type TilePatch = { layerId: string; rect: DeviceRect; blob: Blob; full: boolean };
export type TileEntry = {
  id: number; // stable row id for v2 persistence; assigned at commit
  config: LayersConfig;
  patches: TilePatch[]; // tile spans (deflate) and/or a full-layer patch (degrade)
  mapOps: MapOp[];
  bytes: number;
};
type BaseKeyframe = { id: number; config: LayersConfig; layers: Map<string, RawImage>; clouds: Cloud[] };

// ---- pure grid + degrade planning ------------------------------------------

// Snap a css-px dirty set to device tile-aligned spans and decide whether to
// degrade this layer to a single full-layer patch (FULL-poisoned, too much of the
// grid dirty, or too many spans).
export function planCapture(
  dirty: DirtySet,
  deviceW: number,
  deviceH: number,
  scale: number,
): { spans: DeviceRect[]; degrade: boolean } {
  if (dirty.all) return { spans: [], degrade: true };
  const cols = Math.max(1, Math.ceil(deviceW / TILE));
  const rows = Math.max(1, Math.ceil(deviceH / TILE));
  const dirtyTiles = new Set<number>();
  for (const r of dirty.rects) {
    // The rect's right/bottom edges are exclusive (x + w), so the last covered
    // tile is ceil(edge / TILE) - 1, not floor(edge / TILE).
    const x0 = clamp(Math.floor((r.x * scale) / TILE), 0, cols - 1);
    const y0 = clamp(Math.floor((r.y * scale) / TILE), 0, rows - 1);
    const x1 = clamp(Math.ceil(((r.x + r.w) * scale) / TILE) - 1, 0, cols - 1);
    const y1 = clamp(Math.ceil(((r.y + r.h) * scale) / TILE) - 1, 0, rows - 1);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) dirtyTiles.add(ty * cols + tx);
  }
  if (dirtyTiles.size === 0) return { spans: [], degrade: false };
  if (dirtyTiles.size > DEGRADE_FRACTION * cols * rows) return { spans: [], degrade: true };
  const spans = mergeTilesToSpans(dirtyTiles, cols, rows, deviceW, deviceH);
  if (spans.length > MAX_SPANS) return { spans: [], degrade: true };
  return { spans, degrade: false };
}

// Merge dirty tiles into tile-aligned device rects: horizontal runs per row, then
// fold a run into the run directly above it when their column range matches.
function mergeTilesToSpans(
  tiles: Set<number>,
  cols: number,
  rows: number,
  deviceW: number,
  deviceH: number,
): DeviceRect[] {
  const runs: { row: number; c0: number; c1: number }[] = [];
  for (let row = 0; row < rows; row++) {
    let c0 = -1;
    for (let col = 0; col <= cols; col++) {
      const dirty = col < cols && tiles.has(row * cols + col);
      if (dirty && c0 < 0) c0 = col;
      else if (!dirty && c0 >= 0) {
        runs.push({ row, c0, c1: col - 1 });
        c0 = -1;
      }
    }
  }
  const merged: { r0: number; r1: number; c0: number; c1: number }[] = [];
  for (const run of runs) {
    const prev = merged.find(
      (m) => m.r1 === run.row - 1 && m.c0 === run.c0 && m.c1 === run.c1,
    );
    if (prev) prev.r1 = run.row;
    else merged.push({ r0: run.row, r1: run.row, c0: run.c0, c1: run.c1 });
  }
  return merged.map((m) => ({
    x: m.c0 * TILE,
    y: m.r0 * TILE,
    w: Math.min((m.c1 + 1) * TILE, deviceW) - m.c0 * TILE,
    h: Math.min((m.r1 + 1) * TILE, deviceH) - m.r0 * TILE,
  }));
}

// ---- pure pixel compose + compare ------------------------------------------

function cloneImage(img: RawImage): RawImage {
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
}

// Overwrite dst's (x, y)-anchored rect with src pixels (the blitPatch semantic:
// replace, don't composite). Clipped to dst bounds.
export function putRect(dst: RawImage, src: RawImage, x: number, y: number): void {
  for (let row = 0; row < src.height; row++) {
    const dy = y + row;
    if (dy < 0 || dy >= dst.height) continue;
    let si = row * src.width * 4;
    let di = (dy * dst.width + x) * 4;
    for (let col = 0; col < src.width; col++) {
      const dx = x + col;
      if (dx >= 0 && dx < dst.width) {
        dst.data[di] = src.data[si];
        dst.data[di + 1] = src.data[si + 1];
        dst.data[di + 2] = src.data[si + 2];
        dst.data[di + 3] = src.data[si + 3];
      }
      si += 4;
      di += 4;
    }
  }
}

// Count pixels whose max channel delta exceeds tol. tol absorbs the canvas
// premultiply / PNG round-trip on the degraded (full-layer) path; a wrong tile
// bound drops whole opaque regions (delta 255), so it is caught regardless.
export function countDiffs(a: RawImage, b: RawImage, tol: number): number {
  if (a.width !== b.width || a.height !== b.height) return a.width * a.height + 1;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(
      Math.abs(a.data[i] - b.data[i]),
      Math.abs(a.data[i + 1] - b.data[i + 1]),
      Math.abs(a.data[i + 2] - b.data[i + 2]),
      Math.abs(a.data[i + 3] - b.data[i + 3]),
    );
    if (d > tol) n++;
  }
  return n;
}

const cloudKey = (p: MapPoint): string => JSON.stringify(p);
const multiset = (points: readonly MapPoint[]): string =>
  points.map(cloudKey).sort().join("|");

// ---- host: the browser pixel surface (faked in tests) ----------------------

export type TileLayer = { id: string; deviceW: number; deviceH: number };

export interface TileHost {
  getConfig(): LayersConfig;
  cssSize(): { width: number; height: number };
  layers(): TileLayer[];
  takeLayerDirty(layerId: string): DirtySet;
  takeJournal(): MapJournalSnapshot;
  collectClouds(): Cloud[];
  // sync getImageData of a device rect (capture)
  readSpan(layerId: string, rect: DeviceRect): RawImage;
  // sync getImageData of the whole layer (verify compare)
  readLayer(layerId: string): RawImage;
  // async toBlob of the whole layer (degrade capture, S7-safe) + its decode
  captureFull(layerId: string): Promise<Blob>;
  decodeFull(blob: Blob, width: number, height: number): Promise<RawImage>;
  // encode raw pixels to a PNG blob (build a PaintSnapshot layer for the on-mode
  // restore, which flows through the existing applyPaintData path)
  rawToBlob(img: RawImage): Promise<Blob>;
}

// ---- capture: sync cut, then async encode ----------------------------------

type SpanCut = { layerId: string; rect: DeviceRect; pixels: RawImage };
type FullCut = { layerId: string; pending: Promise<Blob>; width: number; height: number };
export type CaptureCut = {
  config: LayersConfig;
  mapOps: MapOp[];
  spans: SpanCut[];
  fulls: FullCut[];
};

// The atomic cut - all sampling is synchronous here, so a later stroke cannot
// bleed in (tracker/journal are drained, span pixels + config snapshotted, and a
// degraded layer's toBlob is snapshotted at call time).
export function captureCut(host: TileHost): CaptureCut {
  const config = host.getConfig();
  const mapOps = host.takeJournal().ops;
  const spans: SpanCut[] = [];
  const fulls: FullCut[] = [];
  const scale = deviceScale(host);
  for (const layer of host.layers()) {
    const dirty = host.takeLayerDirty(layer.id);
    const plan = planCapture(dirty, layer.deviceW, layer.deviceH, scale);
    if (plan.degrade) {
      fulls.push({
        layerId: layer.id,
        pending: host.captureFull(layer.id),
        width: layer.deviceW,
        height: layer.deviceH,
      });
    } else {
      for (const rect of plan.spans)
        spans.push({ layerId: layer.id, rect, pixels: host.readSpan(layer.id, rect) });
    }
  }
  return { config, mapOps, spans, fulls };
}

export async function encodeCut(cut: CaptureCut): Promise<TileEntry> {
  const patches: TilePatch[] = [];
  for (const s of cut.spans) {
    const blob = await encodePatch(s.pixels);
    patches.push({ layerId: s.layerId, rect: s.rect, blob, full: false });
  }
  for (const f of cut.fulls) {
    const blob = await f.pending;
    patches.push({
      layerId: f.layerId,
      rect: { x: 0, y: 0, w: f.width, h: f.height },
      blob,
      full: true,
    });
  }
  const bytes = patches.reduce((n, p) => n + p.blob.size, 0);
  return { id: -1, config: cut.config, patches, mapOps: cut.mapOps, bytes };
}

function deviceScale(host: TileHost): number {
  const css = host.cssSize();
  const first = host.layers()[0];
  return first && css.width > 0 ? first.deviceW / css.width : 1;
}

// ---- the in-memory shadow chain + verifier ---------------------------------

export class TileShadow {
  private base: BaseKeyframe | null = null;
  private entries: TileEntry[] = [];
  private pointer = 0; // index into [base, entry0, entry1, ...]; 0 = base only
  // False once an undo/redo leaves the captured window (e.g. undo past the boot
  // seed, or redo into stack history this session never captured). Verifying then
  // would false-positive, so we skip until the next push re-establishes the tip.
  private synced = true;
  // Layers whose base absorbed a degraded (PNG) full-layer patch on eviction: PNG
  // premultiply makes them inexact, and a full snapshot has no tile bounds to
  // test anyway, so exact verify skips them. Layers with an active full patch are
  // skipped the same way (checked live in verify).
  private approx = new Set<string>();
  private nextEntryId = 0;
  private nextBaseId = 0;
  mismatches = 0;

  constructor(
    private readonly host: TileHost,
    private readonly maxUndo: number,
    private readonly onMismatch: (detail: string) => void = () => {},
  ) {}

  // Seed the base keyframe from the current live state (the initial push).
  seedBase(): void {
    this.base = {
      id: this.nextBaseId++,
      config: this.host.getConfig(),
      layers: new Map(this.host.layers().map((l) => [l.id, this.host.readLayer(l.id)])),
      clouds: this.host.collectClouds(),
    };
    // The seed push also drains the trackers/journal so the first real stroke's
    // delta starts clean.
    for (const l of this.host.layers()) this.host.takeLayerDirty(l.id);
    this.host.takeJournal();
    this.entries = [];
    this.pointer = 0;
    this.synced = true;
    this.approx.clear();
  }

  hasBase(): boolean {
    return this.base !== null;
  }

  inSync(): boolean {
    return this.synced;
  }

  // The synchronous cut (call at push time); commitCut finishes it in the queue.
  cut(): CaptureCut {
    return captureCut(this.host);
  }
  async commitCut(cut: CaptureCut): Promise<void> {
    await this.commit(await encodeCut(cut));
  }

  // Append a captured delta, mirroring UndoManager.push: drop any redo tail, then
  // fold the oldest entry into the base once the stack passes maxUndo.
  async commit(entry: TileEntry): Promise<void> {
    if (!this.base) return;
    if (this.pointer < this.entries.length) this.entries.length = this.pointer;
    entry.id = this.nextEntryId++;
    this.entries.push(entry);
    this.pointer = this.entries.length;
    this.synced = true;
    while (this.entries.length + 1 > this.maxUndo) {
      await this.foldOldestIntoBase();
      this.pointer--;
    }
  }

  // Mirror a live undo/redo. Falls out of sync if the step leaves the captured
  // window (undo below the base, or redo above the captured tip).
  step(kind: "undo" | "redo"): void {
    if (!this.synced) return;
    if (kind === "undo") {
      if (this.pointer > 0) this.pointer--;
      else this.synced = false;
    } else {
      if (this.pointer < this.entries.length) this.pointer++;
      else this.synced = false;
    }
  }

  reset(): void {
    this.base = null;
    this.entries = [];
    this.pointer = 0;
    this.synced = true;
    this.approx.clear();
  }

  // Reconstruct the target state (base + entries[0..pointer-1]) and compare it to
  // the live layers + clouds. Async + non-blocking; a mismatch bumps the counter.
  async verify(tol: number): Promise<{ layerDiffs: number; cloudMismatch: boolean }> {
    if (!this.base || !this.synced) return { layerDiffs: 0, cloudMismatch: false };
    const active = this.entries.slice(0, this.pointer);
    let layerDiffs = 0;
    for (const layer of this.host.layers()) {
      // Skip full-snapshot layers: no tile bounds to test, and PNG isn't exact.
      const activeFull = active.some((e) =>
        e.patches.some((p) => p.layerId === layer.id && p.full),
      );
      if (activeFull || this.approx.has(layer.id)) continue;
      const recon = await this.reconstructLayer(layer.id, active);
      if (!recon) continue; // a layer not in this target (added later) - skip
      const live = this.host.readLayer(layer.id);
      layerDiffs += countDiffs(recon, live, tol);
    }
    const cloudMismatch = this.verifyClouds(active);
    if (layerDiffs > 0 || cloudMismatch) {
      this.mismatches++;
      this.onMismatch(`layerDiffs=${layerDiffs} cloudMismatch=${cloudMismatch}`);
    }
    return { layerDiffs, cloudMismatch };
  }

  private async reconstructLayer(
    layerId: string,
    active: TileEntry[],
  ): Promise<RawImage | null> {
    const base = this.base?.layers.get(layerId);
    if (!base) return null;
    const out = cloneImage(base);
    for (const entry of active) {
      for (const patch of entry.patches) {
        if (patch.layerId !== layerId) continue;
        const px = patch.full
          ? await this.host.decodeFull(patch.blob, patch.rect.w, patch.rect.h)
          : await decodePatch(patch.blob);
        putRect(out, px, patch.rect.x, patch.rect.y);
      }
    }
    return out;
  }

  // Rebuild each cloud's point-value multiset at a pointer: base clouds + forward
  // replay of the active entries' map ops (never inverted).
  private reconstructCloudsAt(active: TileEntry[]): Map<string, MapPoint[]> {
    const seed: MapOp[] = (this.base?.clouds ?? []).map((c) => ({
      mapId: c.mapId,
      op: "add",
      points: c.points,
    }));
    return replayMapPoints(seed.concat(...active.map((e) => e.mapOps)));
  }

  private epoch(): TileEpoch {
    const css = this.host.cssSize();
    return { cssW: css.width, cssH: css.height, dpr: deviceScale(this.host) };
  }

  // Serialize the whole chain for v2 persistence: base layers -> PNG blobs, entries
  // as-is (their patches are already blobs).
  async serialize(): Promise<StoredChain> {
    if (!this.base) throw new Error("tile shadow: nothing to serialize");
    const layers: StoredBase["layers"] = [];
    for (const [layerId, img] of this.base.layers)
      layers.push({ layerId, blob: await this.host.rawToBlob(img), w: img.width, h: img.height });
    const base: StoredBase = { id: this.base.id, config: this.base.config, layers, clouds: this.base.clouds };
    const entries: StoredEntry[] = this.entries.map((e) => ({
      id: e.id,
      config: e.config,
      bytes: e.bytes,
      mapOps: e.mapOps,
      patches: e.patches.map((p) => ({ layerId: p.layerId, rect: p.rect, blob: p.blob, full: p.full })),
    }));
    return { epoch: this.epoch(), pointer: this.pointer, base, entries };
  }

  // Reconstruct the target state (base + deltas up to pointer) as a PaintSnapshot,
  // so the on-mode restore flows through the existing applyPaintData path. Returns
  // null - the caller falls back to today's snapshot - if not in sync or the layer
  // SET changed across the window (add/remove/reorder is deferred to a later PR).
  reconstructPaintSnapshot(): Promise<PaintSnapshot | null> {
    if (!this.synced) return Promise.resolve(null);
    return this.reconstructPaintSnapshotAt(this.pointer);
  }

  // Reconstruct an arbitrary pointer's paint (0 = base, k = base + entries[0..k-1]);
  // boot rebuilds every position this way. Null when the layer set changed across
  // the window (the caller degrades to a depth-reset boot).
  async reconstructPaintSnapshotAt(pointer: number): Promise<PaintSnapshot | null> {
    if (!this.base) return null;
    const active = this.entries.slice(0, pointer);
    const target = this.configAt(pointer);
    if (!target) return null;
    const baseIds = [...this.base.layers.keys()].sort().join(",");
    const targetIds = target.layers.map((l) => l.id).sort().join(",");
    if (baseIds !== targetIds) return null;
    const layers: LayerPaint[] = [];
    for (const lc of target.layers) {
      const recon = await this.reconstructLayer(lc.id, active);
      if (!recon) return null;
      layers.push({ layerIndex: lc.index, blob: await this.host.rawToBlob(recon) });
    }
    const clouds = this.reconstructCloudsAt(active);
    const neighborsMaps: NeighborsMapPaint[] = (target.neighborsMaps ?? []).map((mc, i) => ({
      index: i,
      pixels: (clouds.get(mc.id) ?? []).map((p) =>
        p.color ? { x: p.x, y: p.y, color: p.color } : { x: p.x, y: p.y },
      ),
    }));
    return { version: 2, layers, neighborsMaps };
  }

  // The config in effect at a pointer (base config, or the last active entry's).
  configAt(pointer: number): LayersConfig | null {
    if (!this.base) return null;
    const active = this.entries.slice(0, pointer);
    return active.length ? active[active.length - 1].config : this.base.config;
  }

  // Chain depth + pointer - what the boot needs to rebuild the FIFO to match.
  entryCount(): number {
    return this.entries.length;
  }
  pointerIndex(): number {
    return this.pointer;
  }

  currentEpoch(): TileEpoch {
    return this.epoch();
  }

  // Drain the live trackers + journal without re-reading the base: a hydrate's
  // restore dirtied everything, and the first real stroke's delta must start clean.
  drainInputs(): void {
    for (const l of this.host.layers()) this.host.takeLayerDirty(l.id);
    this.host.takeJournal();
  }

  // Load a persisted v2 chain (boot): base blobs decode back to RawImage, entries
  // carry their patch blobs as-is, then any pointer reconstructs as if live-captured.
  async hydrate(chain: StoredChain): Promise<void> {
    const layers = new Map<string, RawImage>();
    for (const l of chain.base.layers)
      layers.set(l.layerId, await this.host.decodeFull(l.blob, l.w, l.h));
    this.base = {
      id: chain.base.id,
      config: chain.base.config as LayersConfig,
      layers,
      clouds: chain.base.clouds as Cloud[],
    };
    this.entries = chain.entries.map((e) => ({
      id: e.id,
      config: e.config as LayersConfig,
      patches: e.patches.map((p) => ({
        layerId: p.layerId,
        rect: p.rect,
        blob: p.blob,
        full: p.full,
      })),
      mapOps: e.mapOps as MapOp[],
      bytes: e.bytes,
    }));
    this.pointer = chain.pointer;
    this.nextBaseId = chain.base.id + 1;
    this.nextEntryId = this.entries.reduce((m, e) => Math.max(m, e.id + 1), 0);
    this.synced = true;
    // A full-layer patch in the chain is PNG-approximate; exact verify must skip it.
    this.approx = new Set(
      this.entries.flatMap((e) => e.patches.filter((p) => p.full).map((p) => p.layerId)),
    );
  }

  private verifyClouds(active: TileEntry[]): boolean {
    if (!this.base) return false;
    const recon = this.reconstructCloudsAt(active);
    const live = new Map(this.host.collectClouds().map((c) => [c.mapId, c.points]));
    const ids = new Set([...recon.keys(), ...live.keys()]);
    for (const id of ids) {
      if (multiset(recon.get(id) ?? []) !== multiset(live.get(id) ?? [])) return true;
    }
    return false;
  }

  private async foldOldestIntoBase(): Promise<void> {
    if (!this.base || this.entries.length === 0) return;
    const oldest = this.entries.shift();
    if (!oldest) return;
    // Composite the oldest delta onto each base layer, and its map ops into the
    // base clouds, so base + remaining entries still reconstructs every state.
    for (const patch of oldest.patches) {
      const base = this.base.layers.get(patch.layerId);
      if (!base) continue;
      const px = patch.full
        ? await this.host.decodeFull(patch.blob, patch.rect.w, patch.rect.h)
        : await decodePatch(patch.blob);
      putRect(base, px, patch.rect.x, patch.rect.y);
      if (patch.full) this.approx.add(patch.layerId); // base is now PNG-approximate
    }
    const seed: MapOp[] = this.base.clouds.map((c) => ({
      mapId: c.mapId,
      op: "add",
      points: c.points,
    }));
    const folded = replayMapPoints(seed.concat(oldest.mapOps));
    this.base.clouds = [...folded].map(([mapId, points]) => ({ mapId, points }));
    this.base.config = oldest.config;
    this.base.id = this.nextBaseId++; // a new base version for the store to persist
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// The browser pixel surface over a live LayerManager. Only its methods touch the
// DOM (getImageData / toBlob / createImageBitmap), so importing it in Node is safe.
export function createTileHost(manager: LayerManager): TileHost {
  const layerById = (id: string) => manager.all.find((l) => l.config.id === id);
  const ctxOf = (id: string): CanvasRenderingContext2D => {
    const ctx = layerById(id)?.canvas.getContext("2d");
    if (!ctx) throw new Error(`tile-capture: no context for layer ${id}`);
    return ctx;
  };
  const toRaw = (d: ImageData): RawImage => ({ data: d.data, width: d.width, height: d.height });
  return {
    getConfig: () => manager.getConfig(),
    cssSize: () => manager.currentSize,
    layers: () =>
      manager.all.map((l) => ({ id: l.config.id, deviceW: l.canvas.width, deviceH: l.canvas.height })),
    takeLayerDirty: (id) => {
      const tracker = (layerById(id)?.renderer as unknown as { tracker?: DirtyTracker })?.tracker;
      return tracker ? tracker.take() : { all: true, rects: [] };
    },
    takeJournal: () => manager.mapJournal.take(),
    collectClouds: () =>
      manager.collectMapPixels().map((m, i) => ({
        mapId: manager.allNeighborsMaps[i]?.config.id ?? String(i),
        points: m.pixels,
      })),
    readSpan: (id, rect) => toRaw(ctxOf(id).getImageData(rect.x, rect.y, rect.w, rect.h)),
    readLayer: (id) => {
      const canvas = layerById(id)?.canvas;
      if (!canvas) throw new Error(`tile-capture: no layer ${id}`);
      return toRaw(ctxOf(id).getImageData(0, 0, canvas.width, canvas.height));
    },
    captureFull: (id) => {
      const canvas = layerById(id)?.canvas;
      if (!canvas) return Promise.reject(new Error(`tile-capture: no layer ${id}`));
      return new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob null"))), "image/png"),
      );
    },
    decodeFull: async (blob, width, height) => {
      const bmp = await createImageBitmap(blob);
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("tile-capture: no context for decodeFull");
      ctx.drawImage(bmp, 0, 0);
      return toRaw(ctx.getImageData(0, 0, width, height));
    },
    rawToBlob: (img) => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      if (!ctx) return Promise.reject(new Error("tile-capture: no context for rawToBlob"));
      ctx.putImageData(new ImageData(Uint8ClampedArray.from(img.data), img.width, img.height), 0, 0);
      return new Promise((resolve, reject) =>
        c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob null"))), "image/png"),
      );
    },
  };
}

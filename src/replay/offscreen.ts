import { BRUSH_DEFS } from "../brushes/registry";
import type { CanvasSize } from "../canvas-size";
import type { LogEvent } from "../log/events";
import { LayerManager } from "../layered/manager";
import type { LayersConfig } from "../layered/schema";
import { makeSymmetryProxy } from "../symmetry/proxy";
import { SymmetryController, type SymmetryMode } from "../symmetry/controller";
import type { Store } from "../store/base";
import { noopRenderer } from "./bare-world";
import type { ReplayWorld } from "./engine";

// The offscreen replay world (vector-replay P2.2): a ReplayWorld backed by a REAL
// LayerManager + SymmetryController + symmetry proxy - the same building blocks
// main.ts wires for the live app, but on a DETACHED container (no stage). It
// produces real layered PIXELS, so replaying a recorded log here and flattening
// gives a bitmap to hash against the live artwork (the KILL-gate equivalence).
//
// Browser-oriented: LayerManager creates real <canvas> elements, so this runs in
// a page (the CDP smoke), not headless Node. Symmetry tool params beyond the
// centre live in the store, not the log, so the world shares the app's store to
// reproduce them (a documented log-only-replay exclusion - the snapshot carries
// only tool + centre; full symmetry replay needs a schema extension).

export interface OffscreenReplay {
  world: ReplayWorld;
  manager: LayerManager;
  symmetry: SymmetryController;
  // Remove the (off-screen) container from the DOM. Call when the replay is done.
  dispose: () => void;
}

export function createOffscreenReplayWorld(opts: {
  width: number;
  height: number;
  layers?: LayersConfig;
  dpr?: number;
  store: Store;
  // Pre-resolved bitmaps for PasteImage events (keyed by hash) - replay() is sync,
  // so the caller resolves blobs->bitmaps first (see resolvePasteBitmaps).
  pasteBitmaps?: Map<string, ImageBitmap>;
}): OffscreenReplay {
  const dpr = opts.dpr ?? 1;
  const size: CanvasSize = { width: opts.width, height: opts.height };
  // Attach OFF-SCREEN (not detached) so Chrome GPU-accelerates the canvases like the
  // live stage - a detached one renders in software, where heavy low-alpha build-up
  // (Wisp/Spray) accumulates paler. Full size, not 1px-clipped, or Chrome keeps it
  // software. dispose() removes it after. (Safari doesn't split GPU/software.)
  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-99999px;top:0;pointer-events:none;";
  if (typeof document !== "undefined" && document.body) document.body.appendChild(container);
  const manager = new LayerManager({
    container,
    size,
    dpr,
    store: opts.store,
    rendererInit: { lineCap: "round", lineJoin: "round" },
  });
  if (opts.layers) manager.applyConfig(opts.layers, size);
  const symmetry = new SymmetryController(opts.store);
  const host = makeSymmetryProxy(
    manager,
    () => symmetry.transforms(),
    () => manager.strokeAlpha(),
    () => symmetry.mirrorsPoints(),
  );

  const world: ReplayWorld = {
    host,
    store: opts.store,
    createBrush(name) {
      const def = BRUSH_DEFS.find((d) => d.name === name);
      if (!def) throw new Error(`replay: unknown brush "${name}"`);
      return def.create({ host, store: opts.store, getInvisibleOverlay: () => noopRenderer() });
    },
    currentSize: () => manager.currentSize,
    symmetry: {
      beginStroke: (x, y, s) => symmetry.beginStroke(x, y, s),
      setMode: (m) => symmetry.setMode(m as SymmetryMode),
      setCenter: (c) => symmetry.setCenter(c),
      active: () => symmetry.active(),
    },
    setStrokeState({ size: w, alpha, erase, strokeColor, layer }) {
      manager.setLineWidth(w);
      manager.setGlobalAlpha(alpha);
      manager.setEraseMode(erase);
      manager.setStrokeStyle(strokeColor);
      const idx = manager.getConfig().layers.findIndex((l) => l.id === layer);
      if (idx >= 0) manager.setActive(idx);
    },
    applyInit: ({ width, height, layers }) =>
      manager.applyConfig(layers as LayersConfig, { width, height }),
    // A mid-session ConfigOp (layer/map/background change): reconcile PIXEL-
    // PRESERVINGLY (init already built the start state destructively; wiping here
    // would erase everything drawn so far).
    applyConfig: (ev) => {
      if (!ev.layers) return;
      const size = ev.width !== undefined && ev.height !== undefined ? { width: ev.width, height: ev.height } : undefined;
      manager.reconcileConfig(ev.layers, size);
    },
    pasteImage: (ev) => {
      const bmp = opts.pasteBitmaps?.get(ev.hash);
      if (!bmp) return; // blob missing/unresolved -> can't reproduce; skip
      const idx = manager.getConfig().layers.findIndex((l) => l.id === ev.layer);
      if (idx >= 0) manager.setActive(idx);
      manager.drawImageRect(bmp, ev.x, ev.y, ev.width, ev.height);
    },
    beginBuffer: (b) => {
      if (b) manager.beginStroke();
    },
    endBuffer: (b) => {
      if (b) manager.endStroke();
    },
  };
  return { world, manager, symmetry, dispose: () => container.remove() };
}

// Flatten a manager's layers (background + each layer at its opacity) onto a fresh
// canvas and read the pixels - the bitmap the KILL gate hashes. Mirrors
// export.ts flattenLayers but returns ImageData (drawSource can't be read back).
export function flattenToImageData(manager: LayerManager): ImageData {
  const layers = manager.orderedLayers();
  const bg = manager.getBackground();
  const first = layers[0]?.canvas;
  const w = first?.width ?? 1;
  const h = first?.height ?? 1;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("flattenToImageData: no 2D context");
  if (!bg.transparent) {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, w, h);
  }
  for (const layer of layers) {
    ctx.globalAlpha = layer.config.opacity / 100;
    ctx.drawImage(layer.canvas, 0, 0);
  }
  ctx.globalAlpha = 1;
  return ctx.getImageData(0, 0, w, h);
}

// Pre-resolve every PasteImage's blob to an ImageBitmap (keyed by hash) so the sync
// replay() can draw them. Deduped by hash; a missing/unreadable blob is skipped (its
// paste is then a no-op on replay). Pass the result as createOffscreenReplayWorld's
// `pasteBitmaps`.
export async function resolvePasteBitmaps(
  events: readonly LogEvent[],
  blobs: { get(hash: string): Promise<Blob | undefined> },
): Promise<Map<string, ImageBitmap>> {
  const hashes = new Set<string>();
  for (const e of events) if (e.t === "paste") hashes.add(e.hash);
  const map = new Map<string, ImageBitmap>();
  for (const hash of hashes) {
    const blob = await blobs.get(hash);
    if (!blob) continue;
    try {
      map.set(hash, await createImageBitmap(blob));
    } catch {
      // unreadable blob -> leave unresolved; the paste is skipped on replay
    }
  }
  return map;
}

import { createOffscreenRenderer } from "../renderer";
import type { DeviceRect, IRenderer, LineStyle, LineConnectType, RendererInit } from "../renderer";
import type { Pixel } from "../neighbor-finder";
import type { PaintHost } from "../paint-host";
import type { Store } from "../store/base";
import type {
  PaintSnapshot,
  LayerPaint,
  NeighborsMapPaint,
  DecodedPaint,
} from "../store/paint";
import type { CanvasSize } from "../canvas-size";
import { Layer } from "./layer";
import { MapJournal } from "./map-journal";
import { NeighborsMap } from "./neighbors-map";
import { WetStrokeBuffer } from "./wet-stroke";
import {
  LayersConfigSchema,
  MAX_LAYERS_DEFAULT,
  defaultLayer,
  defaultLayersConfig,
  defaultNeighborsMap,
  genId,
  type BackgroundConfig,
  type NeighborsMapConfig,
  type LayerConfig,
  type LayersConfig,
} from "./schema";

const STORE_KEY = "app.layers";

export type LayerManagerOptions = {
  container: HTMLElement;
  size: CanvasSize;
  dpr: number;
  maxLayers?: number;
  store?: Store;
  rendererInit?: RendererInit;
};

// Clamp a cursor index into [0, length-1] (length 0 yields -1, matching the
// previous behaviour for empty lists).
const clampIndex = (i: number, length: number): number =>
  Math.min(Math.max(0, i), length - 1);

// Adjust a cursor index after removing position `removed` from a list now
// `length` long: positions above the removal shift down, the removed slot
// falls back to the item below it, and everything clamps into range.
const shiftAfterRemoval = (
  current: number,
  removed: number,
  length: number,
): number => {
  if (current >= length) return length - 1;
  if (current > removed) return current - 1;
  if (current === removed) return Math.max(0, removed - 1);
  return current;
};

// The facade every brush draws through (the app's PaintHost): one object that
// is at once the IRenderer (strokes hit the active layer), the NeighborFinder
// (points go to the selected neighbors map) and the ConnectRouter (connections
// target layers/maps by stable id). It owns the layer + map collections, the
// active cursors, and persistence of the whole arrangement.
export class LayerManager implements PaintHost {
  private layers: Layer[] = [];
  private activeIndex = 0;
  private neighborsMaps: NeighborsMap[] = [];
  private selectedNeighborsMapIndex = 0;
  // Records point add/remove ops at the map sinks for the tile-undo work
  // (record-only; nothing drains it yet). Keyed by stable map id.
  readonly mapJournal = new MapJournal();
  private background: BackgroundConfig = { color: "#ffffff", transparent: false };
  private listeners = new Set<() => void>();
  readonly maxLayers: number;
  private size: CanvasSize;
  private readonly dpr: number;
  private readonly container: HTMLElement;
  private readonly store?: Store;
  private rendererInit: RendererInit;
  private readonly wet: WetStrokeBuffer;

  constructor(opts: LayerManagerOptions) {
    this.container = opts.container;
    this.size = { ...opts.size };
    this.dpr = opts.dpr;
    this.store = opts.store;
    this.rendererInit = { ...(opts.rendererInit ?? {}) };
    this.wet = new WetStrokeBuffer(opts.container, opts.dpr);

    this.applyContainerSize();

    const persisted = this.loadPersisted();
    // The cap is app policy, not user data: prefer the code-provided value so a
    // bump reaches returning users (whose persisted config pinned the old cap).
    this.maxLayers = opts.maxLayers ?? persisted?.maxLayers ?? MAX_LAYERS_DEFAULT;

    const config = persisted ?? defaultLayersConfig(this.maxLayers);
    // Ensure at least one top-level NeighborsMap exists.
    if (!config.neighborsMaps || config.neighborsMaps.length === 0) {
      config.neighborsMaps = [defaultNeighborsMap([])];
      config.selectedNeighborsMapIndex = 0;
    }
    this.hydrate(config);
  }

  // ---- config load/save ------------------------------------------------------

  // Build layers + maps from a config and clamp the cursor indices. Callers
  // start from an empty state (fresh construction or removeAll()).
  private hydrate(config: LayersConfig): void {
    for (const layerCfg of config.layers) this.spawnLayer(layerCfg);
    // Normalize order on load so config.index (and the 1-based z-index) is a
    // clean 0..n-1 sequence, repairing any legacy/odd saved indices.
    this.renumberLayers();
    for (const nmCfg of config.neighborsMaps) this.spawnNeighborsMap(nmCfg);
    this.activeIndex = clampIndex(config.activeIndex, this.layers.length);
    this.selectedNeighborsMapIndex = clampIndex(
      config.selectedNeighborsMapIndex ?? 0,
      this.neighborsMaps.length,
    );
    this.background = { ...config.background };
  }

  // Drop every layer canvas and map, back to the empty state hydrate expects.
  private removeAll(): void {
    for (const layer of this.layers) layer.canvas.remove();
    this.layers = [];
    this.neighborsMaps = [];
  }

  getConfig(): LayersConfig {
    return structuredClone(this.snapshot());
  }

  applyConfig(config: LayersConfig, size?: CanvasSize): void {
    if (size) {
      this.size = { ...size };
      this.applyContainerSize();
    }
    this.removeAll();
    this.hydrate(config);
    this.persist();
    this.emit();
  }

  // Reconcile the layer/map collection to `config` WITHOUT wiping the pixels of
  // surviving layers or the points of surviving maps (matched by stable id) - the
  // pixel-preserving path a vector-replay ConfigOp needs mid-session. Unlike
  // applyConfig (which removeAll()s and rebuilds EMPTY - correct for init/reset), it
  // keeps each surviving layer's canvas + each surviving map's finder, spawns empty
  // ones only for genuinely new ids, drops removed ones, then reorders + re-applies
  // opacity/name/background/cursors. A mid-session RESIZE can't preserve pixels 1:1,
  // so it falls back to the destructive rebuild (only new-canvas/reset changes size,
  // and that lands on an empty state anyway). Not used by the live app - replay only.
  reconcileConfig(config: LayersConfig, size?: CanvasSize): void {
    if (size && (size.width !== this.size.width || size.height !== this.size.height)) {
      this.applyConfig(config, size);
      return;
    }
    const layerById = new Map(this.layers.map((l) => [l.config.id, l]));
    const targetLayerIds = new Set(config.layers.map((l) => l.id));
    for (const l of this.layers) if (!targetLayerIds.has(l.config.id)) l.canvas.remove();
    this.layers = config.layers.map((lc) => {
      const existing = layerById.get(lc.id);
      if (existing) {
        existing.config.types = lc.types;
        existing.setName(lc.name);
        existing.setOpacity(lc.opacity);
        return existing;
      }
      const layer = new Layer({ ...lc }, this.size, this.dpr, this.rendererInit);
      this.container.appendChild(layer.canvas);
      return layer;
    });
    this.renumberLayers(); // rewrites config.index + z-index to the new order
    const mapById = new Map(this.neighborsMaps.map((m) => [m.config.id, m]));
    this.neighborsMaps = config.neighborsMaps.map((mc) => {
      const existing = mapById.get(mc.id);
      if (existing) {
        existing.config.name = mc.name;
        existing.config.opacity = mc.opacity;
        return existing;
      }
      return new NeighborsMap({ ...mc });
    });
    this.activeIndex = clampIndex(config.activeIndex, this.layers.length);
    this.selectedNeighborsMapIndex = clampIndex(
      config.selectedNeighborsMapIndex ?? 0,
      this.neighborsMaps.length,
    );
    this.background = { ...config.background };
    this.persist();
    this.emit();
  }

  reset(newSize: CanvasSize): void {
    this.size = { ...newSize };
    this.applyContainerSize();
    this.removeAll();
    // Two-layer default: layer-2 selected for painting (matches defaultLayersConfig).
    this.spawnLayer(defaultLayer(0));
    this.spawnLayer(defaultLayer(1));
    this.spawnNeighborsMap(defaultNeighborsMap([]));
    this.activeIndex = 1;
    this.selectedNeighborsMapIndex = 0;
    this.persist();
    this.emit();
  }

  // ---- background + size -----------------------------------------------------

  getBackground(): BackgroundConfig {
    return { ...this.background };
  }

  setBackground(next: Partial<BackgroundConfig>, opts?: { emit?: boolean }): void {
    this.background = { ...this.background, ...next };
    this.persist();
    if (opts?.emit !== false) this.emit();
  }

  get currentSize(): CanvasSize {
    return { ...this.size };
  }

  private applyContainerSize(): void {
    this.container.style.width = `${this.size.width}px`;
    this.container.style.height = `${this.size.height}px`;
  }

  // ---- layer queries ----------------------------------------------------------

  get all(): readonly Layer[] {
    return this.layers;
  }

  // Layers bottom-to-top (ascending config.index) - the single order that
  // export (flattenLayers), the clip recorder, and save-artwork all composite or
  // emit in. config.index == array position (see renumberLayers), but sort
  // explicitly so callers never depend on that internal invariant.
  orderedLayers(): readonly Layer[] {
    return [...this.layers].sort((a, b) => a.config.index - b.config.index);
  }

  get active(): Layer {
    return this.layers[this.activeIndex];
  }

  get activeIdx(): number {
    return this.activeIndex;
  }

  canAddMore(): boolean {
    return this.layers.length < this.maxLayers;
  }

  createMatchingRenderer(): IRenderer {
    return createOffscreenRenderer(this.size, this.dpr);
  }

  private layerById(id: string): Layer | undefined {
    return this.layers.find((l) => l.config.id === id);
  }

  // ---- layer mutations ----------------------------------------------------------

  addLayer(): Layer | null {
    if (!this.canAddMore()) return null;
    const idx = this.layers.length;
    const layer = this.spawnLayer(defaultLayer(idx));
    this.activeIndex = idx;
    this.persist();
    this.emit();
    return layer;
  }

  setActive(index: number): void {
    if (index < 0 || index >= this.layers.length) return;
    if (index === this.activeIndex) return;
    this.activeIndex = index;
    this.applyStyleTo(this.active.renderer);
    this.persist();
    this.emit();
  }

  duplicateLayer(index: number): Layer | null {
    if (!this.canAddMore()) return null;
    const orig = this.layers[index];
    if (!orig) return null;
    const newIdx = this.layers.length;
    const newConfig = structuredClone(orig.config) as LayerConfig;
    newConfig.id = genId();
    newConfig.index = newIdx;
    newConfig.name = `${orig.config.name} copy`;
    const newLayer = this.spawnLayer(newConfig);
    newLayer.renderer.drawSource(orig.renderer); // copy pixel content
    this.activeIndex = newIdx;
    this.persist();
    this.emit();
    return newLayer;
  }

  removeLayer(index: number): boolean {
    if (this.layers.length <= 1) return false;
    const layer = this.layers[index];
    if (!layer) return false;
    layer.canvas.remove();
    this.layers.splice(index, 1);
    this.renumberLayers(); // reassign 0..n-1 indices + refresh z-indices
    this.activeIndex = shiftAfterRemoval(this.activeIndex, index, this.layers.length);
    this.persist();
    this.emit();
    return true;
  }

  // Reorder layers to match `idsBottomToTop` (array order = bottom → top, i.e.
  // config.index 0..n-1). Renumbers indices + z-index and keeps the selected
  // marker on its original layer. Returns false if unchanged.
  reorderByIds(idsBottomToTop: string[]): boolean {
    if (idsBottomToTop.length !== this.layers.length) return false;
    const byId = new Map(this.layers.map((l) => [l.config.id, l] as const));
    const next: Layer[] = [];
    for (const id of idsBottomToTop) {
      const layer = byId.get(id);
      if (!layer) return false; // unknown id → bail (no partial reorder)
      next.push(layer);
    }
    if (next.every((l, i) => l === this.layers[i])) return false; // no-op
    const activeLayer = this.layers[this.activeIndex];
    this.layers = next;
    this.renumberLayers();
    // The selection follows its layer to the new position.
    this.activeIndex = Math.max(0, this.layers.indexOf(activeLayer));
    this.persist();
    this.emit();
    return true;
  }

  setOpacity(index: number, percent: number): void {
    const layer = this.layers[index];
    if (!layer) return;
    layer.setOpacity(percent);
    this.persist();
  }

  setName(index: number, name: string): void {
    const layer = this.layers[index];
    if (!layer) return;
    layer.setName(name);
    this.persist();
    this.emit();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---- IRenderer (delegates to active layer) --------------------------------

  moveTo(x: number, y: number): void { this.active.renderer.moveTo(x, y); }
  lineTo(x: number, y: number): void { this.active.renderer.lineTo(x, y); }
  arc(x: number, y: number, r: number, a0?: number, a1?: number): void {
    this.active.renderer.arc(x, y, r, a0, a1);
  }
  stroke(): void { this.active.renderer.stroke(); }
  drawLine(p1: Pixel, p2: Pixel, style?: LineStyle, kind?: LineConnectType): void {
    // The continuous stroke line goes to the wet buffer while one is open (see
    // beginStroke); the connecting web targets its layer via drawConnectionToLayer,
    // so it stays on the layer and keeps its own per-line build-up.
    (this.wet.target ?? this.active.renderer).drawLine(p1, p2, style, kind);
  }
  drawConnection(p1: Pixel, p2: Pixel, style?: LineStyle, kind?: LineConnectType): void {
    this.active.renderer.drawLine(p1, p2, style, kind);
  }
  drawChisel(p1: Pixel, p2: Pixel, angle: number, style?: LineStyle): void {
    this.active.renderer.drawChisel(p1, p2, angle, style);
  }
  strokeRect(x: number, y: number, w: number, h: number, style?: LineStyle, angle?: number): void {
    this.active.renderer.strokeRect(x, y, w, h, style, angle);
  }
  strokeCircle(x: number, y: number, radius: number, style?: LineStyle): void {
    this.active.renderer.strokeCircle(x, y, radius, style);
  }
  fillEllipse(x: number, y: number, rx: number, ry: number, angle: number, color?: string, alpha?: number): void {
    this.active.renderer.fillEllipse(x, y, rx, ry, angle, color, alpha);
  }
  strokeEllipse(x: number, y: number, rx: number, ry: number, angle: number, style?: LineStyle): void {
    this.active.renderer.strokeEllipse(x, y, rx, ry, angle, style);
  }
  fillRect(x: number, y: number, w: number, h: number, color?: string, angle?: number, alpha?: number): void {
    this.active.renderer.fillRect(x, y, w, h, color, angle, alpha);
  }
  fillCircle(x: number, y: number, radius: number, color?: string, alpha?: number): void {
    this.active.renderer.fillCircle(x, y, radius, color, alpha);
  }
  clear(): void { this.active.renderer.clear(); }
  fillBackground(color: string): void { this.active.renderer.fillBackground(color); }
  drawSource(other: IRenderer, opacity?: number, scale?: number): void {
    this.active.renderer.drawSource(other, opacity, scale);
  }
  drawBitmap(bitmap: CanvasImageSource): void {
    this.active.renderer.drawBitmap(bitmap);
  }
  drawImageRect(img: CanvasImageSource, x: number, y: number, w: number, h: number): void {
    this.active.renderer.drawImageRect(img, x, y, w, h);
  }
  blitPatch(bmp: CanvasImageSource, dest: DeviceRect): void {
    this.active.renderer.blitPatch(bmp, dest);
  }
  toBlob(type?: string): Promise<Blob | null> {
    return this.active.renderer.toBlob(type);
  }

  setLineWidth(w: number): void {
    this.rendererInit.lineWidth = w;
    for (const l of this.layers) l.renderer.setLineWidth(w);
  }
  setStrokeStyle(c: string): void {
    this.rendererInit.strokeStyle = c;
    for (const l of this.layers) l.renderer.setStrokeStyle(c);
  }
  setGlobalAlpha(a: number): void {
    this.rendererInit.globalAlpha = a;
    for (const l of this.layers) l.renderer.setGlobalAlpha(a);
  }
  setEraseMode(on: boolean): void {
    this.rendererInit.eraseMode = on;
    for (const l of this.layers) l.renderer.setEraseMode(on);
  }

  // ---- wet-stroke buffer ------------------------------------------------------

  // Begin buffering a continuous stroke so it composites at one uniform alpha.
  // Brushes that draw a single continuous line (Round) call this around the
  // stroke (via main.ts); others and the connecting web are unaffected.
  beginStroke(): void {
    this.wet.begin(this.size, this.rendererInit, this.active.config.index + 1);
  }

  endStroke(): void {
    this.wet.end(this.active.renderer);
  }

  // ---- NeighborFinder (delegates to the selected map) ------------------------

  private get selectedMap(): NeighborsMap | undefined {
    return this.neighborsMaps[this.selectedNeighborsMapIndex];
  }

  addPixel(x: number, y: number): Pixel {
    const nm = this.selectedMap;
    if (!nm) return { id: 0, x, y };
    const px = nm.finder.addPixel(x, y);
    this.mapJournal.recordAdd(nm.config.id, [px]);
    return px;
  }
  findNeighbors(px: Pixel, radius: number): Pixel[] {
    return this.selectedMap?.finder.findNeighbors(px, radius) ?? [];
  }
  allPixels(): Pixel[] {
    return this.selectedMap?.finder.allPixels() ?? [];
  }
  pixelCount(): number {
    return this.selectedMap?.finder.pixelCount() ?? 0;
  }
  livePixelCount(): number {
    return this.selectedMap?.finder.livePixelCount() ?? 0;
  }
  // Forget dots near (x, y) on the selected map - the one new dots go to and the
  // active web reads from. The removed victims (previously discarded) are kept
  // and journaled so a delta undo can replay the removal.
  forgetPointsNear(x: number, y: number, radius: number): void {
    const nm = this.selectedMap;
    if (!nm) return;
    const removed = nm.finder.removeNear?.(x, y, radius);
    if (removed?.length) this.mapJournal.recordRemove(nm.config.id, removed);
  }

  // ---- ConnectRouter (target specific layers/maps by stable id) -------------

  private mapById(id: string): NeighborsMap | undefined {
    return this.neighborsMaps.find((m) => m.config.id === id);
  }

  listLayers(): { id: string; name: string }[] {
    return this.layers.map((l) => ({ id: l.config.id, name: l.config.name }));
  }
  listMaps(): { id: string; name: string }[] {
    return this.neighborsMaps.map((m) => ({
      id: m.config.id,
      name: m.config.name,
    }));
  }
  addPixelToMap(mapId: string, x: number, y: number): Pixel {
    const nm = this.mapById(mapId);
    if (!nm) return this.addPixel(x, y); // pinned map gone -> selected (records there)
    const px = nm.finder.addPixel(x, y);
    this.mapJournal.recordAdd(nm.config.id, [px]);
    return px;
  }
  findNeighborsInMap(mapId: string, px: Pixel, radius: number): Pixel[] {
    const nm = this.mapById(mapId);
    return nm ? nm.finder.findNeighbors(px, radius) : this.findNeighbors(px, radius);
  }
  mapSize(mapId: string): number {
    const nm = this.mapById(mapId);
    return nm ? nm.finder.pixelCount() : this.pixelCount();
  }
  clearPixels(): void {
    for (const nm of this.neighborsMaps) nm.finder.clear();
  }
  isErasing(): boolean {
    return this.rendererInit.eraseMode === true;
  }
  activeLayerId(): string {
    return this.active.config.id;
  }
  activeConnectionLayerId(): string {
    // Connections bake onto the active layer (no separate connection layer).
    return this.active.config.id;
  }
  selectedMapId(): string {
    return this.selectedMap?.config.id ?? "";
  }
  strokeWidth(): number {
    return this.rendererInit.lineWidth ?? 1;
  }
  strokeAlpha(): number {
    return this.rendererInit.globalAlpha ?? 1;
  }
  drawConnectionToLayer(
    layerId: string,
    p1: Pixel,
    p2: Pixel,
    style?: LineStyle,
    kind?: LineConnectType,
  ): void {
    const layer = this.layerById(layerId) ?? this.active;
    layer.renderer.drawLine(p1, p2, style, kind);
  }

  // ---- neighbors maps ---------------------------------------------------------

  get allNeighborsMaps(): readonly NeighborsMap[] {
    return this.neighborsMaps;
  }

  get selectedNeighborsMapIdx(): number {
    return this.selectedNeighborsMapIndex;
  }

  addNeighborsMap(): NeighborsMap {
    const cfg = defaultNeighborsMap(this.neighborsMaps.map((n) => n.config));
    const nm = this.spawnNeighborsMap(cfg);
    this.selectedNeighborsMapIndex = this.neighborsMaps.length - 1;
    this.persist();
    this.emit();
    return nm;
  }

  removeNeighborsMap(index: number): boolean {
    if (this.neighborsMaps.length <= 1) return false;
    if (!this.neighborsMaps[index]) return false;
    this.neighborsMaps.splice(index, 1);
    this.selectedNeighborsMapIndex = shiftAfterRemoval(
      this.selectedNeighborsMapIndex,
      index,
      this.neighborsMaps.length,
    );
    this.persist();
    this.emit();
    return true;
  }

  selectNeighborsMap(index: number): void {
    if (index < 0 || index >= this.neighborsMaps.length) return;
    if (index === this.selectedNeighborsMapIndex) return;
    this.selectedNeighborsMapIndex = index;
    this.persist();
    this.emit();
  }

  setNeighborsMapName(index: number, name: string): void {
    const nm = this.neighborsMaps[index];
    if (!nm) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === nm.config.name) return;
    nm.setName(trimmed);
    this.persist();
    this.emit();
  }

  // ---- snapshot for persistence --------------------------------------------

  // Sample each layer's bitmap as a PNG blob, keyed by config.index so the apply
  // side can match it back regardless of array order. toBlob copies the bitmap at
  // invocation (only the encode is async), so the returned promises are already
  // point-in-time. Shared by the undo snapshot (getPaintData) and the .nekudot
  // save (save-artwork) so the two model->bytes paths can't drift.
  collectLayerBlobs(): Promise<LayerPaint[]> {
    return Promise.all(
      this.orderedLayers().map((layer) => {
        const layerIndex = layer.config.index;
        return layer.renderer
          .toBlob("image/png")
          .then((blob) => ({ layerIndex, blob }));
      }),
    );
  }

  // Sample each neighbors map's points. Synchronous - call it before awaiting
  // collectLayerBlobs() to keep a snapshot point-in-time. Shared with save-artwork.
  collectMapPixels(): NeighborsMapPaint[] {
    return this.neighborsMaps.map((nm, index) => ({
      index,
      // Carry each point's colour when set (the "From mark" web source reads it),
      // omitting it on uncoloured points to keep the snapshot compact.
      pixels: nm.finder
        .allPixels()
        .map((p) => (p.color ? { x: p.x, y: p.y, color: p.color } : { x: p.x, y: p.y })),
    }));
  }

  async getPaintData(): Promise<PaintSnapshot> {
    // Sample the maps (sync) before awaiting the layer blobs so the whole
    // snapshot is point-in-time: strokes landing mid-encode can't bleed in.
    const neighborsMaps = this.collectMapPixels();
    const layers = await this.collectLayerBlobs();
    return { version: 2, layers, neighborsMaps };
  }

  // Write already-decoded paint to the live model: per layer match by
  // config.index then clear + drawBitmap; per map clear the finder + re-add the
  // points. Shared by undo (applyPaintData) and file load (applyArtwork). Does
  // not close bitmaps or touch config / pixel-log - those stay caller-side.
  // Emits at the end: applyConfig runs just before this (on both paths) and emits
  // while the finders are still empty, so the maps box / navbar would read 0 dots;
  // re-emitting here makes the live counts reflect the restored points.
  applyDecodedPaint(decoded: DecodedPaint): void {
    for (const L of decoded.layers) {
      const layer = this.layers.find((l) => l.config.index === L.index);
      if (!layer) continue;
      layer.renderer.clear();
      for (const bmp of L.bitmaps) layer.renderer.drawBitmap(bmp);
    }
    for (const M of decoded.maps) {
      const nm = this.neighborsMaps[M.index];
      if (!nm) continue;
      nm.finder.clear();
      for (const p of M.pixels) {
        const px = nm.finder.addPixel(p.x, p.y);
        if (p.color) px.color = p.color; // restore the deposited hue (From mark)
      }
    }
    this.emit();
  }

  async applyPaintData(snapshot: PaintSnapshot): Promise<void> {
    // Decode each layer's blob to a bitmap (skip a layer whose capture failed),
    // then hand off to the shared apply path.
    const layers: DecodedPaint["layers"] = [];
    for (const layerPaint of snapshot.layers) {
      if (!layerPaint.blob) continue;
      try {
        const bitmap = await createImageBitmap(layerPaint.blob);
        layers.push({ index: layerPaint.layerIndex, bitmaps: [bitmap] });
      } catch (e) {
        console.warn("applyPaintData: failed to restore layer", e);
      }
    }
    this.applyDecodedPaint({ layers, maps: snapshot.neighborsMaps ?? [] });
    // applyDecodedPaint emits (so the maps box / navbar reflect the restored points).
    for (const L of layers) for (const bmp of L.bitmaps) bmp.close?.();
  }

  // ---- internals ------------------------------------------------------------

  private spawnLayer(cfg: LayerConfig): Layer {
    const layer = new Layer(cfg, this.size, this.dpr, this.rendererInit);
    this.layers.push(layer);
    this.container.appendChild(layer.canvas);
    return layer;
  }

  // Set each layer's config.index to its array position and refresh the canvas
  // z-index. The single source of truth for layer order/stacking.
  private renumberLayers(): void {
    for (let i = 0; i < this.layers.length; i++) {
      this.layers[i].config.index = i;
      this.layers[i].refreshZIndices();
    }
  }

  private spawnNeighborsMap(cfg: NeighborsMapConfig): NeighborsMap {
    const nm = new NeighborsMap(cfg);
    this.neighborsMaps.push(nm);
    return nm;
  }

  private applyStyleTo(r: IRenderer): void {
    if (this.rendererInit.lineWidth !== undefined) r.setLineWidth(this.rendererInit.lineWidth);
    if (this.rendererInit.strokeStyle !== undefined) r.setStrokeStyle(this.rendererInit.strokeStyle);
    if (this.rendererInit.globalAlpha !== undefined) r.setGlobalAlpha(this.rendererInit.globalAlpha);
    r.setEraseMode(this.rendererInit.eraseMode === true);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  // The live config (uncloned) used for persistence; getConfig() deep-clones it
  // for undo snapshots.
  private snapshot(): LayersConfig {
    return {
      maxLayers: this.maxLayers,
      activeIndex: this.activeIndex,
      layers: this.layers.map((l) => l.config),
      neighborsMaps: this.neighborsMaps.map((nm) => nm.config),
      selectedNeighborsMapIndex: this.selectedNeighborsMapIndex,
      background: this.background,
    };
  }

  private persist(): void {
    if (!this.store) return;
    this.store.set(STORE_KEY, this.snapshot());
  }

  private loadPersisted(): LayersConfig | null {
    if (!this.store) return null;
    const raw = this.store.get<unknown>(STORE_KEY);
    if (raw === undefined) return null;
    const parsed = LayersConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }
}

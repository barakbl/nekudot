import { createOffscreenRenderer } from "../renderer";
import type { IRenderer, LineStyle, LineConnectType, RendererInit } from "../renderer";
import type { Pixel } from "../neighbor-finder";
import type { PaintHost } from "../paint-host";
import type { Store } from "../store/base";
import type { PaintSnapshot } from "../store/paint";
import type { CanvasSize } from "../canvas-size";
import { Layer } from "./layer";
import { NeighborsMap } from "./neighbors-map";
import { WetStrokeBuffer } from "./wet-stroke";
import {
  LayersConfigSchema,
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
  private activeConnectionIndex = 0;
  private neighborsMaps: NeighborsMap[] = [];
  private selectedNeighborsMapIndex = 0;
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
    this.maxLayers = persisted?.maxLayers ?? opts.maxLayers ?? 5;

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
    this.activeConnectionIndex = clampIndex(
      config.activeConnectionIndex ?? 0,
      this.layers.length,
    );
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

  reset(newSize: CanvasSize): void {
    this.size = { ...newSize };
    this.applyContainerSize();
    this.removeAll();
    // Two-layer default: layer-2 selected for painting, layer-1 the connection
    // layer (matches defaultLayersConfig).
    this.spawnLayer(defaultLayer(0));
    this.spawnLayer(defaultLayer(1));
    this.spawnNeighborsMap(defaultNeighborsMap([]));
    this.activeIndex = 1;
    this.activeConnectionIndex = 0;
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

  get active(): Layer {
    return this.layers[this.activeIndex];
  }

  get activeIdx(): number {
    return this.activeIndex;
  }

  // The layer currently showing the connecting-line visual (always exactly one,
  // independent of the selected/active layer).
  get activeConnectionIdx(): number {
    return this.activeConnectionIndex;
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
    // If the connection layer is the one currently selected, keep them together
    // by moving the connection to the new layer (which becomes selected).
    const connectionFollows = this.activeConnectionIndex === this.activeIndex;
    const idx = this.layers.length;
    const layer = this.spawnLayer(defaultLayer(idx));
    this.activeIndex = idx;
    if (connectionFollows) this.activeConnectionIndex = idx;
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

  // Move the connecting-line visual to another layer. Visualization-only state,
  // so (like setActive) it's not an undo step.
  setActiveConnection(index: number): void {
    if (index < 0 || index >= this.layers.length) return;
    if (index === this.activeConnectionIndex) return;
    this.activeConnectionIndex = index;
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
    // Duplicating the connection layer carries the connection to the new copy;
    // duplicating any other layer leaves it where it is.
    const duplicatingConnection = index === this.activeConnectionIndex;
    const newLayer = this.spawnLayer(newConfig);
    newLayer.renderer.drawSource(orig.renderer); // copy pixel content
    this.activeIndex = newIdx;
    if (duplicatingConnection) this.activeConnectionIndex = newIdx;
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
    // Same shift for the connection layer; deleting it hands the connection to
    // the layer directly under it (index - 1, clamped).
    this.activeConnectionIndex = shiftAfterRemoval(
      this.activeConnectionIndex,
      index,
      this.layers.length,
    );
    this.persist();
    this.emit();
    return true;
  }

  // Reorder layers to match `idsBottomToTop` (array order = bottom → top, i.e.
  // config.index 0..n-1). Renumbers indices + z-index and keeps the selected and
  // connection markers on their original layers. Returns false if unchanged.
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
    const connLayer = this.layers[this.activeConnectionIndex];
    this.layers = next;
    this.renumberLayers();
    // Markers follow their layers to the new positions.
    this.activeIndex = Math.max(0, this.layers.indexOf(activeLayer));
    this.activeConnectionIndex = Math.max(0, this.layers.indexOf(connLayer));
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
    return this.selectedMap?.finder.addPixel(x, y) ?? { id: 0, x, y };
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
    if (!nm) return this.addPixel(x, y); // pinned map gone -> selected
    return nm.finder.addPixel(x, y);
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
    return (
      this.layers[this.activeConnectionIndex]?.config.id ?? this.active.config.id
    );
  }
  selectedMapId(): string {
    return this.selectedMap?.config.id ?? "";
  }
  strokeWidth(): number {
    return this.rendererInit.lineWidth ?? 1;
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

  async getPaintData(): Promise<PaintSnapshot> {
    // Sample everything before the first await so the snapshot is
    // point-in-time: the map points and layer indices here, and the layer
    // bitmaps via toBlob (which copies the bitmap at invocation — only the
    // encoding is async). Strokes landing while blobs encode can't bleed in.
    const neighborsMaps = this.neighborsMaps.map((nm, i) => ({
      index: i,
      pixels: nm.finder.allPixels().map((p) => ({ x: p.x, y: p.y })),
    }));
    const layers = await Promise.all(
      this.layers.map((layer) => {
        const layerIndex = layer.config.index;
        return layer.renderer
          .toBlob("image/png")
          .then((blob) => ({ layerIndex, blob }));
      }),
    );
    return {
      version: 2,
      layers,
      neighborsMaps,
    };
  }

  async applyPaintData(snapshot: PaintSnapshot): Promise<void> {
    for (const layerPaint of snapshot.layers) {
      const layer = this.layers.find(
        (l) => l.config.index === layerPaint.layerIndex,
      );
      if (!layer || !layerPaint.blob) continue;
      try {
        const bitmap = await createImageBitmap(layerPaint.blob);
        layer.renderer.clear();
        layer.renderer.drawBitmap(bitmap);
        bitmap.close?.();
      } catch (e) {
        console.warn("applyPaintData: failed to restore layer", e);
      }
    }

    for (const nmPaint of snapshot.neighborsMaps ?? []) {
      const nm = this.neighborsMaps[nmPaint.index];
      if (!nm) continue;
      nm.finder.clear();
      for (const p of nmPaint.pixels) nm.finder.addPixel(p.x, p.y);
    }

    // applyConfig (called just before this on undo/redo) emits while the finders
    // are still empty, so the maps box would show 0 dots. Re-emit now that the
    // points are restored so the live counts reflect the snapshot.
    this.emit();
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
      activeConnectionIndex: this.activeConnectionIndex,
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

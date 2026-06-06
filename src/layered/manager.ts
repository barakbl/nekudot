import { createOffscreenRenderer, CanvasRenderer } from "../renderer";
import type { IRenderer, LineStyle, LineConnectType, RendererInit } from "../renderer";
import type { NeighborFinder, Pixel } from "../neighbor-finder";
import type { ConnectRouter } from "../connecting-types";
import type { Store } from "../store/base";
import type { PaintSnapshot } from "../store/paint";
import type { CanvasSize } from "../canvas-size";
import { Layer } from "./layer";
import { NeighborsMap } from "./neighbors-map";
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

export class LayerManager implements IRenderer, NeighborFinder, ConnectRouter {
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

  // Per-stroke "wet" buffer for continuous strokes. While a partly-transparent
  // line is in progress, drawLine() targets this opaque off-buffer (shown live
  // at the stroke opacity) and endStroke() composites it onto the active layer
  // in one pass — so the stroke reads as one uniform alpha instead of darker
  // dots where each segment's round caps overlap at the joints. Lazily created.
  private wetCanvas: HTMLCanvasElement | null = null;
  private wetRenderer: CanvasRenderer | null = null;
  private wetActive = false;
  private wetAlpha = 1;

  constructor(opts: LayerManagerOptions) {
    this.container = opts.container;
    this.size = { ...opts.size };
    this.dpr = opts.dpr;
    this.store = opts.store;
    this.rendererInit = { ...(opts.rendererInit ?? {}) };

    this.applyContainerSize();

    const persisted = this.loadPersisted();
    this.maxLayers = persisted?.maxLayers ?? opts.maxLayers ?? 5;

    const config = persisted ?? defaultLayersConfig(this.maxLayers);
    // Ensure at least one top-level NeighborsMap exists.
    if (!config.neighborsMaps || config.neighborsMaps.length === 0) {
      config.neighborsMaps = [defaultNeighborsMap([])];
      config.selectedNeighborsMapIndex = 0;
    }
    for (const layerCfg of config.layers) this.spawnLayer(layerCfg);
    // Normalize order on load so config.index (and the 1-based z-index) is a
    // clean 0..n-1 sequence, repairing any legacy/odd saved indices.
    this.renumberLayers();
    for (const nmCfg of config.neighborsMaps) this.spawnNeighborsMap(nmCfg);
    this.activeIndex = Math.min(
      Math.max(0, config.activeIndex),
      this.layers.length - 1,
    );
    this.activeConnectionIndex = Math.min(
      Math.max(0, config.activeConnectionIndex ?? 0),
      this.layers.length - 1,
    );
    this.selectedNeighborsMapIndex = Math.min(
      Math.max(0, config.selectedNeighborsMapIndex ?? 0),
      this.neighborsMaps.length - 1,
    );
    this.background = { ...config.background };
  }

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

  reset(newSize: CanvasSize): void {
    this.size = { ...newSize };
    this.applyContainerSize();
    for (const layer of this.layers) {
      layer.canvas.remove();
    }
    this.layers = [];
    this.neighborsMaps = [];
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

  getConfig(): LayersConfig {
    return {
      maxLayers: this.maxLayers,
      activeIndex: this.activeIndex,
      activeConnectionIndex: this.activeConnectionIndex,
      layers: this.layers.map((l) =>
        structuredClone(l.config) as LayerConfig,
      ),
      neighborsMaps: this.neighborsMaps.map(
        (nm) => structuredClone(nm.config) as NeighborsMapConfig,
      ),
      selectedNeighborsMapIndex: this.selectedNeighborsMapIndex,
      background: { ...this.background },
    };
  }

  applyConfig(config: LayersConfig, size?: CanvasSize): void {
    if (size) {
      this.size = { ...size };
      this.applyContainerSize();
    }
    for (const layer of this.layers) {
      layer.canvas.remove();
    }
    this.layers = [];
    this.neighborsMaps = [];
    for (const layerCfg of config.layers) this.spawnLayer(layerCfg);
    this.renumberLayers(); // clean 0..n-1 order + 1-based z-index
    for (const nmCfg of config.neighborsMaps) this.spawnNeighborsMap(nmCfg);
    this.activeIndex = Math.min(
      Math.max(0, config.activeIndex),
      this.layers.length - 1,
    );
    this.activeConnectionIndex = Math.min(
      Math.max(0, config.activeConnectionIndex ?? 0),
      this.layers.length - 1,
    );
    this.selectedNeighborsMapIndex = Math.min(
      Math.max(0, config.selectedNeighborsMapIndex ?? 0),
      this.neighborsMaps.length - 1,
    );
    this.background = { ...config.background };
    this.persist();
    this.emit();
  }

  private applyContainerSize(): void {
    this.container.style.width = `${this.size.width}px`;
    this.container.style.height = `${this.size.height}px`;
  }

  // ---- queries --------------------------------------------------------------

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

  // ---- mutations ------------------------------------------------------------

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
    if (this.activeIndex >= this.layers.length) {
      this.activeIndex = this.layers.length - 1;
    } else if (this.activeIndex > index) {
      this.activeIndex -= 1;
    } else if (this.activeIndex === index) {
      this.activeIndex = Math.max(0, index - 1);
    }
    // Same shift for the connection layer; deleting it hands the connection to
    // the layer directly under it (index - 1, clamped).
    if (this.activeConnectionIndex >= this.layers.length) {
      this.activeConnectionIndex = this.layers.length - 1;
    } else if (this.activeConnectionIndex > index) {
      this.activeConnectionIndex -= 1;
    } else if (this.activeConnectionIndex === index) {
      this.activeConnectionIndex = Math.max(0, index - 1);
    }
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

  private pixelListeners = new Set<
    (neighborsMapIndex: number, x: number, y: number) => void
  >();

  subscribePixelAdded(
    fn: (neighborsMapIndex: number, x: number, y: number) => void,
  ): () => void {
    this.pixelListeners.add(fn);
    return () => this.pixelListeners.delete(fn);
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
    const target = this.wetActive && this.wetRenderer ? this.wetRenderer : this.active.renderer;
    target.drawLine(p1, p2, style, kind);
  }
  drawConnection(p1: Pixel, p2: Pixel, style?: LineStyle, kind?: LineConnectType): void {
    this.active.renderer.drawLine(p1, p2, style, kind);
  }
  drawChisel(p1: Pixel, p2: Pixel, angle: number, style?: LineStyle): void {
    this.active.renderer.drawChisel(p1, p2, angle, style);
  }

  strokeRect(
    x: number,
    y: number,
    w: number,
    h: number,
    style?: LineStyle,
    angle?: number,
  ): void {
    this.active.renderer.strokeRect(x, y, w, h, style, angle);
  }
  strokeCircle(x: number, y: number, radius: number, style?: LineStyle): void {
    this.active.renderer.strokeCircle(x, y, radius, style);
  }
  fillEllipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    angle: number,
    color?: string,
    alpha?: number,
  ): void {
    this.active.renderer.fillEllipse(x, y, rx, ry, angle, color, alpha);
  }
  strokeEllipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    angle: number,
    style?: LineStyle,
  ): void {
    this.active.renderer.strokeEllipse(x, y, rx, ry, angle, style);
  }
  fillRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color?: string,
    angle?: number,
    alpha?: number,
  ): void {
    this.active.renderer.fillRect(x, y, w, h, color, angle, alpha);
  }
  fillCircle(
    x: number,
    y: number,
    radius: number,
    color?: string,
    alpha?: number,
  ): void {
    this.active.renderer.fillCircle(x, y, radius, color, alpha);
  }
  clear(): void { this.active.renderer.clear(); }

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
  fillBackground(color: string): void { this.active.renderer.fillBackground(color); }
  drawSource(other: IRenderer, opacity?: number, scale?: number): void {
    this.active.renderer.drawSource(other, opacity, scale);
  }

  // ---- wet-stroke buffer ------------------------------------------------------

  // Begin buffering a continuous stroke so it composites at one uniform alpha.
  // Only engages for a partly-transparent, non-erasing stroke — opaque draws are
  // already uniform, erasing paints straight through. Brushes that draw a single
  // continuous line (Round) call this around the stroke (via main.ts); others and
  // the connecting web are unaffected. Safe no-op outside that case.
  beginStroke(): void {
    this.wetActive = false;
    const alpha = this.rendererInit.globalAlpha ?? 1;
    if (this.rendererInit.eraseMode || alpha <= 0 || alpha >= 1) return;
    if (!this.wetCanvas) {
      const c = document.createElement("canvas");
      c.style.position = "absolute";
      c.style.left = "0";
      c.style.top = "0";
      c.style.pointerEvents = "none";
      this.container.appendChild(c);
      this.wetCanvas = c;
    }
    const c = this.wetCanvas;
    c.width = Math.round(this.size.width * this.dpr);
    c.height = Math.round(this.size.height * this.dpr);
    c.style.width = `${this.size.width}px`;
    c.style.height = `${this.size.height}px`;
    c.style.zIndex = String(this.active.config.index + 1); // sit on the active layer
    c.style.opacity = String(alpha); // live preview at the stroke's own opacity
    const ctx = c.getContext("2d");
    if (!ctx) return;
    // Resizing the canvas reset its context; rebuild a renderer that mirrors the
    // active stroke style but paints opaque (opacity is applied once on commit).
    this.wetRenderer = new CanvasRenderer(ctx, {
      ...this.rendererInit,
      dpr: this.dpr,
      globalAlpha: 1,
      eraseMode: false,
    });
    this.wetAlpha = alpha;
    this.wetActive = true;
  }

  // Commit the buffered stroke: composite the opaque buffer onto the active layer
  // at the stroke opacity (one pass → uniform), then clear and hide it.
  endStroke(): void {
    if (!this.wetActive || !this.wetRenderer || !this.wetCanvas) {
      this.wetActive = false;
      return;
    }
    this.active.renderer.drawSource(this.wetRenderer, this.wetAlpha);
    const ctx = this.wetCanvas.getContext("2d");
    ctx?.clearRect(0, 0, this.wetCanvas.width, this.wetCanvas.height);
    this.wetCanvas.style.opacity = "0";
    this.wetActive = false;
  }
  drawBitmap(bitmap: CanvasImageSource): void {
    this.active.renderer.drawBitmap(bitmap);
  }
  toBlob(type?: string): Promise<Blob | null> {
    return this.active.renderer.toBlob(type);
  }

  // ---- NeighborFinder (delegates to active layer) ---------------------------

  addPixel(x: number, y: number): Pixel {
    const nm = this.neighborsMaps[this.selectedNeighborsMapIndex];
    if (!nm) return { id: 0, x, y };
    const px = nm.finder.addPixel(x, y);
    for (const fn of this.pixelListeners)
      fn(this.selectedNeighborsMapIndex, x, y);
    return px;
  }
  findNeighbors(px: Pixel, radius: number): Pixel[] {
    const nm = this.neighborsMaps[this.selectedNeighborsMapIndex];
    return nm?.finder.findNeighbors(px, radius) ?? [];
  }
  allPixels(): Pixel[] {
    const nm = this.neighborsMaps[this.selectedNeighborsMapIndex];
    return nm?.finder.allPixels() ?? [];
  }
  pixelCount(): number {
    const nm = this.neighborsMaps[this.selectedNeighborsMapIndex];
    return nm?.finder.pixelCount() ?? 0;
  }

  // ---- ConnectRouter (target specific layers/maps by stable id) -------------

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
    const idx = this.neighborsMaps.findIndex((m) => m.config.id === mapId);
    if (idx < 0) return this.addPixel(x, y); // pinned map gone -> selected
    const px = this.neighborsMaps[idx].finder.addPixel(x, y);
    for (const fn of this.pixelListeners) fn(idx, x, y);
    return px;
  }
  findNeighborsInMap(mapId: string, px: Pixel, radius: number): Pixel[] {
    const nm = this.neighborsMaps.find((m) => m.config.id === mapId);
    return nm ? nm.finder.findNeighbors(px, radius) : this.findNeighbors(px, radius);
  }
  mapSize(mapId: string): number {
    const nm = this.neighborsMaps.find((m) => m.config.id === mapId);
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
    return this.neighborsMaps[this.selectedNeighborsMapIndex]?.config.id ?? "";
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
    const layer = this.layers.find((l) => l.config.id === layerId) ?? this.active;
    layer.renderer.drawLine(p1, p2, style, kind);
  }

  // ---- snapshot for persistence --------------------------------------------

  async getPaintData(): Promise<PaintSnapshot> {
    const layers = await Promise.all(
      this.layers.map(async (layer) => ({
        layerIndex: layer.config.index,
        blob: await layer.renderer.toBlob("image/png"),
      })),
    );
    const neighborsMaps = this.neighborsMaps.map((nm, i) => ({
      index: i,
      pixels: nm.finder.allPixels().map((p) => ({ x: p.x, y: p.y })),
    }));
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
    if (this.selectedNeighborsMapIndex >= this.neighborsMaps.length) {
      this.selectedNeighborsMapIndex = this.neighborsMaps.length - 1;
    } else if (this.selectedNeighborsMapIndex > index) {
      this.selectedNeighborsMapIndex -= 1;
    } else if (this.selectedNeighborsMapIndex === index) {
      this.selectedNeighborsMapIndex = Math.max(0, index - 1);
    }
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

  private applyStyleTo(r: IRenderer): void {
    if (this.rendererInit.lineWidth !== undefined) r.setLineWidth(this.rendererInit.lineWidth);
    if (this.rendererInit.strokeStyle !== undefined) r.setStrokeStyle(this.rendererInit.strokeStyle);
    if (this.rendererInit.globalAlpha !== undefined) r.setGlobalAlpha(this.rendererInit.globalAlpha);
    r.setEraseMode(this.rendererInit.eraseMode === true);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

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

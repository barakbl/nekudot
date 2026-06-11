import type { IRenderer } from "./renderer";
import type { NeighborFinder, Pixel } from "./neighbor-finder";
import type { Store } from "./store/base";
import {
  DASH_STYLES,
  DASH_PATTERNS,
  DASH_ICONS,
  type DashStyle,
  type ConnectRouter,
} from "./connecting-types";
import {
  ROUTING_PRESETS,
  flattenRouting,
  type RoutingSettings,
} from "./brushes/connections/routing";
import { createConnection } from "./brushes/connections/registry";
import type { ConnectionBase, ConnectionDeps } from "./brushes/connections/base";
import type { PixelLog, BrushType } from "./pixel-log";

// Re-exported so brushes can keep importing dash helpers from "./base".
export { DASH_STYLES, DASH_PATTERNS, DASH_ICONS };
export type { DashStyle };

// Fields shared by every setting kind; `key` doubles as the persistence key
// suffix (brush.<name>.<key>).
type BrushSettingCommon = {
  key: string;
  label: string;
  section?: string;
};

export type BrushSetting =
  | (BrushSettingCommon & {
      kind: "number";
      min: number;
      max: number;
      step?: number;
      value: number;
      onChange: (v: number) => void;
    })
  | (BrushSettingCommon & {
      kind: "color";
      value: string;
      onChange: (v: string) => void;
    })
  | (BrushSettingCommon & {
      kind: "select";
      options: readonly string[];
      // Optional friendly labels keyed by option value (e.g. layer id -> name).
      optionLabels?: Record<string, string>;
      icons?: Record<string, string>;
      value: string;
      onChange: (v: string) => void;
    })
  | (BrushSettingCommon & {
      kind: "boolean";
      value: boolean;
      onChange: (v: boolean) => void;
    });

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export abstract class BrushBase {
  seed: number;
  private rng: () => number;

  // The connection this brush weaves (web, fur, lace…), or null for brushes that
  // don't connect. Owns all connecting state + the connecting engine (see
  // src/brushes/connections/base.ts). A connecting brush attaches one via
  // initConnection(); applyArtStylePreset() swaps it.
  protected connection: ConnectionBase | null = null;

  // Connection-sampler throttle state (see CONNECT_SAMPLE_SPACING). Reset each
  // stroke in strokeEnd(); the first sample of a stroke always deposits.
  private lastConnectX = 0;
  private lastConnectY = 0;
  private hasConnectSample = false;

  // Append-only provenance log; injected by the app (null in tests).
  private pixelLog: PixelLog | null = null;
  attachPixelLog(log: PixelLog): void {
    this.pixelLog = log;
  }

  // The dash of the visible stroke for this brush; "solid" unless overridden.
  protected strokeDashValue(): DashStyle {
    return "solid";
  }

  // The renderer is the LayerManager at runtime; expose its routing surface
  // when present, else null (e.g. in tests with a bare renderer/finder). Used
  // for the erase check + pixel-log context; connecting uses the preset's copy.
  protected get router(): ConnectRouter | null {
    const r = this.renderer as unknown as Partial<ConnectRouter>;
    return r && typeof r.listLayers === "function"
      ? (r as ConnectRouter)
      : null;
  }

  constructor(
    protected renderer: IRenderer,
    protected finder: NeighborFinder,
    seed: number = (Math.random() * 0x100000000) >>> 0,
    protected store?: Store,
  ) {
    this.seed = seed;
    this.rng = mulberry32(seed);
  }

  abstract name(): string;

  // Whether selecting this brush puts the canvas into erase mode (destination-out).
  // The Eraser overrides this; main.ts reads it on brush switch to toggle erase.
  erases(): boolean {
    return false;
  }

  strokeStart(_x: number, _y: number): void {}

  // Template: deposit the point, run the child's stroke logic, then let the
  // connection (if any) weave its web.
  // sample=false marks a sub-frame (coalesced) point: draw the visible mark but
  // don't grow the point cloud or weave the web. The pointer loop passes false
  // for every coalesced sub-sample except the last of a connecting brush, so the
  // web samples once per frame (Harmony's per-move model) instead of at the
  // hardware's report rate — feeding every sub-sample made the web build up
  // ~quadratically with the pointer's rate. The line still draws every sample.
  stroke(x: number, y: number, sample = true): void {
    // While erasing, paint (erase) the mark. The Eraser brush may also weave a
    // connection so the web gets erased too — run connect() with an ephemeral
    // point so erasing never grows the point cloud. connect() is a no-op when
    // the routing mode is "none" (the eraser's default), so a plain eraser just
    // wipes its own line.
    if (this.router?.isErasing() === true) {
      this.onStroke(x, y, { id: -1, x, y });
      if (sample) this.connection?.connect({ id: -1, x, y });
      return;
    }
    if (!sample) {
      this.onStroke(x, y, { id: -1, x, y });
      return;
    }
    // Optional per-distance throttle (the "Sample step" dial, off by default):
    // stipples the web into evenly spaced tufts. Skips deposit+connect but still
    // draws the mark.
    if (
      this.connection &&
      !this.armConnectSample(x, y, this.connection.sampleSpacing())
    ) {
      this.onStroke(x, y, { id: -1, x, y });
      return;
    }
    this.connection?.beforeDeposit(x, y);
    const current = this.depositPixel(x, y);
    this.onStroke(x, y, current);
    this.connection?.connect(current);
  }

  // True if (x,y) is far enough (>= step px) from the last connection sample to
  // deposit + connect (or it's the stroke's first sample); advances the marker
  // when so. step <= 0 disables throttling (sample every input point).
  private armConnectSample(x: number, y: number, step: number): boolean {
    if (step <= 0) return true;
    if (!this.hasConnectSample) {
      this.hasConnectSample = true;
      this.lastConnectX = x;
      this.lastConnectY = y;
      return true;
    }
    if (Math.hypot(x - this.lastConnectX, y - this.lastConnectY) < step)
      return false;
    this.lastConnectX = x;
    this.lastConnectY = y;
    return true;
  }

  // Override in subclasses for brush-specific stroke drawing.
  protected onStroke(_x: number, _y: number, _current: Pixel): void {}

  // Whether this brush draws a connecting web (and so shows the navbar
  // Connecting combo + Connecting settings box).
  supportsConnecting(): boolean {
    return this.connection !== null;
  }

  // Whether this brush draws a single continuous line that should be buffered
  // into one uniform-opacity stroke (see LayerManager.beginStroke) — so a faint
  // line doesn't show darker dots where each segment's round caps overlap.
  // Round does; shape/texture brushes (which stamp discrete marks) don't.
  bufferedStroke(): boolean {
    return false;
  }

  // The active connection (null for non-connecting brushes). The settings panel
  // reads it to learn which connecting dials open by default.
  activeConnection(): ConnectionBase | null {
    return this.connection;
  }

  strokeEnd(): void {
    this.hasConnectSample = false;
    this.connection?.resetStroke();
    void this.pixelLog?.flush();
  }

  // Store the pixel into the configured trail map and append its provenance row.
  // The trail-map routing is the connection's job (selected / a pinned map / no
  // trail); a non-connecting brush just deposits into the selected map.
  private depositPixel(x: number, y: number): Pixel {
    let px: Pixel;
    let mapId: string | undefined;
    let log = true;
    if (this.connection) {
      ({ px, mapId, log } = this.connection.deposit(x, y));
    } else {
      px = this.finder.addPixel(x, y);
      mapId = this.router?.selectedMapId();
    }
    if (log) this.logPixel(x, y, mapId);
    return px;
  }

  private logPixel(x: number, y: number, mapId: string | undefined): void {
    const r = this.router;
    if (this.pixelLog && r && mapId) {
      this.pixelLog.append({
        brush_type: this.name() as BrushType,
        dash: this.strokeDashValue(),
        width: r.strokeWidth(),
        x,
        y,
        layer_id: r.activeLayerId(),
        pixel_map_id: mapId,
      });
    }
  }

  clear(): void {
    this.finder.clear(); // active canvas (manager's clear)
    this.router?.clearPixels(); // neighbor cloud (not cleared by canvas clear)
  }

  getSettings(): BrushSetting[] {
    return this.persistSettings(this.connection ? this.connection.sliders() : []);
  }

  // Called when this brush becomes the active tool. Default no-op; brushes can
  // override to apply their art style etc.
  onSelect(): void {}

  // Opacity to apply to the main-nav stroke slider when selected, or undefined
  // to leave it untouched.
  getSelectOpacity(): number | undefined {
    return undefined;
  }

  // --- connection wiring -----------------------------------------------------

  // Connecting brushes (Round) call this from their constructor to
  // attach a default connection. Non-connecting brushes never do, so
  // `connection` stays null and the connecting UI/engine never engages for them.
  protected initConnection(name: string): void {
    this.connection = createConnection(name, this.connectionDeps());
  }

  private connectionDeps(): ConnectionDeps {
    return {
      // Live accessor: Handfree swaps its renderer to a tiling one mid-stroke.
      renderer: () => this.renderer,
      finder: this.finder,
      store: this.store,
      // Share the brush's seeded RNG so the connecting engine consumes it in the
      // same order as when this logic lived on the brush — output is identical.
      random: () => this.random(),
    };
  }

  // Swap the active connection style (web → fur …), preserving routing choices.
  // A no-op for brushes that don't connect (no connection attached).
  applyArtStylePreset(name: string): void {
    if (!this.connection) return;
    const next = createConnection(name, this.connectionDeps());
    next.copyRoutingFrom(this.connection);
    this.connection = next;
  }

  // Apply only a routing preset (e.g. a brush whose default is "no connect").
  applyRoutingPreset(name: string): void {
    if (!this.connection) return;
    const routing = (ROUTING_PRESETS as Record<string, RoutingSettings>)[name];
    if (routing) this.connection.applyFlat(flattenRouting(routing));
  }

  // Apply the named routing + art-style presets together (New art / load).
  applyConnectingPreset(name: string = "classic"): void {
    if (!this.connection) return;
    this.applyArtStylePreset(name);
    this.applyRoutingPreset(name);
  }

  setSeed(seed: number): void {
    this.seed = seed;
    this.rng = mulberry32(seed);
  }

  protected random(): number {
    return this.rng();
  }

  // Wrap every setting's onChange so the new value is also persisted under
  // brush.<name>.<key>. The value type varies per setting kind, but the wrapper
  // is the same for all of them: forward, then store.
  protected persistSettings(settings: BrushSetting[]): BrushSetting[] {
    if (!this.store) return settings;
    const store = this.store;
    const brushName = this.name();
    for (const s of settings) {
      const key = `brush.${brushName}.${s.key}`;
      const orig = s.onChange as (v: unknown) => void;
      s.onChange = (v: unknown) => {
        orig(v);
        store.set(key, v);
      };
    }
    return settings;
  }

  restore(): void {
    if (!this.store) return;
    const brushName = this.name();
    for (const s of this.getSettings()) {
      const saved = this.store.get<unknown>(`brush.${brushName}.${s.key}`);
      if (saved !== undefined) (s.onChange as (v: unknown) => void)(saved);
    }
  }
}

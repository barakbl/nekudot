import type { IRenderer } from "./renderer";
import type { NeighborFinder, Pixel } from "./neighbor-finder";
import type { PaintHost } from "./paint-host";
import type { Store } from "./store/base";
import {
  DASH_STYLES,
  DASH_PATTERNS,
  DASH_ICONS,
  ROUTING_SECTION,
  STYLE_SECTION,
  type DashStyle,
  type ConnectingFlat,
} from "./connecting-types";
import {
  ROUTING_PRESETS,
  flattenRouting,
  type RoutingSettings,
} from "./brushes/connections/routing";
import { createConnection } from "./brushes/connections/registry";
import type { ConnectionBase, ConnectionDeps } from "./brushes/connections/base";
import type { PixelLog, BrushType } from "./pixel-log";
import {
  MOUSE_SAMPLE,
  PenSmoother,
  penFactor,
  SIZE_FLOOR,
  ALPHA_FLOOR,
  DIAL_FLOOR,
  type PenSample,
} from "./pen";
import { Streamliner } from "./brushes/streamline";

// Re-exported so brushes can keep importing dash helpers from "./base".
export { DASH_STYLES, DASH_PATTERNS, DASH_ICONS };
export type { DashStyle };

// Fields shared by every setting kind; `key` doubles as the persistence key
// suffix (brush.<name>.<key>).
type BrushSettingCommon = {
  key: string;
  label: string;
  section?: string;
  // Show this row only while another setting in the same group/run satisfies the
  // predicate - so a dial that does nothing in its current context (e.g. Spread
  // at Weight 1, Grain angle at Grain 0) hides until it bites. The panel watches
  // `key`'s live value and toggles this row in place (no re-render). When present,
  // it overrides the value-based "More" fold (true -> shown, false -> hidden).
  visibleWhen?: { key: string; when: (v: string | number | boolean) => boolean };
};

export type BrushSetting =
  | (BrushSettingCommon & {
      kind: "number";
      min: number;
      max: number;
      step?: number;
      value: number;
      // Optional unit suffix shown after the value readout (e.g. "°", "%").
      unit?: string;
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
      // Render as a two-way (or few-way) button group instead of a dropdown.
      segmented?: boolean;
      value: string;
      onChange: (v: string) => void;
    })
  | (BrushSettingCommon & {
      kind: "boolean";
      value: boolean;
      onChange: (v: boolean) => void;
    })
  | (BrushSettingCommon & {
      // A two-handle range slider (one widget, low + high). Persisted/restored
      // as the [low, high] tuple via `value`, so it rides the same machinery.
      kind: "range";
      min: number;
      max: number;
      step?: number;
      value: [number, number];
      onChange: (low: number, high: number) => void;
    })
  | (BrushSettingCommon & {
      // A brush-supplied widget (e.g. the Color Pen direction wheel) - no value
      // to persist; the brush owns its own state.
      kind: "custom";
      value: string;
      el: HTMLElement;
      // Inline row (label left, control right) instead of the full-width column.
      inline?: boolean;
    });

// The value a brush setting carries, by kind: a number, a colour/option string,
// a boolean, or a [low, high] range tuple. Never undefined - persistSetting and
// Store.set forbid persisting undefined (it serializes to the string "undefined",
// which lingers and reads back as a parse error).
export type SettingValue = BrushSetting["value"];

// Push a stored/loaded value into a setting's binding, dispatching on kind so
// a malformed stored value (wrong type) is ignored rather than applied. The
// one place "a raw value becomes a setting change" lives — used by restore,
// the panel's preset application, and elsewhere.
export function applySettingValue(s: BrushSetting, v: unknown): void {
  if (s.kind === "number" && typeof v === "number") s.onChange(v);
  else if (s.kind === "boolean" && typeof v === "boolean") s.onChange(v);
  else if ((s.kind === "select" || s.kind === "color") && typeof v === "string")
    s.onChange(v);
  else if (
    s.kind === "range" &&
    Array.isArray(v) &&
    v.length === 2 &&
    typeof v[0] === "number" &&
    typeof v[1] === "number"
  )
    s.onChange(v[0], v[1]);
}

// Art-style dials are persisted per art style (so each style keeps its own
// look); every other setting is a plain per-key value. See BrushBase.restore /
// persistSetting.
export function isStyleDial(s: BrushSetting): boolean {
  return s.section === STYLE_SECTION;
}

// A connecting setting (routing or art-style dial), shown on the Connecting
// tab; everything else is a brush-own setting on the Brush tab.
export function isConnectingSetting(s: BrushSetting): boolean {
  return s.section === ROUTING_SECTION || s.section === STYLE_SECTION;
}

// The pen-modulation settings group. Hidden in Brush settings (and its
// modulation switched off) when pen support is toggled off in the More menu.
export const PEN_SECTION = "Pen";

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Speed-to-width taper for non-stylus strokes ("grace for mouse + finger"):
// map a smoothed stroke speed (canvas px per ms) to a width multiplier - a
// quick flick draws thin, a slow drag stays full. Full width at/below MIN,
// thinning linearly to FLOOR at/above MAX.
const SPEED_TAPER_MIN = 0.4;
const SPEED_TAPER_MAX = 4.0;
const SPEED_TAPER_FLOOR = 0.35;
const SPEED_TAPER_STEP = 0.25; // per-sample EMA fraction that smooths raw speed

export function speedTaperFactor(speed: number): number {
  const span = SPEED_TAPER_MAX - SPEED_TAPER_MIN;
  const t = Math.min(1, Math.max(0, (speed - SPEED_TAPER_MIN) / span));
  return 1 - t * (1 - SPEED_TAPER_FLOOR);
}

export abstract class BrushBase {
  seed: number;
  private rng: () => number;

  // The connection this brush weaves (web, fur, lace…), or null for brushes that
  // don't connect. Owns all connecting state + the connecting engine (see
  // src/brushes/connections/base.ts). A connecting brush attaches one via
  // initConnection(); applyArtStylePreset() swaps it.
  protected connection: ConnectionBase | null = null;

  // The active connection's FACTORY dial values (snapshot at creation, before any
  // saved customisation is restored). The "Web weight" group reads this as the
  // per-style "Normal" baseline so it survives the user customising the dials.
  private connectionFactoryFlat: ConnectingFlat = {};

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

  // --- pen (stylus) modulation ------------------------------------------------
  // Which pen inputs modulate what — the "Pen" section in Brush settings,
  // persisted per brush like every other setting. The bound sliders keep
  // their meaning as the MAXIMUM; pen input scales down from there.
  protected penPressureSize = true;
  protected penPressureAlpha = false;
  protected penTiltSize = false;
  protected penTiltAlpha = false;
  protected penWebDensity = false;
  protected penWebRadius = false;
  // Feel knobs (0..100 sliders). Smoothing 65 → EMA step 0.35 and Response 50
  // → gamma 0.7, the original constants — defaults change nothing.
  protected penSmoothing = 65;
  protected penResponse = 50;

  private penSmoother = new PenSmoother();
  private pen: PenSample = MOUSE_SAMPLE;

  // Speed-to-width taper (see speedTaperFactor). Non-pen only - a real pen
  // already varies width by pressure. Per-brush opt-in via speedTaper (the
  // Color Pen turns it on). Needs the event time threaded through stroke(), so
  // it stays inert for callers that don't pass one (tests, settings preview).
  protected speedTaper = false;
  // How strongly speed thins the line (0..100): scales the taper depth, 0 = off,
  // 100 = the full curve. A per-user dial, shown only while speedTaper is on.
  protected speedTaperAmount = 100;
  private speedPrevX = 0;
  private speedPrevY = 0;
  private speedPrevTime: number | null = null;
  private smoothedSpeed = 0;
  // The toolbar Primary/Secondary, frozen once at the stroke's start by
  // captureStrokeContext (they can't change mid-stroke). strokeColor is tagged
  // onto every deposited point so a connecting brush set to "From mark" inherits
  // the painted hue; both feed the brushes that draw with a colour. Frozen (not
  // read per sample) so a stroke's pixels don't depend on live UI state.
  private strokeColor: string | undefined;
  private strokeSecondaryColor: string | undefined;

  // Position smoothing ("Streamline"), opt-in per brush via streamlines(). Off
  // by default so every existing brush — and the connecting web sampler — stays
  // byte-for-byte unchanged. The strength is a plain brush-own dial (0..100).
  private streamliner = new Streamliner();
  protected streamlineStrength = 50;

  // Brushes that want their path smoothed (e.g. the calligraphy Marker) override
  // this to true; they also spread streamlineSettings() into getSettings().
  protected streamlines(): boolean {
    return false;
  }

  // 0..100 → EMA step per sample: 0 = raw samples, 100 = heaviest smoothing.
  private penSmoothStep(): number {
    return Math.max(0.05, 1 - this.penSmoothing / 100);
  }

  // 0..100 → gamma 0.3..2, piecewise-linear with the default (0.7) at 50:
  // lower = a light touch counts more, higher = demands firmer pressure.
  private penGamma(): number {
    const v = this.penResponse;
    return v <= 50 ? 0.3 + (0.4 * v) / 50 : 0.7 + (1.3 * (v - 50)) / 50;
  }

  // The dash of the visible stroke for this brush; "solid" unless overridden.
  protected strokeDashValue(): DashStyle {
    return "solid";
  }

  constructor(
    protected host: PaintHost,
    seed: number = (Math.random() * 0x100000000) >>> 0,
    protected store?: Store,
  ) {
    this.seed = seed;
    this.rng = mulberry32(seed);
  }

  // Role views of the one host, for subclasses that only draw or only deposit.
  protected get renderer(): IRenderer {
    return this.host;
  }
  protected get finder(): NeighborFinder {
    return this.host;
  }

  abstract name(): string;

  // Whether selecting this brush puts the canvas into erase mode (destination-out).
  // The Eraser overrides this; main.ts reads it on brush switch to toggle erase.
  erases(): boolean {
    return false;
  }

  strokeStart(_x: number, _y: number): void {}

  // Live animation pump for the frame-driven brushes (Spray, Wisp): while a stroke
  // is held the input funnel calls this each frame with performance.now(), so the
  // plume/airbrush keeps building during a dwell (no pointer events fire when the
  // hand is still). Default no-op; animates() gates whether the funnel pumps at all.
  // The physics itself steps on a fixed virtual timestep (see fixed-timestep.ts),
  // fed by this clock live and by the recorded sample times in replay.
  animate(_now: number): void {}
  animates(): boolean {
    return false;
  }

  // Freeze the toolbar colours for this stroke, so its pixels depend only on the
  // colours at pointer-down - not on live UI state read mid-stroke (deterministic
  // replay, vector-replay P0.4). Called at stroke start by the input funnel (and
  // the preview + test harness), NOT from strokeStart(): brushes override
  // strokeStart without super, so a shared latch can't live there. The frozen pair
  // is pushed to the connection engine, which colours its web lines to match.
  captureStrokeContext(): void {
    this.strokeColor = this.store?.get<string>("app.color.main");
    this.strokeSecondaryColor = this.store?.get<string>("app.color.secondary");
    this.connection?.freezeColors(this.strokeColor, this.strokeSecondaryColor);
  }

  // The brush-owned slice of a recorded StrokeContext (vector-replay P1.2), read
  // AFTER captureStrokeContext so the frozen colours are current. The input funnel
  // fills in the parts IT owns (layer, size, alpha, symmetry, pen). settings is the
  // connection's dial flat ({} for a non-connecting brush - refined later).
  strokeSnapshot(): {
    brush: string;
    seed: number;
    color: { main: string; secondary: string };
    style?: string;
    settings: Record<string, string | number | boolean>;
    brushSettings: Record<string, SettingValue>;
    erase: boolean;
  } {
    return {
      brush: this.name(),
      seed: this.seed,
      color: {
        main: this.strokeColor ?? "#000000",
        secondary: this.strokeSecondaryColor ?? "#888888",
      },
      // The connection style NAME - `settings` (toFlat) carries only class-agnostic
      // dials, so replay needs this to re-instantiate the right connection CLASS
      // before applying them (P2.1). Undefined for non-connecting brushes.
      style: this.connection?.styleName(),
      settings: this.connection ? this.connection.toFlat() : {},
      // Brush-own dials (Wisp Colour, ...) - the connection's `settings` don't cover them.
      brushSettings: this.flatBrushSettings(),
      erase: this.erases(),
    };
  }

  // Snapshot/restore brush-own (non-connecting) dials for replay - without them a
  // gradient Wisp/Spray falls back to its defaults (solid Primary).
  flatBrushSettings(): Record<string, SettingValue> {
    const out: Record<string, SettingValue> = {};
    for (const s of this.getSettings()) {
      if (!isConnectingSetting(s)) out[s.key] = s.value;
    }
    return out;
  }

  applyBrushSettings(flat: Record<string, SettingValue>): void {
    for (const s of this.getSettings()) {
      if (isConnectingSetting(s)) continue;
      const v = flat[s.key];
      if (v !== undefined) applySettingValue(s, v);
    }
  }

  // The Primary in effect for this stroke: the value frozen by captureStrokeContext
  // if it ran, else the live toolbar colour - so a path that never freezes (some
  // tests, the preview before this hook) keeps the old read-the-store behaviour. No
  // default: depositPixel skips tagging when there's no colour (bare host).
  private currentPrimary(): string | undefined {
    return this.strokeColor ?? this.store?.get<string>("app.color.main");
  }
  // Primary/Secondary for brushes that DRAW with a colour, with the historic
  // defaults for a bare host. Frozen-then-live, same as currentPrimary.
  protected frozenPrimary(): string {
    return this.currentPrimary() ?? "#000000";
  }
  protected frozenSecondary(): string {
    return (this.strokeSecondaryColor ?? this.store?.get<string>("app.color.secondary")) ?? "#888888";
  }

  // Template: deposit the point, run the child's stroke logic, then let the
  // connection (if any) weave its web.
  // sample=false marks a sub-frame (coalesced) point: draw the visible mark but
  // don't grow the point cloud or weave the web. The pointer loop passes false
  // for every coalesced sub-sample except the last of a connecting brush, so the
  // web samples once per frame (Harmony's per-move model) instead of at the
  // hardware's report rate — feeding every sub-sample made the web build up
  // ~quadratically with the pointer's rate. The line still draws every sample.
  stroke(
    x: number,
    y: number,
    sample = true,
    pen: PenSample = MOUSE_SAMPLE,
    time?: number,
  ): void {
    // Smooth and latch this sample's pen state first: onStroke and connect()
    // below both read it (via penStyle()/the connection factors).
    this.pen = this.penSmoother.smooth(pen, this.penSmoothStep());
    // Streamline the path (opt-in): replace the raw point so draw, deposit and
    // the web all use the same smoothed coordinate. Runs on every sample
    // (including coalesced sub-frames) so the trajectory uses all the data.
    if (this.streamlines()) {
      ({ x, y } = this.streamliner.push(x, y, this.streamlineStrength));
    }
    // Track the drawn path's speed for the width taper (after streamlining, so
    // it matches the segment actually drawn).
    this.updateSpeed(x, y, time);
    this.connection?.setPenFactors(
      this.penWebDensity && this.pen.isPen
        ? penFactor(this.pen.pressure, DIAL_FLOOR, this.penGamma())
        : 1,
      this.penWebRadius && this.pen.isPen
        ? penFactor(this.pen.pressure, DIAL_FLOOR, this.penGamma())
        : 1,
    );
    // While erasing, paint (erase) the mark. The Eraser brush may also weave a
    // connection so the web gets erased too — run connect() with an ephemeral
    // point so erasing never grows the point cloud. connect() is a no-op when
    // the routing mode is "none" (the eraser's default), so a plain eraser just
    // wipes its own line.
    if (this.host.isErasing()) {
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
    // Bloom (density-targeted point multiplier): tops the local neighbourhood up
    // to the bloom target so the user's own stroke blooms into a full web. No-op
    // when the bloom dial is 0, so normal brushes/styles are unaffected.
    this.connection?.bloomTopUp(current);
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

  // --- pen factors for the current sample (read inside onStroke) -------------

  // EMA the raw inter-sample speed (canvas px / ms). `time` is the pointer
  // event's timestamp; without it (tests / preview) the speed never updates, so
  // the taper stays inert. The 1 ms floor guards a zero dt from coalesced
  // sub-samples sharing a timestamp.
  private updateSpeed(x: number, y: number, time?: number): void {
    if (time === undefined) return;
    if (this.speedPrevTime !== null) {
      const dt = Math.max(1, time - this.speedPrevTime);
      const raw = Math.hypot(x - this.speedPrevX, y - this.speedPrevY) / dt;
      this.smoothedSpeed += SPEED_TAPER_STEP * (raw - this.smoothedSpeed);
    }
    this.speedPrevX = x;
    this.speedPrevY = y;
    this.speedPrevTime = time;
  }

  // Width multiplier from stroke speed, for non-pen strokes when the brush opts
  // in. 1 (no effect) for a pen or when off.
  protected speedWidthFactor(): number {
    if (this.pen.isPen || !this.speedTaper) return 1;
    // Scale the taper depth by the user's amount (0 = off, 100 = full curve).
    const depth = this.speedTaperAmount / 100;
    return 1 - depth * (1 - speedTaperFactor(this.smoothedSpeed));
  }

  // Size multiplier (1 with a mouse or with the bindings off). Pressure and
  // tilt multiply when both are bound.
  protected penWidthFactor(): number {
    if (!this.pen.isPen) return 1;
    const gamma = this.penGamma();
    let f = 1;
    if (this.penPressureSize) f *= penFactor(this.pen.pressure, SIZE_FLOOR, gamma);
    if (this.penTiltSize) f *= penFactor(this.pen.tilt, SIZE_FLOOR, gamma);
    return f;
  }

  protected penAlphaFactor(): number {
    if (!this.pen.isPen) return 1;
    const gamma = this.penGamma();
    let f = 1;
    if (this.penPressureAlpha) f *= penFactor(this.pen.pressure, ALPHA_FLOOR, gamma);
    if (this.penTiltAlpha) f *= penFactor(this.pen.tilt, ALPHA_FLOOR, gamma);
    return f;
  }

  // Per-call LineStyle overrides for the current sample. Empty when nothing
  // modulates, so the persistent renderer state applies and a mouse stroke is
  // pixel-identical to the pre-pen behaviour.
  protected penStyle(): { width?: number; alpha?: number } {
    const style: { width?: number; alpha?: number } = {};
    // Pen pressure/tilt (mouse: 1) and the non-pen speed taper (pen: 1) compose:
    // exactly one is ever in play, so a stylus keeps pressure and a mouse gets grace.
    const wf = this.penWidthFactor() * this.speedWidthFactor();
    if (wf !== 1) style.width = Math.max(0.5, this.host.strokeWidth() * wf);
    const af = this.penAlphaFactor();
    if (af !== 1) style.alpha = this.host.strokeAlpha() * af;
    return style;
  }

  // The pen's lean direction (radians), or null when there's no usable tilt
  // (mouse, vertical pen, tilt-less stylus) — callers keep their fixed angle.
  protected penAzimuth(): number | null {
    return this.pen.isPen && this.pen.hasTilt ? this.pen.azimuth : null;
  }

  // The "Pen" section toggles. Brushes spread this into their getSettings();
  // `stroke: false` omits the size/opacity bindings for brushes whose mark is
  // only the connecting web (Soft Pencil). The web bindings appear only for
  // connecting brushes.
  protected penSettings(opts: { stroke?: boolean } = {}): BrushSetting[] {
    const PEN = PEN_SECTION;
    const items: BrushSetting[] = [];
    if (opts.stroke !== false) {
      items.push(
        {
          kind: "boolean",
          key: "penPressureSize",
          label: "Pressure → size",
          section: PEN,
          value: this.penPressureSize,
          onChange: (v) => (this.penPressureSize = v),
        },
        {
          kind: "boolean",
          key: "penPressureAlpha",
          label: "Pressure → opacity",
          section: PEN,
          value: this.penPressureAlpha,
          onChange: (v) => (this.penPressureAlpha = v),
        },
        {
          kind: "boolean",
          key: "penTiltSize",
          label: "Tilt → size",
          section: PEN,
          value: this.penTiltSize,
          onChange: (v) => (this.penTiltSize = v),
        },
        {
          kind: "boolean",
          key: "penTiltAlpha",
          label: "Tilt → opacity",
          section: PEN,
          value: this.penTiltAlpha,
          onChange: (v) => (this.penTiltAlpha = v),
        },
      );
    }
    if (this.connection) {
      items.push(
        {
          kind: "boolean",
          key: "penWebDensity",
          label: "Pressure → web density",
          section: PEN,
          value: this.penWebDensity,
          onChange: (v) => (this.penWebDensity = v),
        },
        {
          kind: "boolean",
          key: "penWebRadius",
          label: "Pressure → web radius",
          section: PEN,
          value: this.penWebRadius,
          onChange: (v) => (this.penWebRadius = v),
        },
      );
    }
    // Feel knobs — they shape every binding above, so they're always present.
    items.push(
      {
        kind: "number",
        key: "penSmoothing",
        label: "Smoothing",
        section: PEN,
        min: 0,
        max: 100,
        step: 1,
        value: this.penSmoothing,
        onChange: (v) => (this.penSmoothing = v),
      },
      {
        kind: "number",
        key: "penResponse",
        label: "Response",
        section: PEN,
        min: 0,
        max: 100,
        step: 1,
        value: this.penResponse,
        onChange: (v) => (this.penResponse = v),
      },
    );
    return items;
  }

  // The "Streamline" dial — a brush-own setting (Brush tab). Opt-in brushes
  // spread this into their getSettings(); see streamlines().
  protected streamlineSettings(): BrushSetting[] {
    return [
      {
        kind: "number",
        key: "streamline",
        label: "Streamline",
        min: 0,
        // Capped at 75 - beyond that the path lags too far behind the cursor.
        max: 75,
        step: 1,
        value: this.streamlineStrength,
        onChange: (v) => (this.streamlineStrength = v),
      },
    ];
  }

  // Whether this brush draws a connecting web (and so shows the navbar
  // Connecting combo + Connecting settings box).
  supportsConnecting(): boolean {
    return this.connection !== null;
  }

  // Whether this brush draws a single continuous line that should be buffered
  // into one uniform-opacity stroke (see LayerManager.beginStroke) — so a faint
  // line doesn't show darker dots where each segment's round caps overlap.
  // Round does; shape/texture brushes (which stamp discrete marks) don't.
  // The pointer's pen sample is passed in because the buffer flattens a stroke
  // to ONE alpha — a pen with an opacity binding must draw unbuffered (the
  // per-sample variation is the point).
  bufferedStroke(_pen?: PenSample): boolean {
    return false;
  }

  // The active connection (null for non-connecting brushes). The settings panel
  // reads it to learn which connecting dials open by default.
  activeConnection(): ConnectionBase | null {
    return this.connection;
  }

  // The "Web weight" presets (Light / Normal / Heavy) for the active style,
  // limited to the preset levers (Weight/Density/Links). Normal == the style's
  // FACTORY defaults; Light/Heavy come from the style spec (per-style), or are
  // derived when a style declares none (e.g. a custom preset). Empty for
  // non-connecting brushes. The settings panel renders these as the pills.
  webWeightLevels(): { name: string; flat: ConnectingFlat }[] {
    if (!this.connection) return [];
    const LEVERS = ["strands", "density", "links"] as const;
    const pick = (flat: ConnectingFlat): ConnectingFlat => {
      const out: ConnectingFlat = {};
      for (const k of LEVERS) out[k] = flat[k] ?? (k === "strands" ? 1 : 0);
      return out;
    };
    const factory = this.connectionFactoryFlat;
    const normal = pick(factory);
    const nStrands = typeof normal.strands === "number" ? normal.strands : 1;
    const nDensity = typeof normal.density === "number" ? normal.density : 10;
    const ww = this.connection.webWeightSpec();
    const light = ww.light ?? {
      strands: Math.max(1, Math.round(nStrands * 0.6)),
      density: Math.round(nDensity * 0.45),
      links: 20,
    };
    const heavy = ww.heavy ?? {
      strands: Math.min(12, Math.max(2, Math.round(nStrands * 1.5))),
      density: Math.min(100, Math.round(nDensity * 1.4)),
      links: 0,
    };
    return [
      { name: "Light", flat: pick({ ...factory, ...light }) },
      { name: "Normal", flat: normal },
      { name: "Heavy", flat: pick({ ...factory, ...heavy }) },
    ];
  }

  strokeEnd(): void {
    // Draw the streamline catch-up tail (no deposit — purely visual) so the
    // stroke reaches the pen-up location before we tear the stroke down.
    if (this.streamlines()) {
      for (const p of this.streamliner.drain(this.streamlineStrength))
        this.onStroke(p.x, p.y, { id: -1, x: p.x, y: p.y });
    }
    this.streamliner.reset();
    this.hasConnectSample = false;
    this.penSmoother.reset();
    this.speedPrevTime = null; // re-arm the speed taper for the next stroke
    this.smoothedSpeed = 0;
    this.connection?.resetStroke();
    void this.pixelLog?.flush();
  }

  // The "Speed taper" toggle + its "Taper amount" dial. Brushes that want the
  // taper (the Color Pen) spread this into getSettings().
  protected speedTaperSettings(): BrushSetting[] {
    return [
      {
        kind: "boolean",
        key: "speedTaper",
        label: "Speed taper",
        value: this.speedTaper,
        onChange: (v) => (this.speedTaper = v),
      },
      {
        kind: "number",
        key: "speedTaperAmount",
        label: "Taper amount",
        min: 0,
        max: 100,
        step: 1,
        value: this.speedTaperAmount,
        onChange: (v) => (this.speedTaperAmount = v),
        // Only meaningful while the taper is on.
        visibleWhen: { key: "speedTaper", when: (v) => v === true },
      },
    ];
  }

  // Store the pixel into the configured trail map and append its provenance row.
  // The trail-map routing is the connection's job (selected / a pinned map / no
  // trail); a non-connecting brush just deposits into the selected map.
  protected depositPixel(x: number, y: number): Pixel {
    let px: Pixel;
    let mapId: string | undefined;
    let log = true;
    if (this.connection) {
      ({ px, mapId, log } = this.connection.deposit(x, y));
    } else {
      px = this.host.addPixel(x, y);
      mapId = this.host.selectedMapId();
    }
    // Tag every deposited point with the colour being painted (the per-stroke
    // Primary latch), so a connecting brush set to "From mark" inherits the
    // colour actually laid here - in a single pass, with any brush, not just
    // after a Color Pen run. The Color Pen's onStroke overrides this per segment.
    const primary = this.currentPrimary();
    if (primary) px.color = primary;
    if (log) this.logPixel(x, y, mapId);
    return px;
  }

  // mapId is "" on a bare host (no maps), which keeps the log silent there.
  private logPixel(x: number, y: number, mapId: string | undefined): void {
    if (this.pixelLog && mapId) {
      this.pixelLog.append({
        brush_type: this.name() as BrushType,
        dash: this.strokeDashValue(),
        width: this.host.strokeWidth(),
        x,
        y,
        layer_id: this.host.activeLayerId(),
        pixel_map_id: mapId,
      });
    }
  }

  clear(): void {
    this.host.clear(); // the active canvas (see PaintHost on the clear() collision)
    this.host.clearPixels(); // every neighbor cloud — not touched by canvas clear
  }

  // The brush's settings descriptors for the panel. Pure: each onChange only
  // mutates brush/connection state. Persistence is separate (the panel calls
  // persistSetting on change; restore reads at boot) — so this is just the UI
  // + live-binding view, rebuilt freely on every render.
  getSettings(): BrushSetting[] {
    return [
      ...(this.connection ? this.connection.sliders() : []),
      ...this.penSettings(),
    ];
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
    this.connectionFactoryFlat = this.connection.toFlat();
  }

  private connectionDeps(): ConnectionDeps {
    return {
      // Live accessor so a brush could swap its host mid-stroke (none does
      // today; kept for parity with the original renderer accessor).
      host: () => this.host,
      store: this.store,
      // Share the brush's seeded RNG so the connecting engine consumes it in the
      // same order as when this logic lived on the brush — output is identical.
      random: () => this.random(),
      // Let self-managed connection widgets persist the style on change.
      persistStyle: () => this.persistConnectionStyle(),
    };
  }

  // Swap the active connection style (web → fur …) to the preset's own
  // defaults, preserving routing choices. A no-op for brushes that don't
  // connect. Use selectArtStyle to also load this brush's saved dials for the
  // style; this bare form is the "reset to defaults" path (resetArtStyle).
  applyArtStylePreset(name: string): void {
    if (!this.connection) return;
    const next = createConnection(name, this.connectionDeps());
    next.copyRoutingFrom(this.connection);
    this.connection = next;
    this.connectionFactoryFlat = next.toFlat(); // factory baseline for Web weight
  }

  // Switch to an art style AND restore this brush's saved dials for it, so each
  // style remembers its own look across reloads and style switches. The path
  // used when selecting a brush or picking a style from the combo.
  selectArtStyle(name: string): void {
    this.applyArtStylePreset(name);
    this.restoreConnectionStyle(name);
  }

  // Reset an art style to its preset defaults and persist them — overwriting
  // any saved per-style dials (New art / Delete canvas), so the fresh default
  // look survives a reload.
  resetArtStyle(name: string): void {
    this.applyArtStylePreset(name);
    this.persistConnectionStyle();
  }

  // Apply only a routing preset (e.g. "no_connect" for the eraser's default,
  // "classic" for the standard selected-map routing on New art).
  applyRoutingPreset(name: string): void {
    if (!this.connection) return;
    const routing = (ROUTING_PRESETS as Record<string, RoutingSettings>)[name];
    if (routing) this.connection.applyFlat(flattenRouting(routing));
  }

  setSeed(seed: number): void {
    this.seed = seed;
    this.rng = mulberry32(seed);
  }

  // Frame-driven brushes (Wisp/Spray) override to run a dwell's full catch-up on
  // replay (the live per-call cap drops it and under-builds a held plume).
  setReplayTiming(_on: boolean): void {}

  protected random(): number {
    return this.rng();
  }

  // --- persistence -----------------------------------------------------------
  // Two domains, keyed under "brush.<name>":
  //   - art-style dials  -> ".style.<styleName>" holds the whole flat, so each
  //     style keeps its own look (density for Shaded ≠ density for Web).
  //   - everything else  -> ".<key>" holds the plain value (brush params,
  //     routing). Unchanged layout, so existing saved settings keep loading.
  // The panel calls persistSetting after a change; restore runs once at boot.

  private brushKey(suffix: string): string {
    return `brush.${this.name()}.${suffix}`;
  }

  // Brush-own setting defaults, snapshotted before restore overwrites them, so
  // the Reset button can revert to them.
  private ownDefaults: Record<string, SettingValue> | null = null;

  // Restore the brush's own params + routing from storage. Art-style dials are
  // NOT restored here — the active style isn't decided yet at boot; they load
  // when the style is selected (selectArtStyle → restoreConnectionStyle).
  restore(): void {
    this.captureOwnDefaults(); // fields are at their initial defaults right now
    if (!this.store) return;
    for (const s of this.getSettings()) {
      if (isStyleDial(s)) continue;
      const saved = this.store.get<unknown>(this.brushKey(s.key));
      if (saved !== undefined) applySettingValue(s, saved);
    }
  }

  private captureOwnDefaults(): void {
    if (this.ownDefaults) return;
    const d: Record<string, SettingValue> = {};
    for (const s of this.getSettings()) {
      if (!isConnectingSetting(s)) d[s.key] = s.value; // brush-own only
    }
    this.ownDefaults = d;
  }

  // Revert this brush to defaults: its own params to their initial values, and
  // the connecting dials to the active art style's preset defaults (routing is
  // preserved). Persisted, so the reset survives a reload. Wired to the
  // settings window's Reset button.
  resetSettings(): void {
    if (this.ownDefaults) {
      for (const s of this.getSettings()) {
        if (isConnectingSetting(s)) continue;
        const d = this.ownDefaults[s.key];
        if (d !== undefined) {
          applySettingValue(s, d);
          this.persistSetting(s, d);
        }
      }
    }
    if (this.connection) this.resetArtStyle(this.connection.styleName());
  }

  // Persist one setting the panel just changed. An art-style dial saves the
  // whole style flat (one write, correctly partitioned by style); anything
  // else saves its single value. `value` is a SettingValue (never undefined) so
  // a setting can't be laundered through `unknown` into store.set as undefined.
  persistSetting(s: BrushSetting, value: SettingValue): void {
    if (!this.store) return;
    if (isStyleDial(s)) this.persistConnectionStyle();
    else this.store.set(this.brushKey(s.key), value);
  }

  private persistConnectionStyle(): void {
    if (!this.store || !this.connection) return;
    this.store.set(
      this.brushKey(`style.${this.connection.styleName()}`),
      this.connection.toFlat(),
    );
  }

  private restoreConnectionStyle(name: string): void {
    if (!this.store || !this.connection) return;
    const flat = this.store.get<ConnectingFlat>(this.brushKey(`style.${name}`));
    if (flat) this.connection.applyFlat(flat);
  }
}

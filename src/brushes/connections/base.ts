import type { LineStyle, LineConnectType } from "../../renderer";
import { LineConnectTypes } from "../../renderer";
import type { Pixel } from "../../neighbor-finder";
import type { PaintHost } from "../../paint-host";
import type { Store } from "../../store/base";
import {
  DASH_STYLES,
  DASH_PATTERNS,
  DASH_ICONS,
  ConnectModeSchema,
  encodeConnectMap,
  decodeConnectMap,
  // Slider section labels (shared source of truth): the routing group + the
  // art-style group.
  ROUTING_SECTION as ROUTE_SECTION,
  STYLE_SECTION,
  type DashStyle,
  type ConnectMap,
  type ConnectMode,
  type ConnectingFlat,
} from "../../connecting-types";
import type { BrushSetting } from "../../base";
import { COLOR_SOURCE_LABELS, colorSourceIcons, mixHex, hueHex } from "../color-source";

type ColorSource = "main" | "secondary" | "gradient" | "rainbow";

// Cap how many hairs a single connection fans into (perf guard).
const MAX_CONNECT_STRANDS = 12;
// Sample spacing (px) at/above which `dynamics` treats the stroke as "fast".
const DYNAMICS_SPEED_REF = 28;

// Everything a connection needs from its owning brush. `host` is a live
// accessor (not a snapshot) so a brush could swap its drawing surface
// mid-stroke (none does today; kept for parity with the original renderer
// accessor). `random` is the brush's own seeded RNG, shared so the connecting
// engine consumes it in the exact same order as before this logic lived on
// the brush — output stays byte-identical.
export type ConnectionDeps = {
  host: () => PaintHost;
  store?: Store;
  random: () => number;
};

// A connection's connections.json entry. A data-only style (Classic, Web, Arc,
// Shaded, Lace) declares its menu glyph + starting slider values here and runs
// on the generic class. A code connection (Fur) keeps its icon + defaults() in
// its own .ts, so those fields are optional here.
export type ConnectionSpec = {
  name: string; // stable id (storage key / createConnection) — not the display name
  label?: string; // display name in the navbar combo (defaults to capitalized name)
  info?: string;
  // Menu glyph (inline SVG). Trusted on BUILT-IN specs only (bundled JSON /
  // module code) — it feeds an innerHTML sink. Custom presets never carry one:
  // their glyph is derived from `base`, and normalizeCustomSpecs strips this
  // field from anything imported or persisted.
  icon?: string;
  // For custom presets: the built-in style this preset was saved from (a name,
  // e.g. "shaded"). The only icon source for customs. Always one hop —
  // re-saving a custom preset propagates its base instead of chaining.
  base?: string;
  // Opacity for the owning brush's continuous stroke line when this style is
  // active, matching the corresponding Harmony brush (sketchy 0.05, web 0.5,
  // shaded 0 = no line). Omitted → the brush keeps its own default. Applied by
  // main.ts on select/load via the brush's getSelectOpacity().
  strokeAlpha?: number;
  defaults?: ConnectingFlat;
  file: string;
};

// A brush connection style (web, fur, lace…). Holds all connecting state and the
// engine that weaves the web. Its starting values + icon come from the JSON spec;
// subclasses only add code (extra sliders, texture hooks like Fur's drawHair).
//
// Was BrushBase's connecting half (connectingNeighbors / drawFanned / drawHair +
// the connect* fields). Moved here verbatim so brushes only own their stroke.
export class ConnectionBase {
  // --- connecting state (one-to-one with the old BrushBase fields) -----------
  protected connectDensity = 10; // %
  protected searchRadius = 40;
  protected minConnectDist = 0;
  protected connectSampleSpacing = 0; // px between web samples; 0 = off (see sampleSpacing)
  protected connectionStyle: LineStyle = { alpha: 0.2, width: 1 };
  protected connectType: LineConnectType = "quadraticCurve";
  protected connectionDash: DashStyle = "solid";
  protected connectionColorSource: ColorSource = "main";
  protected connectInset = 0;
  protected connectAlphaFade = 0;
  protected connectStrands = 1;
  protected connectSpread = 6;
  protected connectScatter = 0;
  protected connectTaper = 0;
  protected connectFlow = 0;
  protected connectFray = 0;
  protected connectLength = 1;
  protected connectWave = 0;
  protected connectDynamics = 0;
  protected connectCurl = 0.3;
  protected connectGrainAngle = 0;
  protected connectGrainStrength = 0;
  protected connectGrainCross = false;

  protected connectFromMap: ConnectMap = { kind: "selected" };
  protected connectToMap: ConnectMap = { kind: "selected" };
  protected connectMode: ConnectMode = "both";

  // Per-sample stroke speed (px between consecutive samples) for `dynamics`.
  private prevSampleX = 0;
  private prevSampleY = 0;
  private sampleSpeed = 0;
  // Pen-pressure factors for the dial bindings (1 = neutral). Pushed per
  // sample by the owning brush (BrushBase.stroke) before connect().
  private penDensityFactor = 1;
  private penRadiusFactor = 1;
  // Size of the read (from) map at stroke start; the cutoff for stroke/map mode.
  private strokeCutoffId: number | null = null;

  constructor(
    protected deps: ConnectionDeps,
    protected spec: ConnectionSpec,
  ) {
    // Apply the starting slider values over the field defaults; routing keeps
    // the shared defaults.
    this.applyFlat(this.defaults());
  }

  // Starting slider values. The generic connection reads them from its JSON
  // spec; a code connection (e.g. Fur) overrides this to supply its own.
  protected defaults(): ConnectingFlat {
    return this.spec.defaults ?? {};
  }

  // The live drawing surface: the LayerManager (via the symmetry proxy) in the
  // app, a bare host (createBareHost) in tests/headless render.
  protected get host(): PaintHost {
    return this.deps.host();
  }

  protected random(): number {
    return this.deps.random();
  }

  // The owning brush's stroke-line opacity for this style (Harmony-matched), or
  // undefined to leave the brush's default. See ConnectionSpec.strokeAlpha.
  strokeOpacity(): number | undefined {
    return this.spec.strokeAlpha;
  }

  // The art style's stable name (e.g. "shaded", or a custom preset's name) —
  // the persistence key under which this brush remembers this style's dials.
  styleName(): string {
    return this.spec.name;
  }

  // Optional min travel (px) between web samples. 0 (default) = weave through
  // every sampled point for the smoothest web. Rate-independence is handled
  // upstream now (the pointer loop samples the web once per frame, like Harmony),
  // so this is purely artistic: raise it to stipple the web into evenly spaced
  // tufts/dots. Read live by BrushBase.stroke.
  sampleSpacing(): number {
    return this.connectSampleSpacing;
  }

  // --- stroke lifecycle (called by BrushBase.stroke) -------------------------

  // Capture the read-map cutoff before this stroke's first point is deposited
  // (when from === to, depositing would otherwise shift the boundary), and track
  // per-sample speed for `dynamics`. Mirrors the old BrushBase.stroke() preamble.
  beforeDeposit(x: number, y: number): void {
    const firstSample = this.strokeCutoffId === null;
    if (firstSample) this.strokeCutoffId = this.fromMapSize();
    this.sampleSpeed = firstSample
      ? 0
      : Math.hypot(x - this.prevSampleX, y - this.prevSampleY);
    this.prevSampleX = x;
    this.prevSampleY = y;
  }

  // Deposit the stroke point into the configured trail map (selected, a pinned
  // one, or nowhere for "No trail"). Returns the Pixel plus where it landed so
  // the brush can append its pixel-log row (brush-level concern).
  deposit(
    x: number,
    y: number,
  ): { px: Pixel; mapId: string | undefined; log: boolean } {
    if (this.connectToMap.kind === "none")
      return { px: { id: -1, x, y }, mapId: undefined, log: false };
    const h = this.host;
    if (this.connectToMap.kind === "map")
      return {
        px: h.addPixelToMap(this.connectToMap.mapId, x, y),
        mapId: this.connectToMap.mapId,
        log: true,
      };
    return { px: h.addPixel(x, y), mapId: h.selectedMapId(), log: true };
  }

  connect(current: Pixel): void {
    if (this.connectMode === "none") return;
    this.connectingNeighbors(current);
  }

  setPenFactors(density: number, radius: number): void {
    this.penDensityFactor = density;
    this.penRadiusFactor = radius;
  }

  resetStroke(): void {
    this.strokeCutoffId = null;
  }

  // --- the connecting engine (moved verbatim from BrushBase) -----------------

  protected connectingNeighbors(current: Pixel): void {
    // Pen-bound dials: pressure scales the search radius and the per-neighbor
    // density odds (both 1× without a binding/pen). The fade normalizes to the
    // effective radius so the falloff shape is preserved at light pressure.
    const radius = this.searchRadius * this.penRadiusFactor;
    const density = this.connectDensity * this.penDensityFactor;
    const neighbors = this.searchNeighbors(current, radius);
    const minSq = this.minConnectDist * this.minConnectDist;
    const radiusSq = radius * radius;
    const fade = this.connectAlphaFade;
    const baseAlpha = this.connectionStyle.alpha ?? 1;
    const cutoff = this.strokeCutoffId ?? current.id;
    const inset = this.connectInset;
    const dyn = this.connectDynamics;
    const slow =
      dyn > 0 ? Math.max(0, 1 - this.sampleSpeed / DYNAMICS_SPEED_REF) : 0;
    const strands = Math.max(
      1,
      Math.min(MAX_CONNECT_STRANDS, Math.round(this.connectStrands * (1 + dyn * slow * 0.3))),
    );
    const dynAlphaMul = 1 - dyn * slow * 0.65; // slow → fainter per line (~0.35×)
    const grainStrength = this.connectGrainStrength;
    const grainRad = (this.connectGrainAngle * Math.PI) / 180;
    const grainCross = this.connectGrainCross;
    for (const n of neighbors) {
      if (this.connectMode === "map" && n.id >= cutoff) continue;
      if (this.connectMode === "stroke" && n.id < cutoff) continue;
      if (this.random() * 100 >= density) continue;
      const dx = n.x - current.x;
      const dy = n.y - current.y;
      const dsq = dx * dx + dy * dy;
      if (minSq > 0 && dsq < minSq) continue;
      if (grainStrength > 0) {
        const c = Math.cos(2 * (Math.atan2(dy, dx) - grainRad));
        const aligned = grainCross ? Math.abs(c) : (c + 1) / 2;
        if (this.random() >= 1 - grainStrength * (1 - aligned)) continue;
      }
      const alpha =
        (fade > 0 && radiusSq > 0
          ? baseAlpha * Math.max(0, 1 - fade * (dsq / radiusSq))
          : baseAlpha) * dynAlphaMul;
      let a: Pixel = current;
      let b: Pixel = n;
      if (inset > 0) {
        a = { id: current.id, x: current.x + dx * inset, y: current.y + dy * inset };
        b = { id: n.id, x: n.x - dx * inset, y: n.y - dy * inset };
      }
      const lineStyle: LineStyle = {
        ...this.connectionStyle,
        alpha,
        color: this.lineColor(dx, dy),
        dash: DASH_PATTERNS[this.connectionDash],
        curve: this.connectCurl,
      };
      if (strands <= 1) this.drawConnection(a, b, { ...lineStyle, width: 1 });
      else this.drawFanned(a, b, strands, lineStyle);
    }
  }

  // Draw one connection as `strands` thin 1px hairs spread across `connectSpread`
  // px perpendicular to the line — many faint lines instead of one fat one. The
  // per-hair shaping is delegated to drawHair (overridden by texture presets).
  protected drawFanned(a: Pixel, b: Pixel, strands: number, style: LineStyle): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len; // unit perpendicular to the line
    const py = dx / len;
    const spread = this.connectSpread;
    const scatter = this.connectScatter;
    const taper = this.connectTaper;
    const flow = this.connectFlow;
    const fray = this.connectFray;
    const grow = this.connectLength;
    const wave = this.connectWave;
    const hair: LineStyle = { ...style, width: 1 };
    for (let i = 0; i < strands; i++) {
      const center = ((i + 0.5) / strands - 0.5) * spread;
      const jA = scatter * spread * 0.5 * (this.random() * 2 - 1);
      const jB = scatter * spread * 0.5 * (this.random() * 2 - 1);
      const oA = center + jA;
      const oB = center + jB;
      const t = (fray > 0 ? 1 - fray * this.random() : 1) * grow;
      const phase = wave > 0 ? this.random() * Math.PI * 2 : 0;
      const rx = a.x + px * oA;
      const ry = a.y + py * oA;
      const tx = a.x + dx * t + px * oB;
      const ty = a.y + dy * t + py * oB;
      this.drawHair(rx, ry, tx, ty, px, py, hair, taper, flow, wave, phase);
    }
  }

  // One hair from (rx,ry) to (tx,ty). The base draws a straight 1px line — the
  // only path the non-texture presets exercise (they keep strands = 1, so
  // drawFanned never runs). FurConnection overrides this with the curved, tapering,
  // wave/flow version that gives the pelt its life.
  protected drawHair(
    rx: number,
    ry: number,
    tx: number,
    ty: number,
    _px: number,
    _py: number,
    style: LineStyle,
    _taper: number,
    _flow: number,
    _wave: number,
    _phase: number,
  ): void {
    this.drawConnection({ id: 0, x: rx, y: ry }, { id: 0, x: tx, y: ty }, style);
  }

  protected searchNeighbors(px: Pixel, radius: number): Pixel[] {
    if (this.connectFromMap.kind === "none") return [];
    const h = this.host;
    if (this.connectFromMap.kind === "map")
      return h.findNeighborsInMap(this.connectFromMap.mapId, px, radius);
    return h.findNeighbors(px, radius);
  }

  protected fromMapSize(): number {
    if (this.connectFromMap.kind === "none") return 0;
    const h = this.host;
    if (this.connectFromMap.kind === "map")
      return h.mapSize(this.connectFromMap.mapId);
    return h.pixelCount();
  }

  protected drawConnection(p1: Pixel, p2: Pixel, style: LineStyle): void {
    const h = this.host;
    h.drawConnectionToLayer(h.activeConnectionLayerId(), p1, p2, style, this.connectType);
  }

  private primaryColor(): string {
    return this.deps.store?.get<string>("app.color.main") ?? "#000000";
  }
  private secondaryColor(): string {
    return this.deps.store?.get<string>("app.color.secondary") ?? "#888888";
  }

  // The colour for one web line. main -> undefined (the renderer uses the
  // Primary strokeStyle); secondary -> the secondary hex; gradient/rainbow ->
  // computed per line from its angle (0..1 around the circle).
  private lineColor(dx: number, dy: number): string | undefined {
    const src = this.connectionColorSource;
    if (src === "main") return undefined;
    if (src === "secondary") return this.secondaryColor();
    const t = Math.atan2(dy, dx) / (2 * Math.PI) + 0.5; // 0..1 around the circle
    return src === "rainbow"
      ? hueHex(t * 360)
      : mixHex(this.primaryColor(), this.secondaryColor(), t);
  }

  // --- presets / flat application --------------------------------------------

  // Serialize the current art-style dial values (the look — not the memory-map
  // routing). Mirrors a spec's `defaults`, so it round-trips through applyFlat
  // and can be stored as a custom preset.
  toFlat(): ConnectingFlat {
    return {
      alpha: this.connectionStyle.alpha ?? 0.2,
      color: this.connectionColorSource,
      connect: this.connectType,
      dash: this.connectionDash,
      density: this.connectDensity,
      radius: this.searchRadius,
      minDist: this.minConnectDist,
      inset: this.connectInset,
      fade: this.connectAlphaFade,
      strands: this.connectStrands,
      spread: this.connectSpread,
      scatter: this.connectScatter,
      taper: this.connectTaper,
      flow: this.connectFlow,
      fray: this.connectFray,
      length: this.connectLength,
      wave: this.connectWave,
      dynamics: this.connectDynamics,
      curl: this.connectCurl,
      grainStrength: this.connectGrainStrength,
      grainAngle: this.connectGrainAngle,
      grainCross: this.connectGrainCross,
      sampleSpacing: this.connectSampleSpacing,
    };
  }

  // Build a Custom-group spec from the current dials + the given stroke-line
  // opacity, reusing this style's class (file) and glyph. Stored in IndexedDB
  // and re-instantiated via createConnection().
  toCustomSpec(name: string, strokeAlpha: number): ConnectionSpec {
    // No icon copied: custom specs reference their built-in parent via `base`
    // and the menu derives the glyph from it (an icon string on a custom spec
    // would be untrusted markup once the preset round-trips through a file).
    // Saving from a built-in: that style is the base. Saving from a custom:
    // propagate ITS base (one hop, no chains) and keep its "based on" info,
    // which already names the original style.
    return {
      name,
      label: name,
      file: this.spec.file,
      base: this.spec.base ?? this.spec.name,
      strokeAlpha,
      info: this.spec.base
        ? this.spec.info
        : `Custom preset based on ${this.spec.label ?? this.spec.name}`,
      defaults: this.toFlat(),
    };
  }

  // Apply a flat key→value map (a preset, a routing preset, or a loaded artwork)
  // by routing every key through setKey. Order follows the map, so radius lands
  // before minDist (radius clamps minDist).
  applyFlat(flat: ConnectingFlat): void {
    for (const [key, value] of Object.entries(flat)) this.setKey(key, value);
  }

  // Copy just the routing fields from another preset, so switching art style
  // (which swaps the preset instance) preserves the user's routing choices.
  copyRoutingFrom(other: ConnectionBase): void {
    this.connectFromMap = other.connectFromMap;
    this.connectToMap = other.connectToMap;
    this.connectMode = other.connectMode;
  }

  // Single source of truth for "key → field" so sliders, presets and loads all
  // mutate state the same way.
  private setKey(key: string, v: string | number | boolean): void {
    switch (key) {
      case "alpha":
        if (typeof v === "number") this.connectionStyle = { ...this.connectionStyle, alpha: v };
        break;
      case "density": if (typeof v === "number") this.connectDensity = v; break;
      case "radius":
        if (typeof v === "number") {
          this.searchRadius = v;
          if (this.minConnectDist > v) this.minConnectDist = v;
        }
        break;
      case "minDist": if (typeof v === "number") this.minConnectDist = v; break;
      case "sampleSpacing": if (typeof v === "number") this.connectSampleSpacing = v; break;
      case "inset": if (typeof v === "number") this.connectInset = v; break;
      case "fade": if (typeof v === "number") this.connectAlphaFade = v; break;
      case "strands": if (typeof v === "number") this.connectStrands = v; break;
      case "spread": if (typeof v === "number") this.connectSpread = v; break;
      case "scatter": if (typeof v === "number") this.connectScatter = v; break;
      case "taper": if (typeof v === "number") this.connectTaper = v; break;
      case "flow": if (typeof v === "number") this.connectFlow = v; break;
      case "fray": if (typeof v === "number") this.connectFray = v; break;
      case "length": if (typeof v === "number") this.connectLength = v; break;
      case "wave": if (typeof v === "number") this.connectWave = v; break;
      case "dynamics": if (typeof v === "number") this.connectDynamics = v; break;
      case "curl": if (typeof v === "number") this.connectCurl = v; break;
      case "grainStrength": if (typeof v === "number") this.connectGrainStrength = v; break;
      case "grainAngle": if (typeof v === "number") this.connectGrainAngle = v; break;
      case "grainCross": if (typeof v === "boolean") this.connectGrainCross = v; break;
      case "connect": if (typeof v === "string") this.connectType = v as LineConnectType; break;
      case "dash": if (typeof v === "string") this.connectionDash = v as DashStyle; break;
      case "color":
        if (v === "secondary" || v === "gradient" || v === "rainbow")
          this.connectionColorSource = v;
        else this.connectionColorSource = "main";
        break;
      case "connecting_from_map":
        if (typeof v === "string") this.connectFromMap = decodeConnectMap(v);
        break;
      case "connecting_to_map":
        if (typeof v === "string") this.connectToMap = decodeConnectMap(v);
        break;
      case "connecting_mode":
        if (typeof v === "string") this.connectMode = v as ConnectMode;
        break;
    }
  }

  // --- settings (sliders) ----------------------------------------------------

  // Routing + the universal art-style dials + any preset-specific extras. A
  // subclass adds its supported sliders by overriding extraSliders().
  sliders(): BrushSetting[] {
    return [...this.routingSliders(), ...this.baseStyleSliders(), ...this.extraSliders()];
  }

  // Sliders only this preset supports (e.g. Fur's strands/taper/flow). Default
  // none — most presets are single-line and expose just the universal dials.
  protected extraSliders(): BrushSetting[] {
    return [];
  }

  // Style dials the settings panel shows by default (in the open area, never
  // folded under "More"), regardless of value. Every other supported dial
  // surfaces only when it's "in use" (its value differs from its neutral).
  // Subclasses may override to open more of their own.
  defaultOpenKeys(): readonly string[] {
    return ["strands", "spread", "alpha", "density", "radius", "dash", "color"];
  }

  private num(
    key: string,
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
  ): BrushSetting {
    return {
      kind: "number",
      key,
      label,
      section: STYLE_SECTION,
      min,
      max,
      step,
      value,
      onChange: (val) => this.setKey(key, val),
    };
  }

  // Helpers exposed to subclasses so their extraSliders() read consistent specs.
  protected numStyle(
    key: string,
    label: string,
    min: number,
    max: number,
    step: number,
  ): BrushSetting {
    return this.num(key, label, min, max, step, this.styleValue(key));
  }

  // Current value for a style key (mirrors the old inline `value:` fields).
  private styleValue(key: string): number {
    switch (key) {
      case "alpha": return this.connectionStyle.alpha ?? 0.2;
      case "density": return this.connectDensity;
      case "radius": return this.searchRadius;
      case "minDist": return this.minConnectDist;
      case "sampleSpacing": return this.connectSampleSpacing;
      case "inset": return this.connectInset;
      case "fade": return this.connectAlphaFade;
      case "strands": return this.connectStrands;
      case "spread": return this.connectSpread;
      case "scatter": return this.connectScatter;
      case "taper": return this.connectTaper;
      case "flow": return this.connectFlow;
      case "fray": return this.connectFray;
      case "length": return this.connectLength;
      case "wave": return this.connectWave;
      case "dynamics": return this.connectDynamics;
      case "curl": return this.connectCurl;
      case "grainStrength": return this.connectGrainStrength;
      case "grainAngle": return this.connectGrainAngle;
      default: return 0;
    }
  }

  private routingSliders(): BrushSetting[] {
    const maps = this.host.listMaps(); // [] on a bare host
    const fromOptions = ["selected", ...maps.map((m) => m.id)];
    const trailOptions = [...fromOptions, "none"];
    const mapLabels: Record<string, string> = { selected: "Active map", none: "No trail" };
    for (const m of maps) mapLabels[m.id] = m.name;
    return [
      {
        kind: "select",
        key: "connecting_from_map",
        label: "Memory Map From",
        section: ROUTE_SECTION,
        options: fromOptions,
        optionLabels: mapLabels,
        value: encodeConnectMap(this.connectFromMap),
        onChange: (v) => this.setKey("connecting_from_map", v),
      },
      {
        kind: "select",
        key: "connecting_to_map",
        label: "Memory Map trail",
        section: ROUTE_SECTION,
        options: trailOptions,
        optionLabels: mapLabels,
        value: encodeConnectMap(this.connectToMap),
        onChange: (v) => this.setKey("connecting_to_map", v),
      },
      {
        kind: "select",
        key: "connecting_mode",
        label: "Connect to stroke or map?",
        section: ROUTE_SECTION,
        options: ConnectModeSchema.options,
        optionLabels: { both: "Both", stroke: "Stroke", map: "Map", none: "None" },
        value: this.connectMode,
        onChange: (v) => this.setKey("connecting_mode", v),
      },
    ];
  }

  // Universal art-style dials, supported by every connection. Weight + Spread
  // are universal: any connection can fan into more thin 1px lines for a heavier
  // mark (Harmony's rule — impact from more lines, never a fatter/opaquer one).
  protected baseStyleSliders(): BrushSetting[] {
    return [
      this.num("strands", "Weight", 1, MAX_CONNECT_STRANDS, 1, this.connectStrands),
      this.num("spread", "Spread", 0, 40, 1, this.connectSpread),
      this.num("alpha", "Opacity", 0, 1, 0.05, this.styleValue("alpha")),
      this.num("density", "Density", 0, 100, 1, this.connectDensity),
      this.num("radius", "Reach", 5, 200, 1, this.searchRadius),
      this.num("sampleSpacing", "Stipple", 0, 20, 1, this.connectSampleSpacing),
      this.num("fade", "Fade", 0, 1, 0.05, this.connectAlphaFade),
      this.num("curl", "Curl", 0, 1, 0.05, this.connectCurl),
      this.num("grainStrength", "Grain", 0, 1, 0.05, this.connectGrainStrength),
      this.num("grainAngle", "Grain angle", 0, 180, 5, this.connectGrainAngle),
      {
        kind: "boolean",
        key: "grainCross",
        label: "Crosshatch grain",
        section: STYLE_SECTION,
        value: this.connectGrainCross,
        onChange: (v) => this.setKey("grainCross", v),
      },
      this.num("minDist", "Min length", 0, this.searchRadius, 1, this.minConnectDist),
      this.num("inset", "Inset", 0, 0.45, 0.05, this.connectInset),
      {
        kind: "select",
        key: "connect",
        label: "Line shape",
        section: STYLE_SECTION,
        options: LineConnectTypes,
        optionLabels: { line: "Straight", arc: "Arc", quadraticCurve: "Curve" },
        value: this.connectType,
        onChange: (v) => this.setKey("connect", v),
      },
      {
        kind: "select",
        key: "dash",
        label: "Dash",
        section: STYLE_SECTION,
        options: DASH_STYLES,
        icons: DASH_ICONS,
        value: this.connectionDash,
        onChange: (v) => this.setKey("dash", v),
      },
      {
        kind: "select",
        key: "color",
        label: "Color",
        section: STYLE_SECTION,
        options: ["main", "secondary", "gradient", "rainbow"] as const,
        optionLabels: COLOR_SOURCE_LABELS,
        icons: colorSourceIcons(this.deps.store),
        value: this.connectionColorSource,
        onChange: (v) => this.setKey("color", v),
      },
    ];
  }
}

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
import {
  colorSourceIcons,
  connectionColorLabels,
  connectionColorOptions,
  connectionLineColor,
  createTravelHeading,
  headingToT,
  isDirectionalSource,
  mixHex,
  normalizeColorSource,
} from "../color-source";

// The "From mark" web colour source: each line takes the hue stored on the
// points it bridges (e.g. Color Pen anchors), so colour laid into the cloud
// flows out along the web. Listed only on the connecting Color dial (not the
// shared colour-source list, which also feeds solid-fill pickers).
import { createColorWheel } from "../color-wheel";
import { createCombPad } from "../comb-pad";

const POINTS_COLOR_SOURCE = "points";
const POINTS_SOURCE_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
  '<rect x="1" y="1" width="14" height="14" rx="3" fill="none" stroke="rgba(128,128,128,0.55)" stroke-width="1"/>' +
  '<line x1="5" y1="11" x2="11" y2="5" stroke="#34c759" stroke-width="1.4"/>' +
  '<circle cx="5" cy="11" r="2" fill="#ff3b30"/><circle cx="11" cy="5" r="2" fill="#00b8d4"/></svg>';

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
  // Persist the active style's dials now (the owning brush's
  // persistConnectionStyle). Called by self-managed widgets - the colour
  // direction wheel - that don't flow through the settings panel's persist path.
  persistStyle?: () => void;
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
  // Per-style "Web weight" Light/Heavy presets (Weight/Density/Links). Normal is
  // the style's own defaults, so only Light/Heavy are declared here.
  webWeight?: { light?: ConnectingFlat; heavy?: ConnectingFlat };
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
  protected connectMaxLinks = 0; // 0 = connect to all in range; N = the N nearest
  protected searchRadius = 40;
  // Bloom dials: target local density (points within reach) and the scatter
  // radius for the top-up. 0 = off. See bloomTopUp().
  protected connectBloom = 0;
  protected connectBloomRadius = 60;
  protected minConnectDist = 0;
  protected connectSampleSpacing = 0; // px between web samples; 0 = off (see sampleSpacing)
  protected connectionStyle: LineStyle = { alpha: 0.2, width: 1 };
  protected connectType: LineConnectType = "quadraticCurve";
  protected connectionDash: DashStyle = "solid";
  protected connectionColorSource = "main"; // one of CONNECTION_COLOR_OPTIONS
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
  // Colour-direction wheel state (used by the directional colour sources).
  // colorByTravel: false = colour each web line by its own angle (the original
  // behaviour); true = colour by the hand's direction of travel, so the gradient
  // walks as the stroke moves/curves (like the Color Pen). colorAngle rotates the
  // direction -> colour map (0..359).
  protected connectColorByTravel = false;
  protected connectColorAngle = 0;
  // How much of the palette a full turn covers (0..1); < 1 keeps a curving stroke
  // inside an arc instead of snapping to the complement on every reversal.
  protected connectColorRange = 1;
  // Measure the travel heading relative to the stroke's start (colorByTravel only)
  // so the same gesture gives the same colour run whichever way it's drawn.
  protected connectColorRelative = false;
  // Live hand heading (shared tracker, identical to the Color Pen's mapping).
  private travel = createTravelHeading();
  // Repaint/hide the colour-direction wheel when the colour source changes (set
  // when the widget builds).
  private redrawColorDir: () => void = () => {};

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

  // The style's Light/Heavy web-weight presets (the "Normal" preset is just the
  // style's own defaults, so only Light/Heavy are declared per style).
  webWeightSpec(): { light?: ConnectingFlat; heavy?: ConnectingFlat } {
    return this.spec.webWeight ?? {};
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
    if (firstSample) {
      this.strokeCutoffId = this.fromMapSize();
      this.travel.reset(); // re-anchor relative heading at each stroke
    }
    this.sampleSpeed = firstSample
      ? 0
      : Math.hypot(x - this.prevSampleX, y - this.prevSampleY);
    // Track the live hand heading for `colorByTravel` (the shared tracker maps it
    // 0..1 the same way the line angle is, so the wheel orients identically).
    this.travel.push(x, y);
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

  // Bloom: a density-targeted point multiplier. After a real deposit, top the
  // local neighbourhood up to `connectBloom` points - scattering where it's
  // sparse, nothing where it's already dense - then weave them, so the user's own
  // stroke blooms into a full web. Self-limiting: an already-full area adds
  // nothing, so point growth is bounded by area drawn, not time. No-op when 0.
  bloomTopUp(current: Pixel): void {
    const target = this.connectBloom;
    if (target <= 0) return;
    const radius = this.searchRadius * this.penRadiusFactor;
    const MAX_PER_DEPOSIT = 64; // safety: never add more than this in one go
    const need = Math.min(
      target - this.searchNeighbors(current, radius).length,
      MAX_PER_DEPOSIT,
    );
    if (need <= 0) return;
    const jr = this.connectBloomRadius;
    const added: Pixel[] = [];
    for (let i = 0; i < need; i++) {
      const a = this.random() * Math.PI * 2;
      const rr = Math.sqrt(this.random()) * jr; // uniform over the disc
      added.push(
        this.deposit(current.x + Math.cos(a) * rr, current.y + Math.sin(a) * rr).px,
      );
    }
    for (const p of added) this.connect(p);
  }

  // --- the connecting engine (moved verbatim from BrushBase) -----------------

  protected connectingNeighbors(current: Pixel): void {
    // Pen-bound dials: pressure scales the search radius and the per-neighbor
    // density odds (both 1× without a binding/pen). The fade normalizes to the
    // effective radius so the falloff shape is preserved at light pressure.
    const radius = this.searchRadius * this.penRadiusFactor;
    const density = this.connectDensity * this.penDensityFactor;
    let neighbors = this.searchNeighbors(current, radius);
    // "Links": cap each point to its N nearest in-range neighbours (0 = all).
    // Trims the long crossing lines for a clean local mesh. Default 0 leaves the
    // order (and thus the seeded-RNG draw output) byte-for-byte unchanged.
    if (this.connectMaxLinks > 0 && neighbors.length > this.connectMaxLinks) {
      neighbors = [...neighbors]
        .sort(
          (a, b) =>
            (a.x - current.x) ** 2 +
            (a.y - current.y) ** 2 -
            ((b.x - current.x) ** 2 + (b.y - current.y) ** 2),
        )
        .slice(0, this.connectMaxLinks);
    }
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
        color: this.lineColor(dx, dy, current, n),
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

  // The colour for one web line, by the line's angle (0..1 around the circle).
  // main -> undefined (the renderer uses the Primary strokeStyle); everything
  // else is resolved in color-source (gradient/rainbow/complement/palettes).
  private lineColor(dx: number, dy: number, a: Pixel, b: Pixel): string | undefined {
    if (this.connectionColorSource === POINTS_COLOR_SOURCE) {
      // Inherit the hue stored on the two points this line bridges. Blend when
      // both carry one (a Color-Pen-to-Color-Pen link); otherwise take whichever
      // endpoint is coloured (the common case: an uncoloured stroke point
      // weaving toward a Color Pen anchor). Neither coloured -> Primary.
      const ca = a.color;
      const cb = b.color;
      if (ca && cb) return mixHex(ca, cb, 0.5);
      return ca ?? cb ?? undefined;
    }
    if (this.connectionColorSource === "main") return undefined;
    // Drive the gradient by the hand's heading (colorByTravel, optionally relative
    // to the stroke start) or by each line's own angle (default), then apply the
    // wheel's Range + Rotate. Relative only applies to the travel heading.
    let base: number;
    if (this.connectColorByTravel) {
      base = this.connectColorRelative ? this.travel.relative() : this.travel.absolute();
    } else {
      base = Math.atan2(dy, dx) / (2 * Math.PI) + 0.5;
    }
    const t = headingToT(base, this.connectColorRange, this.connectColorAngle);
    return connectionLineColor(
      this.connectionColorSource,
      t,
      this.primaryColor(),
      this.secondaryColor(),
    );
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
      links: this.connectMaxLinks,
      radius: this.searchRadius,
      bloom: this.connectBloom,
      bloomRadius: this.connectBloomRadius,
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
      colorTravel: this.connectColorByTravel,
      colorAngle: this.connectColorAngle,
      colorRange: this.connectColorRange,
      colorRelative: this.connectColorRelative,
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
      case "links": if (typeof v === "number") this.connectMaxLinks = v; break;
      case "bloom": if (typeof v === "number") this.connectBloom = v; break;
      case "bloomRadius": if (typeof v === "number") this.connectBloomRadius = v; break;
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
      case "colorTravel": if (typeof v === "boolean") this.connectColorByTravel = v; break;
      case "colorAngle": if (typeof v === "number") this.connectColorAngle = v; break;
      case "colorRange": if (typeof v === "number") this.connectColorRange = v; break;
      case "colorRelative": if (typeof v === "boolean") this.connectColorRelative = v; break;
      case "connect": if (typeof v === "string") this.connectType = v as LineConnectType; break;
      case "dash": if (typeof v === "string") this.connectionDash = v as DashStyle; break;
      case "color":
        // Keep the source as-is (mapping legacy names); unknown sources resolve to
        // the Primary strokeStyle in connectionLineColor, and become valid once
        // their gradient palette loads - so don't reject them here.
        this.connectionColorSource = typeof v === "string" ? normalizeColorSource(v) : "main";
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

  // Style dials the settings panel shows by default in the art-style group (never
  // folded under "More"), regardless of value. A curated core - Opacity, Reach,
  // Colour, Line shape - so a first-timer sees a short shelf; every other dial
  // surfaces only when "in use" (value off its neutral) or its visibleWhen fires.
  // (Weight/Density/Links live in the Web-weight group, not here.) Bloom and Dash
  // were dropped from the core so they fold at their default instead of looking
  // like dead controls. Subclasses may override to open more of their own.
  defaultOpenKeys(): readonly string[] {
    return ["alpha", "radius", "color", "connect"];
  }

  private num(
    key: string,
    label: string,
    min: number,
    max: number,
    step: number,
    value: number,
    extra?: {
      unit?: string;
      visibleWhen?: { key: string; when: (v: string | number | boolean) => boolean };
    },
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
      ...(extra?.unit !== undefined ? { unit: extra.unit } : {}),
      ...(extra?.visibleWhen ? { visibleWhen: extra.visibleWhen } : {}),
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
      case "links": return this.connectMaxLinks;
      case "radius": return this.searchRadius;
      case "bloom": return this.connectBloom;
      case "bloomRadius": return this.connectBloomRadius;
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
    // The web reads + trails from the active map automatically (connectFromMap /
    // connectToMap stay "selected"); only the connect mode is user-facing.
    return [
      {
        kind: "select",
        key: "connecting_mode",
        label: "Connect to",
        section: ROUTE_SECTION,
        options: ConnectModeSchema.options,
        optionLabels: {
          both: "Both map and stroke",
          stroke: "Stroke",
          map: "Map",
          none: "Nothing",
        },
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
      // Spread only fans hairs when Weight > 1 (drawFanned); hide it otherwise.
      this.num("spread", "Spread", 0, 40, 1, this.connectSpread, {
        visibleWhen: { key: "strands", when: (v) => Number(v) > 1 },
      }),
      this.num("alpha", "Opacity", 0, 1, 0.05, this.styleValue("alpha")),
      this.num("density", "Density", 0, 100, 1, this.connectDensity, { unit: "%" }),
      this.num("radius", "Reach", 5, 1000, 1, this.searchRadius),
      this.num("bloom", "Bloom", 0, 100, 1, this.connectBloom, { unit: "%" }),
      this.num("links", "Max links", 0, 20, 1, this.connectMaxLinks),
      this.num("sampleSpacing", "Web spacing", 0, 20, 1, this.connectSampleSpacing),
      this.num("fade", "Fade", 0, 1, 0.05, this.connectAlphaFade),
      // Curl only renders on the Curve (quadraticCurve) line shape; hide otherwise.
      this.num("curl", "Curl", 0, 1, 0.05, this.connectCurl, {
        visibleWhen: { key: "connect", when: (v) => v === "quadraticCurve" },
      }),
      ...this.combSetting(), // folded Grain strength + angle + crosshatch
      this.num("minDist", "Declutter", 0, this.searchRadius, 1, this.minConnectDist),
      this.num("inset", "Float", 0, 0.45, 0.05, this.connectInset),
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
        label: "Colour",
        section: STYLE_SECTION,
        options: [POINTS_COLOR_SOURCE, ...connectionColorOptions()],
        optionLabels: { [POINTS_COLOR_SOURCE]: "From mark", ...connectionColorLabels() },
        icons: { [POINTS_COLOR_SOURCE]: POINTS_SOURCE_ICON, ...colorSourceIcons(this.deps.store) },
        value: this.connectionColorSource,
        onChange: (v) => {
          this.setKey("color", v);
          this.redrawColorDir(); // show/hide + repaint the wheel for the new source
        },
      },
      ...this.colorDirectionSetting(),
    ];
  }

  // The shared direction wheel + a "follow hand" toggle, as a self-managed custom
  // row. Hidden for solid sources (Primary/Secondary/From mark). Built only in a
  // DOM context - headless callers (tests, render harnesses) read the dials but
  // never the widget, so we skip the element rather than touch `document`.
  // Folded grain control (strength + angle + crosshatch). Skipped headless (no
  // DOM). `value` carries live strength so the panel folds it under "More" at 0.
  private combSetting(): BrushSetting[] {
    if (typeof document === "undefined") return [];
    return [
      {
        kind: "custom",
        key: "comb",
        label: "Comb",
        section: STYLE_SECTION,
        value: String(this.connectGrainStrength),
        inline: true,
        el: this.buildCombPad(),
      },
    ];
  }

  private buildCombPad(): HTMLElement {
    return createCombPad({
      getAngle: () => this.connectGrainAngle,
      onAngle: (deg) => {
        this.connectGrainAngle = deg;
      },
      getStrength: () => this.connectGrainStrength,
      onStrength: (v) => {
        this.connectGrainStrength = v;
      },
      getCross: () => this.connectGrainCross,
      onCross: (v) => {
        this.connectGrainCross = v;
      },
      commit: () => this.deps.persistStyle?.(),
    }).el;
  }

  private colorDirectionSetting(): BrushSetting[] {
    if (typeof document === "undefined") return [];
    return [
      {
        kind: "custom",
        key: "colorDirection",
        label: "Colour direction",
        section: STYLE_SECTION,
        value: "",
        el: this.buildColorDirection(),
      },
    ];
  }

  // The connecting-web colour-direction control: a toggle to colour by the
  // stroke's travel direction (vs each line's own angle), a "Relative" toggle,
  // the shared Rotate/Range wheel, and a caption that says what the current mode
  // does. Only meaningful for a directional source, so it hides itself for a
  // solid Primary/Secondary or the "From mark" inherit source.
  private buildColorDirection(): HTMLElement {
    const box = document.createElement("div");
    box.className = "colorpen-wheel-group";

    const caption = document.createElement("p");
    caption.className = "colorpen-wheel-caption";

    const travel = document.createElement("label");
    travel.className = "colorpen-wheel-check";
    const travelCb = document.createElement("input");
    travelCb.type = "checkbox";
    travelCb.checked = this.connectColorByTravel;
    const travelSpan = document.createElement("span");
    travelSpan.textContent = "Colour follows stroke";
    travel.append(travelCb, travelSpan);

    const rel = document.createElement("label");
    rel.className = "colorpen-wheel-check";
    const relCb = document.createElement("input");
    relCb.type = "checkbox";
    relCb.checked = this.connectColorRelative;
    const relSpan = document.createElement("span");
    relSpan.textContent = "Relative to stroke start";
    rel.append(relCb, relSpan);

    const wheel = createColorWheel({
      store: this.deps.store,
      getSource: () => this.connectionColorSource,
      getAngle: () => this.connectColorAngle,
      onAngle: (deg) => {
        this.connectColorAngle = deg;
        this.deps.persistStyle?.();
      },
      getRange: () => this.connectColorRange,
      onRange: (r) => {
        this.connectColorRange = r;
        this.deps.persistStyle?.();
      },
    });

    const refreshCaption = () => {
      // Relative only changes the travel heading, so it's dimmed in angle mode.
      rel.style.opacity = this.connectColorByTravel ? "" : "0.5";
      caption.textContent = this.connectColorByTravel
        ? "The web's colour follows the way your stroke travels."
        : "Each web line is coloured by the direction it points.";
    };
    travelCb.addEventListener("change", () => {
      this.connectColorByTravel = travelCb.checked;
      refreshCaption();
      this.deps.persistStyle?.();
    });
    relCb.addEventListener("change", () => {
      this.connectColorRelative = relCb.checked;
      this.deps.persistStyle?.();
    });

    const sync = () => {
      const directional = isDirectionalSource(this.connectionColorSource);
      const row = box.parentElement as HTMLElement | null;
      if (row) row.style.display = directional ? "" : "none";
      if (directional) wheel.repaint();
    };
    this.redrawColorDir = sync;
    refreshCaption();
    queueMicrotask(sync); // hide up front if the current source is solid

    box.append(travel, rel, wheel.el, caption);
    return box;
  }
}

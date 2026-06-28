import { z } from "zod";
import { LineConnectTypes } from "./renderer";
import type { LineStyle, LineConnectType } from "./renderer";
import type { Pixel } from "./neighbor-finder";

// Shared, dependency-light connecting types. Lives apart from base.ts so that
// the presets module and base.ts can both import these without forming an
// import cycle.

export const DASH_STYLES = ["solid", "dashed", "dotted"] as const;
export type DashStyle = (typeof DASH_STYLES)[number];

export const DASH_PATTERNS: Record<DashStyle, readonly number[]> = {
  solid: [],
  dashed: [6, 4],
  dotted: [1, 3],
};

// Small inline-SVG previews for a Dash select, mirroring DASH_PATTERNS.
const dashLine = (extra: string): string =>
  `<svg viewBox="0 0 22 10" width="22" height="10" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">` +
  `<line x1="1" y1="5" x2="21" y2="5"${extra}/></svg>`;
export const DASH_ICONS: Record<DashStyle, string> = {
  solid: dashLine(' stroke-linecap="round"'),
  dashed: dashLine(' stroke-dasharray="6 4"'),
  dotted: dashLine(' stroke-linecap="round" stroke-dasharray="1 3"'),
};

// --- connection routing -----------------------------------------------------

// Connection lines bake onto the active layer, resolved per stroke via
// ConnectRouter.activeConnectionLayerId(). Whether to connect at all is the
// ConnectMode below ("none" = off).

// Which neighbors map (point cloud) the stroke stores into and searches.
// "selected" follows the currently-selected map; "map" pins one by stable id;
// "none" stores/reads nothing (used by the trail's "No trail" option).
export const ConnectMapSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("selected") }),
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("map"), mapId: z.string() }),
]);
export type ConnectMap = z.infer<typeof ConnectMapSchema>;

// What a stroke connects to (id-cutoff based, relative to the current stroke):
//  - both:   connect to old map points + this stroke's points.
//  - stroke: connect only to this stroke's own points.
//  - map:    connect only to points that existed before this stroke.
//  - none:   don't connect at all.
export const ConnectModeSchema = z.enum(["both", "stroke", "map", "none"]);
export type ConnectMode = z.infer<typeof ConnectModeSchema>;

// Flat form of connecting settings as carried by the settings UI: the
// layer/map union fields are encoded to strings, everything else is primitive.
export type ConnectingFlat = Record<string, string | number | boolean>;

// Settings-panel section labels for the two connecting groups. The single
// source of truth, shared by the connection sliders (which tag each dial with
// a section), the panel (which groups by it) and persistence (which routes
// art-style dials to per-style storage). "Connection" = where/which-map
// routing; "Connection art style" = the look (the dials).
export const ROUTING_SECTION = "Connection";
export const STYLE_SECTION = "Connection art style";

// String<->union codecs so the flat select-based settings UI can carry these.
// Ids are UUIDs, so they never collide with the literal sentinels.
export function encodeConnectMap(c: ConnectMap): string {
  if (c.kind === "map") return c.mapId;
  return c.kind; // "selected" | "none"
}
export function decodeConnectMap(s: string): ConnectMap {
  if (s === "selected") return { kind: "selected" };
  if (s === "none") return { kind: "none" };
  return { kind: "map", mapId: s };
}

// Implemented by LayerManager. Lets a brush enumerate and target specific
// layers/maps by stable id. Falls back to active/selected when the id is gone.
export interface ConnectRouter {
  listLayers(): { id: string; name: string }[];
  listMaps(): { id: string; name: string }[];
  addPixelToMap(mapId: string, x: number, y: number): Pixel;
  findNeighborsInMap(mapId: string, px: Pixel, radius: number): Pixel[];
  // Pixel count of a map (the stroke cutoff marker). Falls back to the
  // selected map's size when the id is unknown.
  mapSize(mapId: string): number;
  // Clear every neighbors map's point cloud (used by brush clear()).
  clearPixels(): void;
  // Whether the renderer is currently in erase mode (then strokes shouldn't
  // deposit points or draw connections).
  isErasing(): boolean;
  // Context for the pixel log: active layer id, selected map id, stroke width.
  activeLayerId(): string;
  // Stable id of the layer currently holding the connection marker — the
  // target layer for baked connection lines.
  activeConnectionLayerId(): string;
  selectedMapId(): string;
  strokeWidth(): number;
  // The persistent stroke opacity (the Opacity slider) — the maximum that pen
  // pressure/tilt modulation scales down from.
  strokeAlpha(): number;
  drawConnectionToLayer(
    layerId: string,
    p1: Pixel,
    p2: Pixel,
    style?: LineStyle,
    kind?: LineConnectType,
  ): void;
}

// Re-export so callers needing the option list can build connect selects.
export { LineConnectTypes };

import type { BrushBase } from "../base";
import type { IRenderer } from "../renderer";
import type { PaintHost } from "../paint-host";
import type { Store } from "../store/base";
import brushesIndex from "./brushes.json";

// Everything needed to construct any brush, passed uniformly so each brush's
// create() picks only what it uses (e.g. Invisible reads getInvisibleOverlay;
// the rest ignore it). `host` is the one drawing surface every brush paints
// through — the LayerManager (behind the symmetry proxy) at runtime.
export type BrushContext = {
  host: PaintHost;
  store: Store;
  getInvisibleOverlay: () => IRenderer;
};

// Each brush .ts names its menu glyph (icon) and how to construct itself
// (create). brushes.json is the ordered index — name/file/shortcut/group/etc.
// Add a brush by writing its .ts and adding one JSON row; nothing here changes.
type BrushModule = {
  icon: string;
  create: (ctx: BrushContext) => BrushBase;
};

const modules = import.meta.glob<BrushModule>("./*.ts", { eager: true });

type IndexEntry = {
  name: string;
  label?: string;
  file: string;
  shortcut?: string;
  menuGroup?: string;
  connections?: boolean;
  info?: string;
};
const INDEX = brushesIndex as IndexEntry[];

function moduleFor(file: string): BrushModule {
  const mod = modules["./" + file];
  if (!mod || typeof mod.create !== "function")
    throw new Error(`brush module not found or invalid: ${file}`);
  return mod;
}

// One entry per brush — the single source of truth. The brush map, toolbar menu,
// keyboard shortcuts and the pixel-log brush_type validation are all derived
// from this list (built from brushes.json + each brush module).
export type BrushDef = {
  name: string; // display name, storage key, and pixel-log brush_type
  label?: string; // toolbar menu label when it should differ from name (Round shows as "Web")
  shortcut?: string; // single key for keyboard select + menu hint (e.g. "1")
  menuGroup?: string; // toolbar sub-group label; undefined = top-level
  connections?: boolean; // whether the brush weaves the connecting web
  info?: string; // short blurb
  icon: string; // menu glyph: inline SVG markup or a single character
  create: (ctx: BrushContext) => BrushBase;
};

// Order here drives the toolbar menu order; consecutive entries sharing a
// menuGroup are wrapped into that sub-group.
export const BRUSH_DEFS: BrushDef[] = INDEX.map((e) => {
  const mod = moduleFor(e.file);
  return {
    name: e.name,
    label: e.label,
    shortcut: e.shortcut,
    menuGroup: e.menuGroup,
    connections: e.connections,
    info: e.info,
    icon: mod.icon,
    create: mod.create,
  };
});

const KNOWN = new Set(BRUSH_DEFS.map((d) => d.name));

// Used by pixel-log.ts to validate brush_type without hardcoding a name list.
export function isKnownBrush(name: string): boolean {
  return KNOWN.has(name);
}

export function brushNames(): string[] {
  return BRUSH_DEFS.map((d) => d.name);
}

// The toolbar/menu display label for a brush (falls back to its name). Round is
// shown as "Web"; its internal name/storage key stays "Round".
export function brushLabel(name: string): string {
  return BRUSH_DEFS.find((d) => d.name === name)?.label ?? name;
}

import { z } from "zod";
import { CanvasSizeSchema } from "./canvas-size";
import { LayersConfigSchema } from "./layered/schema";

export const NEKUDOT_SCHEMA_VERSION = 2 as const;

// The artwork file extension. One home for the literal so save/load/sync/accept
// can't drift (mirrors SETTINGS_FILE_SUFFIX for the .nekudotapp settings file).
export const NEKUDOT_ARTWORK_SUFFIX = ".nekudot";

export const LayerFilesSchema = z.object({
  layerIndex: z.number().int().nonnegative(),
  baseFile: z.string().min(1),
});
export type LayerFiles = z.infer<typeof LayerFilesSchema>;

export const NeighborsMapFileSchema = z.object({
  index: z.number().int().nonnegative(),
  file: z.string().min(1),
});
export type NeighborsMapFile = z.infer<typeof NeighborsMapFileSchema>;

export const ManifestSchema = z.object({
  version: z.literal(NEKUDOT_SCHEMA_VERSION),
  savedAt: z.string().min(1),
  canvas: CanvasSizeSchema,
  config: LayersConfigSchema,
  files: z.object({
    preview: z.string().min(1),
    layers: z.array(LayerFilesSchema),
    neighborsMaps: z.array(NeighborsMapFileSchema),
    pixelLog: z.string().min(1).optional(),
  }),
});
export type Manifest = z.infer<typeof ManifestSchema>;

// Coordinates are canvas pixels (canvas is at most 8192 px); a real point, even
// off-canvas, stays well within this. The bound also rejects nonsense values -
// z.number() already rejects NaN/Infinity (a JSON "1e999" parses to Infinity),
// and this catches finite-but-absurd coordinates from a corrupt file.
export const MAX_MAP_COORD = 1_000_000;

export const NeighborsMapPixelsSchema = z.array(
  // `color` is optional: most points carry the hue painted at deposit, but older
  // files (and uncoloured points) omit it, so it stays optional for back-compat.
  z.object({
    x: z.number().min(-MAX_MAP_COORD).max(MAX_MAP_COORD),
    y: z.number().min(-MAX_MAP_COORD).max(MAX_MAP_COORD),
    color: z.string().max(64).optional(),
  }),
);
export type NeighborsMapPixels = z.infer<typeof NeighborsMapPixelsSchema>;

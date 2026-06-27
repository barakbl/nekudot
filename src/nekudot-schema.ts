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

export const NeighborsMapPixelsSchema = z.array(
  z.object({ x: z.number(), y: z.number() }),
);
export type NeighborsMapPixels = z.infer<typeof NeighborsMapPixelsSchema>;

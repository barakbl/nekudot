import { z } from "zod";

export const MAX_LAYERS_DEFAULT = 10;

// Stable identity for layers and neighbors maps so connecting-brush pins
// survive add/remove/reorder (indices don't). Legacy configs missing an id
// get one generated at parse time via the schema default.
export function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const LayerTypeSchema = z.enum(["normal"]);
export type LayerType = z.infer<typeof LayerTypeSchema>;

export const LayerSchema = z.object({
  id: z.string().default(genId),
  index: z.number().int().nonnegative(),
  name: z.string().min(1),
  types: z.array(LayerTypeSchema).min(1).default(["normal"]),
  opacity: z.number().min(0).max(100).default(100),
});
export type LayerConfig = z.infer<typeof LayerSchema>;

export const NeighborsMapSchema = z.object({
  id: z.string().default(genId),
  name: z.string().min(1),
  opacity: z.number().min(0).max(100).default(100),
});
export type NeighborsMapConfig = z.infer<typeof NeighborsMapSchema>;

export const BackgroundSchema = z.object({
  color: z.string().default("#ffffff"),
  // When true the canvas has no background: it flattens to a transparent PNG on
  // export, and the stage/previews show a checkerboard. `color` is kept so the
  // last chosen colour returns when transparency is switched off.
  transparent: z.boolean().default(false),
});
export type BackgroundConfig = z.infer<typeof BackgroundSchema>;

export const LayersConfigSchema = z.object({
  maxLayers: z.number().int().positive().default(MAX_LAYERS_DEFAULT),
  activeIndex: z.number().int().nonnegative().default(0),
  layers: z.array(LayerSchema).min(1),
  neighborsMaps: z
    .array(NeighborsMapSchema)
    .min(1)
    .default(() => [defaultNeighborsMap([])]),
  selectedNeighborsMapIndex: z.number().int().nonnegative().default(0),
  background: BackgroundSchema.default({ color: "#ffffff", transparent: false }),
});
export type LayersConfig = z.infer<typeof LayersConfigSchema>;

export function defaultLayer(index: number): LayerConfig {
  return {
    id: genId(),
    index,
    // Display name only (identity is `id`), so a friendly default is free to change.
    name: `Layer ${index + 1}`,
    types: ["normal"],
    opacity: 100,
  };
}

// Upgrade a legacy default layer name ("layer-2" -> "Layer 2") for display; a
// no-op on custom names and the current "Layer N" default.
export function prettyLayerName(name: string): string {
  return name.replace(/^layer-(\d+)$/i, "Layer $1");
}

export function defaultNeighborsMap(
  existing: readonly NeighborsMapConfig[],
): NeighborsMapConfig {
  return { id: genId(), name: `map-${existing.length + 1}`, opacity: 100 };
}

export function defaultLayersConfig(
  maxLayers: number = MAX_LAYERS_DEFAULT,
): LayersConfig {
  return {
    maxLayers,
    // Start with two layers: the second (Layer 2) selected for painting.
    activeIndex: 1,
    layers: [defaultLayer(0), defaultLayer(1)],
    neighborsMaps: [defaultNeighborsMap([])],
    selectedNeighborsMapIndex: 0,
    background: { color: "#ffffff", transparent: false },
  };
}

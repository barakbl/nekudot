import { unzipSync, strFromU8, type UnzipFileInfo } from "fflate";
import { z } from "zod";
import { CanvasSizeSchema, type CanvasSize } from "./canvas-size";
import { LayersConfigSchema, type LayersConfig } from "./layered/schema";
import { NeighborsMapPixelsSchema, NEKUDOT_SCHEMA_VERSION } from "./nekudot-schema";
import type { LayerManager } from "./layered/manager";
import type { PixelLog } from "./pixel-log";

// ---- security limits --------------------------------------------------------
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // whole .nekudot on disk
const MAX_FILE_BYTES = 50 * 1024 * 1024; // any single entry, uncompressed
const MAX_DIM = 8192; // canvas width/height
const MAX_IMAGE_PIXELS = 64 * 1024 * 1024; // decoded bitmap guard
const MAX_MAP_PIXELS = 200_000; // per neighbors map (extra trimmed)

// ---- lenient import manifest (accepts current + older shapes) ---------------
// LayersConfigSchema strips unknown keys, so a legacy config carrying the old
// `sub_layers` field parses cleanly. v1 layer files may list `subLayers` PNGs;
// we composite those onto the single layer canvas (best-effort migration).
const ImportLayerFileSchema = z.object({
  layerIndex: z.number().int().nonnegative(),
  baseFile: z.string().min(1),
  subLayers: z.array(z.object({ file: z.string().min(1) })).optional(),
});
const ImportManifestSchema = z.object({
  version: z.number(),
  canvas: CanvasSizeSchema,
  config: LayersConfigSchema,
  files: z.object({
    preview: z.string().min(1).optional(),
    layers: z.array(ImportLayerFileSchema).min(1),
    neighborsMaps: z.array(
      z.object({
        index: z.number().int().nonnegative(),
        file: z.string().min(1),
      }),
    ),
    pixelLog: z.string().min(1).optional(),
  }),
});

export type LoadedArtwork = {
  size: CanvasSize;
  config: LayersConfig;
  layers: { index: number; bitmaps: ImageBitmap[] }[];
  maps: { index: number; pixels: { x: number; y: number }[] }[];
  pixelLogText: string;
};

export type LoadResult =
  | { ok: true; artwork: LoadedArtwork }
  | { ok: false; error: string };

function fail(error: string): LoadResult {
  return { ok: false, error };
}

// Parse + validate a .nekudot file. Decompresses only manifest first, validates
// it, then only the manifest-referenced entries — each guarded by a size cap
// checked from the zip metadata *before* inflating (zip-bomb defense).
export async function loadArtworkFile(file: File): Promise<LoadResult> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return fail(`File is too large (${mb(file.size)} MB; max ${mb(MAX_UPLOAD_BYTES)} MB).`);
  }

  let u8: Uint8Array;
  try {
    u8 = new Uint8Array(await file.arrayBuffer());
  } catch {
    return fail("Could not read the file.");
  }

  // 1. manifest.json only.
  let oversize = false;
  let manifestRaw: Record<string, Uint8Array>;
  try {
    manifestRaw = unzipSync(u8, {
      filter: (f: UnzipFileInfo) => {
        if (f.name !== "manifest.json") return false;
        if (f.originalSize > MAX_FILE_BYTES) oversize = true;
        return !oversize;
      },
    });
  } catch {
    return fail("Not a valid .nekudot archive.");
  }
  if (oversize) return fail("manifest.json is unexpectedly large.");
  const manifestBytes = manifestRaw["manifest.json"];
  if (!manifestBytes) return fail("Archive has no manifest.json.");

  // 2. Validate manifest.
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(strFromU8(manifestBytes));
  } catch {
    return fail("manifest.json is not valid JSON.");
  }
  const parsed = ImportManifestSchema.safeParse(manifestJson);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(`Invalid manifest: ${issue.path.join(".") || "(root)"} — ${issue.message}.`);
  }
  const manifest = parsed.data;
  if (manifest.version > NEKUDOT_SCHEMA_VERSION) {
    return fail(
      `Made by a newer version (v${manifest.version}); this app supports up to v${NEKUDOT_SCHEMA_VERSION}.`,
    );
  }

  // 3. Canvas size sanity.
  const size = manifest.canvas;
  if (size.width < 1 || size.height < 1 || size.width > MAX_DIM || size.height > MAX_DIM) {
    return fail(`Canvas size out of range (${size.width}×${size.height}).`);
  }

  // 4. Decompress only referenced entries, each size-capped before inflating.
  const wanted = new Set<string>();
  for (const L of manifest.files.layers) {
    wanted.add(L.baseFile);
    for (const s of L.subLayers ?? []) wanted.add(s.file);
  }
  for (const m of manifest.files.neighborsMaps) wanted.add(m.file);
  if (manifest.files.pixelLog) wanted.add(manifest.files.pixelLog);

  const tooBig: string[] = [];
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(u8, {
      filter: (f: UnzipFileInfo) => {
        if (!wanted.has(f.name)) return false;
        if (f.originalSize > MAX_FILE_BYTES) {
          tooBig.push(f.name);
          return false;
        }
        return true;
      },
    });
  } catch {
    return fail("Archive entries could not be read.");
  }
  if (tooBig.length) return fail(`Entry too large: ${tooBig[0]} (max ${mb(MAX_FILE_BYTES)} MB).`);

  // 5. Decode layer images (base + any legacy sublayers, composited in order).
  const layers: LoadedArtwork["layers"] = [];
  for (const L of manifest.files.layers) {
    const names = [L.baseFile, ...(L.subLayers ?? []).map((s) => s.file)];
    const bitmaps: ImageBitmap[] = [];
    for (const name of names) {
      const bytes = files[name];
      if (!bytes) {
        if (name === L.baseFile) {
          closeAll(layers, bitmaps);
          return fail(`Missing layer image: ${name}.`);
        }
        continue; // optional sublayer missing — skip
      }
      let bmp: ImageBitmap;
      try {
        bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: "image/png" }));
      } catch {
        closeAll(layers, bitmaps);
        return fail(`Could not decode image: ${name}.`);
      }
      if (bmp.width * bmp.height > MAX_IMAGE_PIXELS) {
        bmp.close?.();
        closeAll(layers, bitmaps);
        return fail(`Image too large: ${name}.`);
      }
      bitmaps.push(bmp);
    }
    layers.push({ index: L.layerIndex, bitmaps });
  }

  // 6. Parse neighbors maps (capped).
  const maps: LoadedArtwork["maps"] = [];
  for (const m of manifest.files.neighborsMaps) {
    const bytes = files[m.file];
    if (!bytes) continue;
    let pts: { x: number; y: number }[];
    try {
      pts = NeighborsMapPixelsSchema.parse(JSON.parse(strFromU8(bytes)));
    } catch {
      closeAll(layers, []);
      return fail(`Invalid neighbors map: ${m.file}.`);
    }
    if (pts.length > MAX_MAP_PIXELS) pts = pts.slice(0, MAX_MAP_PIXELS);
    maps.push({ index: m.index, pixels: pts });
  }

  // 7. Pixel log text, kept as raw JSONL here; PixelLog.loadRawJSONL validates
  //    and drops bad rows when it's applied (see applyArtwork).
  const pixelLogText = manifest.files.pixelLog
    ? strFromU8(files[manifest.files.pixelLog] ?? new Uint8Array(0))
    : "";

  return { ok: true, artwork: { size, config: manifest.config, layers, maps, pixelLogText } };
}

// Apply a validated artwork to the live manager + pixel log. Bitmaps are
// consumed (closed) here. UI refresh / persistence is the caller's job.
export async function applyArtwork(
  manager: LayerManager,
  pixelLog: PixelLog,
  art: LoadedArtwork,
): Promise<void> {
  manager.applyConfig(art.config, art.size);
  manager.applyDecodedPaint({ layers: art.layers, maps: art.maps });
  for (const L of art.layers) for (const bmp of L.bitmaps) bmp.close?.();
  await pixelLog.loadRawJSONL(art.pixelLogText);
}

function closeAll(
  layers: LoadedArtwork["layers"],
  extra: ImageBitmap[],
): void {
  for (const L of layers) for (const b of L.bitmaps) b.close?.();
  for (const b of extra) b.close?.();
}

function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

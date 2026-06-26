import { zipSync, strToU8 } from "fflate";
import type { LayerManager } from "./layered/manager";
import { flattenLayers, timestamp, triggerDownload } from "./export";
import { createOffscreenRenderer } from "./renderer";
import { pixelLog } from "./pixel-log";
import {
  NEKUDOT_SCHEMA_VERSION,
  ManifestSchema,
  type LayerFiles,
  type NeighborsMapFile,
} from "./nekudot-schema";

export async function saveArtwork(manager: LayerManager): Promise<void> {
  const bg = manager.getBackground().color;
  const size = manager.currentSize;
  const filesU8: Record<string, Uint8Array> = {};

  // 1. One PNG per layer. collectLayerBlobs() is the shared model->bytes
  //    collector, so this stays in lockstep with the undo snapshot.
  const layerFiles: LayerFiles[] = [];
  for (const { layerIndex, blob } of await manager.collectLayerBlobs()) {
    const baseFile = `layers/layer${layerIndex}.png`;
    filesU8[baseFile] = await blobToU8(blob);
    layerFiles.push({ layerIndex, baseFile });
  }

  // 2. Top-level neighbors map JSONs (shared collectMapPixels() keeps the saved
  //    points identical to the undo snapshot).
  const nmFiles: NeighborsMapFile[] = [];
  for (const { index, pixels } of manager.collectMapPixels()) {
    const file = `neighbors/map${index}.json`;
    filesU8[file] = strToU8(JSON.stringify(pixels));
    nmFiles.push({ index, file });
  }

  // 3. Append-only pixel log (one JSON object per line).
  const pixelLogFile = "pixel-log.jsonl";
  filesU8[pixelLogFile] = strToU8(pixelLog.toJSONL());

  // 4. Flattened preview, longest side = 100 px, aspect preserved.
  filesU8["preview.png"] = await blobToU8(await buildPreviewBlob(manager, bg));

  // 5. Manifest — full LayersConfig snapshot + file index.
  const manifest = {
    version: NEKUDOT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    canvas: size,
    config: manager.getConfig(),
    files: {
      preview: "preview.png",
      layers: layerFiles,
      neighborsMaps: nmFiles,
      pixelLog: pixelLogFile,
    },
  };
  ManifestSchema.parse(manifest);
  filesU8["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));

  // 6. Zip (STORE — payloads are already compressed) and trigger download.
  const zipped = zipSync(filesU8, { level: 0 });
  const blob = new Blob([zipped as BlobPart], { type: "application/zip" });
  triggerDownload(blob, `art_${timestamp()}.nekudot`);
}

async function buildPreviewBlob(
  manager: LayerManager,
  bg: string,
): Promise<Blob> {
  const size = manager.currentSize;
  const maxDim = Math.max(size.width, size.height);
  const cssScale = 100 / maxDim;
  const target = {
    width: Math.max(1, Math.round(size.width * cssScale)),
    height: Math.max(1, Math.round(size.height * cssScale)),
  };
  const dpr = window.devicePixelRatio || 1;
  const sourcePixelScale = cssScale / dpr;

  const flat = flattenLayers(manager, { backgroundColor: bg });
  const preview = createOffscreenRenderer(target, 1);
  if (bg !== "transparent") preview.fillBackground(bg);
  preview.drawSource(flat, 1, sourcePixelScale);

  const blob = await preview.toBlob("image/png");
  if (!blob) throw new Error("save-artwork: preview encode failed");
  return blob;
}

async function blobToU8(blob: Blob | null): Promise<Uint8Array> {
  if (!blob) return new Uint8Array(0);
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

import { encodeGif } from "./encode-gif";
import { createVideoExporter } from "./encode-webm";

// A clip export format driving the preview's Save button (label, ext, encode).
// Add an entry; once there's more than one, the preview offers a picker.
export interface Exporter {
  id: string; // stable key, e.g. "gif"
  label: string; // shown on the Save button, e.g. "GIF"
  ext: string; // download file extension, e.g. "gif"
  encode(
    frames: ImageData[],
    delayMs: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Blob>;
}

export const gifExporter: Exporter = {
  id: "gif",
  label: "GIF",
  ext: "gif",
  encode: encodeGif,
};

// GIF works everywhere; the video exporter (WebCodecs) is added at runtime by
// resolveVideoExporter() when supported.
export const EXPORTERS: Exporter[] = [gifExporter];

// Best video exporter (WebCodecs + muxer -> MP4/WebM), or null. Memoized (async probe).
let videoExporterProbe: Promise<Exporter | null> | null = null;
export function resolveVideoExporter(): Promise<Exporter | null> {
  if (!videoExporterProbe) videoExporterProbe = createVideoExporter();
  return videoExporterProbe;
}

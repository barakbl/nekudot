import { encodeGif } from "./encode-gif";
import { createVideoExporter } from "./encode-webm";

// A clip export format. The preview's Save button is driven entirely by the
// active Exporter (its label, extension, and encode), so adding a format later
// (e.g. WebM) is just another entry — once there's more than one, the preview
// offers a picker (see preview-box.ts).
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

// The always-available formats, in menu order. GIF works everywhere; the video
// exporter (WebCodecs) is added at runtime by resolveVideoExporter() when the
// browser supports it.
export const EXPORTERS: Exporter[] = [gifExporter];

// The best video exporter this browser supports (WebCodecs + a muxer -> MP4 or
// WebM), or null. Memoized because VideoEncoder.isConfigSupported is async and the
// answer never changes within a session.
let videoExporterProbe: Promise<Exporter | null> | null = null;
export function resolveVideoExporter(): Promise<Exporter | null> {
  if (!videoExporterProbe) videoExporterProbe = createVideoExporter();
  return videoExporterProbe;
}

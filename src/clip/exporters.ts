import { encodeGif } from "./encode-gif";

// A clip export format. The preview's Save button is driven entirely by the
// active Exporter (its label, extension, and encode), so adding a format later
// (e.g. WebM) is just another entry in EXPORTERS — once there's more than one,
// the preview can offer a picker (see preview-box.ts).
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

// The available export formats, in menu order. Add new exporters here.
export const EXPORTERS: Exporter[] = [gifExporter];

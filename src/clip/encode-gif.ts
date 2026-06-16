import { GIFEncoder, quantize, applyPalette } from "gifenc";

// Provenance stamped into the GIF's metadata (a Comment Extension), not the
// pixels - it travels with the file without touching a frame.
const GIF_COMMENT = "build using nekudot app: https://nekudot.app/";

// Splice a GIF89a Comment Extension (0x21 0xFE, length-prefixed sub-blocks,
// 0x00 terminator) in just before the trailer (0x3B). Comment blocks are legal
// anywhere a data block is, so this keeps the file valid.
function withComment(bytes: Uint8Array, text: string): Uint8Array {
  const raw = new TextEncoder().encode(text);
  const sub: number[] = [];
  for (let i = 0; i < raw.length; i += 255) {
    const chunk = raw.subarray(i, i + 255);
    sub.push(chunk.length, ...chunk);
  }
  const ext = Uint8Array.from([0x21, 0xfe, ...sub, 0x00]);
  const hasTrailer = bytes[bytes.length - 1] === 0x3b;
  const body = hasTrailer ? bytes.subarray(0, bytes.length - 1) : bytes;
  const out = new Uint8Array(body.length + ext.length + 1);
  out.set(body, 0);
  out.set(ext, body.length);
  out[out.length - 1] = 0x3b; // trailer
  return out;
}

// Encode RGBA frames into an animated GIF blob. Each frame gets its own 256-colour
// palette (best quality for line art with shading). Runs on the main thread —
// the single-file build inlines one JS chunk, so a worker-based encoder would
// break it — but yields every few frames so the UI/progress stay responsive.
export async function encodeGif(
  frames: ImageData[],
  delayMs: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const gif = GIFEncoder();
  const total = frames.length;
  for (let i = 0; i < total; i++) {
    const { data, width, height } = frames[i];
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, width, height, {
      palette,
      delay: delayMs,
      ...(i === 0 ? { repeat: 0 } : {}), // loop forever
    });
    onProgress?.(i + 1, total);
    if ((i & 7) === 7) await new Promise((r) => setTimeout(r)); // yield each 8 frames
  }
  gif.finish();
  const bytes = withComment(gif.bytes(), GIF_COMMENT);
  return new Blob([bytes as BlobPart], { type: "image/gif" });
}

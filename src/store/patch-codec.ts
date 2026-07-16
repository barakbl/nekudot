// Codec for undo-tile patches: RGBA pixels <-> a compact Blob. deflate-raw (exact)
// when CompressionStream exists, else PNG; format tagged in a header + the blob
// type. A missing CompressionStream degrades, never throws (the iPad lesson).

// Structurally an ImageData, but a plain object so it constructs in Node too.
export type PatchPixels = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

// iOS canvas cap; patches stay square/small, so a bigger side is a bug.
export const MAX_PATCH_SIDE = 4096;

// magic "NKP1" | format u8 | reserved u8 | width u16 LE | height u16 LE | reserved u16
const MAGIC = [0x4e, 0x4b, 0x50, 0x31] as const;
const HEADER_LEN = 12;
const FMT_DEFLATE = 0;
const FMT_PNG = 1;

const DEFLATE_TYPE = "application/x-nekudot-patch; codec=deflate-raw";
const PNG_TYPE = "application/x-nekudot-patch; codec=png";

export function hasCompressionStream(): boolean {
  return (
    typeof CompressionStream !== "undefined" &&
    typeof DecompressionStream !== "undefined"
  );
}

function writeHeader(
  format: number,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  const h = new Uint8Array(HEADER_LEN);
  h.set(MAGIC, 0);
  h[4] = format;
  h[6] = width & 0xff;
  h[7] = (width >> 8) & 0xff;
  h[8] = height & 0xff;
  h[9] = (height >> 8) & 0xff;
  return h;
}

function readHeader(bytes: Uint8Array): {
  format: number;
  width: number;
  height: number;
} {
  if (
    bytes.length < HEADER_LEN ||
    bytes[0] !== MAGIC[0] ||
    bytes[1] !== MAGIC[1] ||
    bytes[2] !== MAGIC[2] ||
    bytes[3] !== MAGIC[3]
  ) {
    throw new Error("patch-codec: not a patch blob (bad magic)");
  }
  return {
    format: bytes[4],
    width: bytes[6] | (bytes[7] << 8),
    height: bytes[8] | (bytes[9] << 8),
  };
}

// ArrayBuffer-backed (not SharedArrayBuffer) so the result is a valid BlobPart.
async function pipe(
  data: Uint8Array<ArrayBuffer>,
  transform: GenericTransformStream,
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([data]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const deflateRaw = (data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> =>
  pipe(data, new CompressionStream("deflate-raw"));
const inflateRaw = (data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> =>
  pipe(data, new DecompressionStream("deflate-raw"));

// PNG-fallback canvas; only reached when CompressionStream is absent.
function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function canvasToBlob(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  type: string,
): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob: null"))), type),
  );
}

async function encodePng(px: PatchPixels): Promise<Uint8Array<ArrayBuffer>> {
  const canvas = makeCanvas(px.width, px.height);
  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("patch-codec: no 2D context for PNG encode");
  ctx.putImageData(new ImageData(Uint8ClampedArray.from(px.data), px.width, px.height), 0, 0);
  const blob = await canvasToBlob(canvas, "image/png");
  return new Uint8Array(await blob.arrayBuffer());
}

async function decodePng(
  body: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
): Promise<PatchPixels> {
  const bmp = await createImageBitmap(new Blob([body], { type: "image/png" }));
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d") as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error("patch-codec: no 2D context for PNG decode");
  ctx.drawImage(bmp, 0, 0);
  const img = ctx.getImageData(0, 0, width, height);
  return { data: img.data, width, height };
}

export async function encodePatch(px: PatchPixels): Promise<Blob> {
  if (px.width > MAX_PATCH_SIDE || px.height > MAX_PATCH_SIDE) {
    throw new Error(
      `patch-codec: side over ${MAX_PATCH_SIDE}px (${px.width}x${px.height})`,
    );
  }
  if (hasCompressionStream()) {
    // Copy into an ArrayBuffer-backed view (px.data may sit on a SharedArrayBuffer).
    const rgba = Uint8Array.from(px.data);
    const body = await deflateRaw(rgba);
    return new Blob([writeHeader(FMT_DEFLATE, px.width, px.height), body], {
      type: DEFLATE_TYPE,
    });
  }
  const body = await encodePng(px);
  return new Blob([writeHeader(FMT_PNG, px.width, px.height), body], {
    type: PNG_TYPE,
  });
}

export async function decodePatch(blob: Blob): Promise<PatchPixels> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { format, width, height } = readHeader(bytes);
  const body = bytes.subarray(HEADER_LEN);
  if (format === FMT_DEFLATE) {
    const raw = await inflateRaw(body);
    return {
      data: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength),
      width,
      height,
    };
  }
  if (format === FMT_PNG) return decodePng(body, width, height);
  throw new Error(`patch-codec: unknown format ${format}`);
}

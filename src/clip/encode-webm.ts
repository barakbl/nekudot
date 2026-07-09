import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from "mp4-muxer";
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from "webm-muxer";
import type { Exporter } from "./exporters";

// Process/clip video export (vector-replay P3.3). GIF is the wrong container for
// a minutes-long process video (1080p GIFs run tens of MB); WebCodecs encodes the
// SAME opaque-RGBA Clip frames the GIF path produces into a real H.264/MP4 (or
// VP9/WebM) file, faster than realtime. The muxers are npm deps bundled into the
// single-file app - never CDN'd, which the app's CSP forbids.

export type VideoCandidate = {
  ext: "mp4" | "webm";
  mime: string;
  label: string;
  encoderCodec: string; // VideoEncoder config.codec
  container: "mp4" | "webm";
  muxerCodec: string; // muxer video.codec (mp4: 'avc'/'vp9'; webm: 'V_VP9'/'V_VP8')
  avc?: boolean; // configure the encoder with avc:{format:'avc'} (mp4/H.264)
};

// Tried in preference order; the first whose config the browser reports supported
// wins. MP4/H.264 first: smallest, and the only one that plays everywhere incl.
// Safari and social uploads. WebM/VP9 then VP8 cover Chrome/Firefox where an H.264
// encoder isn't exposed.
export const VIDEO_CANDIDATES: readonly VideoCandidate[] = [
  { ext: "mp4", mime: "video/mp4", label: "MP4", encoderCodec: "avc1.42001f", container: "mp4", muxerCodec: "avc", avc: true },
  { ext: "webm", mime: "video/webm", label: "WebM", encoderCodec: "vp09.00.10.08", container: "webm", muxerCodec: "V_VP9" },
  { ext: "webm", mime: "video/webm", label: "WebM", encoderCodec: "vp8", container: "webm", muxerCodec: "V_VP8" },
];

// Codecs generally require even dimensions; the Clip frames are already <=640px
// (MAX_DIM), so dropping the odd last row/column is invisible.
export function evenDim(n: number): number {
  return n - (n % 2);
}

export function fpsFromDelay(delayMs: number): number {
  return Math.max(1, Math.round(1000 / Math.max(1, delayMs)));
}

// ~0.2 bits/pixel, clamped to a sane [1, 12] Mbps window: small timelapse frames
// still get enough bits, big ones don't balloon.
export function bitrateFor(width: number, height: number, fps: number): number {
  return Math.min(12_000_000, Math.max(1_000_000, Math.round(width * height * fps * 0.2)));
}

type ConfigProbe = (config: VideoEncoderConfig) => Promise<{ supported?: boolean }>;

// The first candidate this browser can actually encode, or null. `probe` defaults
// to VideoEncoder.isConfigSupported (injected in tests, where WebCodecs is absent).
export async function pickVideoCandidate(
  candidates: readonly VideoCandidate[] = VIDEO_CANDIDATES,
  probe?: ConfigProbe,
): Promise<VideoCandidate | null> {
  const run =
    probe ??
    (typeof VideoEncoder !== "undefined"
      ? (c: VideoEncoderConfig) => VideoEncoder.isConfigSupported(c)
      : null);
  if (!run) return null;
  for (const c of candidates) {
    try {
      const r = await run({ codec: c.encoderCodec, width: 640, height: 480 });
      if (r?.supported) return c;
    } catch {
      // An unknown codec string throws in some browsers - just try the next.
    }
  }
  return null;
}

// The best available video Exporter for this browser, or null (GIF stays the only
// format). Async because isConfigSupported is.
export async function createVideoExporter(): Promise<Exporter | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  const candidate = await pickVideoCandidate();
  if (!candidate) return null;
  return {
    id: `video-${candidate.container}`,
    label: candidate.label,
    ext: candidate.ext,
    encode: (frames, delayMs, onProgress) => encodeVideo(candidate, frames, delayMs, onProgress),
  };
}

type AnyMuxer = {
  addVideoChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  finalize(): void;
};

function createMuxer(
  c: VideoCandidate,
  width: number,
  height: number,
  fps: number,
): { muxer: AnyMuxer; buffer: () => ArrayBuffer } {
  if (c.container === "mp4") {
    const target = new Mp4Target();
    const muxer = new Mp4Muxer({
      target,
      fastStart: "in-memory",
      video: { codec: c.muxerCodec as "avc" | "hevc" | "vp9" | "av1", width, height, frameRate: fps },
    });
    return { muxer, buffer: () => target.buffer };
  }
  const target = new WebmTarget();
  const muxer = new WebmMuxer({ target, video: { codec: c.muxerCodec, width, height, frameRate: fps } });
  return { muxer, buffer: () => target.buffer };
}

async function encodeVideo(
  c: VideoCandidate,
  frames: ImageData[],
  delayMs: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  if (frames.length === 0) throw new Error("video export: no frames");
  const width = evenDim(frames[0].width);
  const height = evenDim(frames[0].height);
  if (width < 2 || height < 2) throw new Error("video export: frame too small");
  const fps = fpsFromDelay(delayMs);
  const frameDurUs = Math.round(1_000_000 / fps);

  // Frames are ImageData; VideoFrame takes a canvas, so blit each one through a
  // reusable canvas (also crops to the even dims).
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const cx = canvas.getContext("2d");
  if (!cx) throw new Error("video export: no 2d context");

  const { muxer, buffer } = createMuxer(c, width, height, fps);
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      failure = e;
    },
  });
  const config: VideoEncoderConfig = {
    codec: c.encoderCodec,
    width,
    height,
    framerate: fps,
    bitrate: bitrateFor(width, height, fps),
  };
  if (c.avc) config.avc = { format: "avc" };
  encoder.configure(config);

  for (let i = 0; i < frames.length && failure == null; i++) {
    cx.putImageData(frames[i], 0, 0);
    const frame = new VideoFrame(canvas, { timestamp: i * frameDurUs, duration: frameDurUs });
    // A keyframe ~once a second keeps the file seekable without bloating it.
    encoder.encode(frame, { keyFrame: i % fps === 0 });
    frame.close();
    onProgress?.(i + 1, frames.length);
    // Bound the encoder queue so a long clip doesn't hold every frame at once.
    while (encoder.encodeQueueSize > fps * 2 && failure == null) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  await encoder.flush();
  encoder.close();
  if (failure != null) throw failure instanceof Error ? failure : new Error(String(failure));
  muxer.finalize();
  return new Blob([buffer()], { type: c.mime });
}

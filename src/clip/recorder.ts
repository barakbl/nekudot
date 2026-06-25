import type { LayerManager } from "../layered/manager";

// A captured clip: downscaled, opaque RGBA frames plus the rate they were
// grabbed at. Speed + trim are applied later (preview/export) on these frames,
// which is why we keep them rather than a baked video.
export type Clip = {
  frames: ImageData[];
  width: number;
  height: number;
  captureFps: number;
};

// Caps keep memory + GIF size sane: a frame is width*height*4 bytes and we hold
// every frame in memory until Save. At 640px/12fps that's ~1MB/frame.
export const CAPTURE_FPS = 12;
export const MAX_DIM = 640;

// Duration cap is device-dependent: phones have far less RAM, so cap them low.
// Matches the app's mobile breakpoint (drag.ts / the bottom-sheet CSS), so it
// re-evaluates against the current viewport at record time.
//   mobile  5s  -> 60 frames  (~60MB)
//   desktop 15s -> 180 frames (~190MB)
export function maxSeconds(): number {
  return window.matchMedia("(max-width: 640px)").matches ? 5 : 15;
}

// Records the live canvas to an in-memory frame buffer. Each tick composites
// every layer (mirrors export.ts/flattenLayers: background, then layers by
// index at their opacity) straight into one small reusable canvas, then reads
// the pixels. GIF needs opaque frames, so a transparent paper falls back to
// white. Timer-driven and independent of the draw loop, so a heavy stroke just
// yields fewer effective frames rather than stalling.
export class ClipRecorder {
  private frames: ImageData[] = [];
  private ctx: CanvasRenderingContext2D | null = null;
  private timer: number | null = null;
  private w = 0;
  private h = 0;
  private maxFrames = 0;
  private recording = false;

  constructor(
    private manager: LayerManager,
    private getBackgroundColor: () => string,
    // Fired when the duration cap is hit so the owner can finalize (call stop()).
    private onAutoStop?: () => void,
    // Fired after each captured frame so the owner can update a REC indicator.
    private onFrame?: (count: number) => void,
  ) {}

  get isRecording(): boolean {
    return this.recording;
  }

  start(): void {
    if (this.recording) return;
    const size = this.manager.currentSize;
    const scale = Math.min(1, MAX_DIM / Math.max(size.width, size.height));
    this.w = Math.max(1, Math.round(size.width * scale));
    this.h = Math.max(1, Math.round(size.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = this.w;
    canvas.height = this.h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("clip recorder: no 2d context");
    this.ctx = ctx;
    this.frames = [];
    this.maxFrames = CAPTURE_FPS * maxSeconds();
    this.recording = true;
    this.capture(); // grab frame 0 immediately so a quick clip isn't empty
    this.timer = window.setInterval(() => this.capture(), Math.round(1000 / CAPTURE_FPS));
  }

  private capture(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const bg = this.getBackgroundColor();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = bg === "transparent" ? "#ffffff" : bg;
    ctx.fillRect(0, 0, this.w, this.h);
    for (const layer of this.manager.orderedLayers()) {
      ctx.globalAlpha = layer.config.opacity / 100;
      const src = layer.canvas;
      ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, this.w, this.h);
    }
    ctx.globalAlpha = 1;
    this.frames.push(ctx.getImageData(0, 0, this.w, this.h));
    this.onFrame?.(this.frames.length);
    if (this.frames.length >= this.maxFrames) {
      // Stop grabbing more but stay "recording" so stop() still hands back the
      // clip; the owner's onAutoStop finalizes.
      if (this.timer !== null) {
        clearInterval(this.timer);
        this.timer = null;
      }
      this.onAutoStop?.();
    }
  }

  // Stops capture and returns the clip (null if too short to edit). Safe to call
  // after an auto-stop (the timer may already be cleared).
  stop(): Clip | null {
    if (!this.recording) return null;
    this.recording = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const frames = this.frames;
    this.frames = [];
    this.ctx = null;
    if (frames.length < 2) return null;
    return { frames, width: this.w, height: this.h, captureFps: CAPTURE_FPS };
  }
}

import type { CanvasSize } from "../canvas-size";
import { downscaleToMaxDim } from "../export";
import { LogEventSchema, type LogEvent } from "../log/events";
import type { LayersConfig } from "../layered/schema";
import { BlobStore } from "../log/blobs";
import { replay } from "../replay/engine";
import { MemoryStore } from "../replay/bare-world";
import { createOffscreenReplayWorld, resolvePasteBitmaps } from "../replay/offscreen";
import { CAPTURE_FPS, MAX_DIM, maxSeconds, type Clip } from "./recorder";

// Process-video frame producer (vector-replay P3.1). Replays a recorded event log
// ONCE into a detached offscreen LayerManager and samples the build-up into the
// SAME opaque-RGBA, 640-clamped Clip the live ClipRecorder produces - so the whole
// clip/preview/gifenc back half is reused untouched. This is the first user-visible
// payoff: a whole-session process GIF, exercising replay on real artworks.
//
// One frame per stroke's `end` (the engine's frameSink), subsampled to a frame
// budget so RAM stays within the live recorder's ceiling. Playback is uniform at
// CAPTURE_FPS (the back half has no per-frame delay); real-time / idle-gap mapping
// is P3.2.

export type ReplayClipInput = {
  // Raw recorded rows (eventRecorder.drain()); validated here against the schema.
  events: readonly unknown[];
  size: CanvasSize; // the artwork's canvas size (init dims)
  layers: LayersConfig; // the artwork's layer config (init)
  dpr: number;
  background: () => string; // "transparent" (=> white fill) or a css colour
};

export async function produceReplayClip(input: ReplayClipInput): Promise<Clip | null> {
  if (typeof document === "undefined") return null; // browser-only (real canvas)
  const events = validate(input.events);
  const strokeCount = events.reduce((n, e) => n + (e.t === "begin" ? 1 : 0), 0);
  if (strokeCount < 1) return null; // nothing recorded -> caller falls back to the live recorder

  // Isolate writes: the offscreen LayerManager + SymmetryController persist to their
  // store, so seed a MemoryStore from localStorage (keeps symmetry/colour params)
  // rather than handing them the live store and clobbering the app's saved layers.
  const store = seedFromLocalStorage();
  // Pre-resolve pasted-image bitmaps (async) before the sync replay pass.
  const pasteBitmaps = events.some((e) => e.t === "paste")
    ? await resolvePasteBitmaps(events, new BlobStore())
    : undefined;
  const { world, manager } = createOffscreenReplayWorld({
    width: input.size.width,
    height: input.size.height,
    layers: input.layers,
    dpr: input.dpr,
    store,
    pasteBitmaps,
  });

  const { width, height } = downscaleToMaxDim(input.size, MAX_DIM, { clampToOne: true });
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const bg = input.background();
  // Composite exactly like ClipRecorder.capture: opaque bg (white if transparent),
  // then each layer at its opacity, scaled into the downscaled frame.
  const capture = (): ImageData => {
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = bg === "transparent" ? "#ffffff" : bg;
    ctx.fillRect(0, 0, width, height);
    for (const layer of manager.orderedLayers()) {
      ctx.globalAlpha = layer.config.opacity / 100;
      const src = layer.canvas;
      ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, width, height);
    }
    ctx.globalAlpha = 1;
    return ctx.getImageData(0, 0, width, height);
  };

  // Frame budget: match the live recorder's device-dependent RAM ceiling. Subsample
  // strokes when the session has more than the budget allows.
  const budget = Math.max(2, CAPTURE_FPS * maxSeconds());
  const stride = Math.max(1, Math.ceil(strokeCount / (budget - 1)));
  const frames: ImageData[] = [];
  frames.push(capture()); // frame 0: the blank starting state
  let endIndex = 0;
  replay(events, world, {
    frameSink: () => {
      if (endIndex % stride === 0) frames.push(capture());
      endIndex++;
    },
  });
  frames.push(capture()); // always end on the finished artwork

  if (frames.length < 2) return null;
  return { frames, width, height, captureFps: CAPTURE_FPS };
}

// Validate raw rows to LogEvent[] (drain() returns persisted + pending, trusted but
// typed unknown; mirror the log's own drop-invalid discipline).
function validate(rows: readonly unknown[]): LogEvent[] {
  const out: LogEvent[] = [];
  for (const r of rows) {
    const p = LogEventSchema.safeParse(r);
    if (p.success) out.push(p.data);
  }
  return out;
}

function seedFromLocalStorage(): MemoryStore {
  const store = new MemoryStore();
  if (typeof localStorage === "undefined") return store;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key == null) continue;
    const raw = localStorage.getItem(key);
    try {
      store.set(key, raw == null ? null : JSON.parse(raw));
    } catch {
      store.set(key, raw);
    }
  }
  return store;
}

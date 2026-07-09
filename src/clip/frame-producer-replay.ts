import type { CanvasSize } from "../canvas-size";
import { downscaleToMaxDim } from "../export";
import { LogEventSchema, type LogEvent } from "../log/events";
import type { LayersConfig } from "../layered/schema";
import { BlobStore } from "../log/blobs";
import { replay } from "../replay/engine";
import { MemoryStore } from "../replay/bare-world";
import { createOffscreenReplayWorld, resolvePasteBitmaps } from "../replay/offscreen";
import { collapsedActivityMs, planFrames } from "./replay-timeline";
import { CAPTURE_FPS, MAX_DIM, maxSeconds, type Clip } from "./recorder";

// Process-video frame producer (vector-replay P3.1 + P3.2). Replays a recorded event
// log ONCE into a detached offscreen LayerManager and samples the build-up into the
// SAME opaque-RGBA, 640-clamped Clip the live ClipRecorder produces - so the whole
// clip/preview/gifenc back half is reused untouched.
//
// One DISTINCT state per stroke's `end` (the engine's frameSink), subsampled to a
// frame budget so RAM stays within the live recorder's ceiling. P3.2 then maps those
// states onto output frames: idle gaps are collapsed and the activity is scaled to a
// target duration (a 20-min session -> a short timelapse, not mostly stillness). Held
// states share one ImageData, so RAM stays bounded by the state count, not the frame
// count. The back half plays frames uniformly at CAPTURE_FPS.

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
  const { world, manager, dispose } = createOffscreenReplayWorld({
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
  if (!ctx) {
    dispose();
    return null;
  }
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

  // Capture at uniform intervals of ACTIVE virtual time (idle gaps fire no samples,
  // so they're skipped), so a long stroke animates instead of popping in at its end.
  // Decimate (drop every other + double the interval) when we'd exceed the frame
  // budget, so RAM stays at the same ceiling as the old per-stroke capture.
  const budget = Math.max(2, CAPTURE_FPS * maxSeconds());
  const states: ImageData[] = [capture()]; // state 0: the blank starting state
  const stateTimes: number[] = [0];
  let intervalMs = 1000 / CAPTURE_FPS;
  let nextAt = intervalMs;
  const grab = (t: number): void => {
    states.push(capture());
    stateTimes.push(t);
    if (states.length >= budget) {
      let w = 1; // keep index 0 (the blank start); halve the rest
      for (let r = 1; r < states.length; r += 2, w++) {
        states[w] = states[r];
        stateTimes[w] = stateTimes[r];
      }
      states.length = w;
      stateTimes.length = w;
      intervalMs *= 2;
    }
  };
  replay(events, world, {
    onSample: (t) => {
      if (t >= nextAt) {
        grab(t); // grab() may double intervalMs, so read it AFTER
        nextAt = t + intervalMs;
      }
    },
    // Stroke end: a buffered (wet) stroke's marks only land here, so grabs miss them.
    frameSink: (t) => {
      if (stateTimes[stateTimes.length - 1] !== t) grab(t);
      nextAt = t + intervalMs;
    },
  });
  states.push(capture()); // the finished artwork
  stateTimes.push((stateTimes[stateTimes.length - 1] ?? 0) + 1);

  // P3.2: collapse idle gaps + scale the activity to a target duration. Short
  // sessions stay near real-time (idle removed); long ones cap at the budget length.
  const idleGapMs = 700;
  const activityMs = collapsedActivityMs(stateTimes, idleGapMs);
  const targetDurationMs = Math.min((budget / CAPTURE_FPS) * 1000, Math.max(1500, activityMs));
  const plan = planFrames(stateTimes, {
    idleGapMs,
    targetDurationMs,
    fps: CAPTURE_FPS,
    maxFrames: budget,
  });
  const frames = plan.map((i) => states[i]); // held states share one ImageData

  dispose(); // remove the off-screen replay container now the pixels are captured
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

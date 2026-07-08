import type { BrushBase } from "../base";
import type { CanvasSize } from "../canvas-size";
import type { LogEvent, StrokeContext } from "../log/events";
import { dequantizeCoord, dequantizeDt } from "../log/sample-codec";
import type { PaintHost } from "../paint-host";
import type { Store } from "../store/base";
import { hydrateBrush, synthPenQuantized } from "./stroke-context";

// The deterministic replayer (vector-replay P2.1): turns a recorded LogEvent
// stream back into brush calls by feeding the EXACT live draw funnel, headless.
// It reads only what the log carries - recorded web-sample flags (contract G4),
// logged timestamps reconstructed from the dt deltas (G5), and the virtual clock
// the recorded times imply for Spray/Wisp (G6, via FixedTimestep). No DOM, no
// wall clock, no rAF: those live reads are exactly the nondeterminism Phase 0
// eliminated. Because per-stroke seed (P0.2), colour/settings freeze (P0.4) and
// the fixed timestep (P0.5) make each stroke a pure function of its recorded
// context + samples, a whole-log replay is just a sequence of independent single-
// stroke drives - the same shape as tests/_replay-harness.ts, generalized from a
// scripted array to a decoded log.

// The symmetry surface the replayer drives (a thin slice of SymmetryController).
export interface ReplaySymmetry {
  beginStroke(x: number, y: number, size: CanvasSize): void;
  setMode(tool: string): void;
  setCenter(center: { x: number; y: number }): void;
  active(): boolean;
}

// The world a replay drives: the paint host brushes draw/deposit through, the
// store frozen colours ride through, a brush factory, plus the funnel-owned world
// state (size/alpha/erase/layer) and canvas/config ops. The funnel-owned setters
// are optional: a bare host reports fixed values, so the point-cloud gate omits
// them; the offscreen LayerManager world (P2.2) supplies them all.
export interface ReplayWorld {
  readonly host: PaintHost;
  readonly store: Store;
  createBrush(name: string): BrushBase;
  currentSize(): CanvasSize;
  readonly symmetry: ReplaySymmetry;
  setStrokeState?(state: {
    size: number;
    alpha: number;
    erase: boolean;
    strokeColor: string;
    layer: string;
  }): void;
  applyInit?(init: { width: number; height: number; layers: unknown }): void;
  applyConfig?(ev: Extract<LogEvent, { t: "config" }>): void;
  clearCanvas?(): void;
  // Wet-stroke buffer hooks (a continuous partial-alpha stroke composites at one
  // uniform alpha). The engine decides `buffered` the way the funnel does
  // (bufferedStroke && !symmetry.active()); a bare host has no buffer, so omits them.
  beginBuffer?(buffered: boolean): void;
  endBuffer?(buffered: boolean): void;
}

export interface ReplayOptions {
  // Stop after replaying this many events (a partial replay / scrub target).
  until?: number;
  // Called after each event with (eventsDone, eventsToReplay).
  onProgress?: (done: number, total: number) => void;
  // Per-stroke frame hook for the process-video clip pipeline (P3.1): fired after
  // each stroke's `end`, with the stroke's virtual-time (anchor-relative ms). The
  // producer captures the current offscreen artwork state; a natural build-up
  // boundary. (Finer per-frame timing / idle-gap collapse is P3.2.)
  frameSink?: (timeMs: number) => void;
}

// Drive `events` through `world`. Deterministic and synchronous. Unknown/absent
// event types and out-of-order fragments are skipped defensively (a loaded log is
// untrusted, mirroring decodeEventLog), so a truncated log replays what it can.
export function replay(
  events: readonly LogEvent[],
  world: ReplayWorld,
  opts: ReplayOptions = {},
): void {
  const total = Math.min(events.length, opts.until ?? events.length);
  let brush: BrushBase | null = null;
  let ctx: StrokeContext | null = null;
  let buffered = false; // whether the open stroke uses the wet buffer
  let time = 0; // absolute (anchor-relative) ms of the last fed sample

  for (let i = 0; i < total; i++) {
    const ev = events[i];
    switch (ev.t) {
      case "session":
        // Provenance only (schema/app/dpr). Replay renders at the current dpr
        // (contract G9), so nothing to apply.
        break;
      case "init":
        world.applyInit?.({ width: ev.width, height: ev.height, layers: ev.layers });
        break;
      case "begin": {
        const started = beginStroke(world, ev);
        brush = started.brush;
        buffered = started.buffered;
        ctx = ev.ctx;
        time = ev.time;
        break;
      }
      case "samples": {
        if (!brush || !ctx) break; // a batch with no open stroke: skip
        const pen = ctx.pen;
        for (let k = 0; k < ev.x.length; k++) {
          time += dequantizeDt(ev.dt[k]);
          brush.stroke(
            dequantizeCoord(ev.x[k]),
            dequantizeCoord(ev.y[k]),
            ev.web[k] === 1,
            synthPenQuantized(pen, ev.p[k]),
            time,
          );
        }
        break;
      }
      case "end":
        if (brush) {
          brush.strokeEnd();
          world.endBuffer?.(buffered); // composite the wet buffer (funnel order: after strokeEnd)
          opts.frameSink?.(time); // a completed-stroke frame boundary (P3.1)
        }
        brush = null;
        ctx = null;
        buffered = false;
        break;
      case "config":
        world.applyConfig?.(ev);
        break;
      case "clear":
        world.clearCanvas?.();
        break;
      case "paste":
      case "legacy":
        // Pixel-state ops: handled by a world that carries bitmaps; a no-op for
        // the point-cloud/bare-host gate. (config/paste taps are a P1.2 follow-up.)
        break;
    }
    opts.onProgress?.(i + 1, total);
  }
}

// Reproduce the live funnel's beginStroke (drawing-input.ts) minus rAF, the
// recorder tap, and touch deferral. Order matches the funnel exactly: symmetry
// latch → funnel-owned world state → brush hydrate (style/dials/seed) → freeze
// colours → strokeStart → first sample (the begin point is fed as sample 1, web
// true, just like the live path).
function beginStroke(
  world: ReplayWorld,
  ev: Extract<LogEvent, { t: "begin" }>,
): { brush: BrushBase; buffered: boolean } {
  const ctx = ev.ctx;
  const brush = world.createBrush(ctx.brush);
  const x = dequantizeCoord(ev.x);
  const y = dequantizeCoord(ev.y);
  const pen = synthPenQuantized(ctx.pen, ev.p);

  world.symmetry.setMode(ctx.symmetry.tool ?? "none");
  world.symmetry.setCenter({
    x: numOr(ctx.symmetry.params.centerX, 0.5),
    y: numOr(ctx.symmetry.params.centerY, 0.5),
  });
  world.setStrokeState?.({
    size: ctx.size,
    alpha: ctx.alpha,
    erase: ctx.erase,
    strokeColor: ctx.color.main,
    layer: ctx.layer,
  });
  world.symmetry.beginStroke(x, y, world.currentSize());
  hydrateBrush(brush, ctx, world.store); // seed + style + dials + store colours (before bufferedStroke reads the dials)
  const buffered = brush.bufferedStroke(pen) && !world.symmetry.active();
  brush.captureStrokeContext(); // freeze the colours just written to the store
  world.beginBuffer?.(buffered); // open the wet buffer, funnel order (before strokeStart)
  brush.strokeStart(x, y);
  brush.stroke(x, y, true, pen, ev.time);
  return { brush, buffered };
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

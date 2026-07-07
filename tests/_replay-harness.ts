// Replay-equivalence determinism harness (vector-replay roadmap P0.1). Not a test
// file itself (underscore prefix keeps vitest from collecting it) - the shared
// machinery that tests/replay-determinism.test.ts drives.
//
// A brush is "replay-safe" iff its output (the marks it draws + the points it
// deposits) is a pure function of the RECORDED event stream: the stroke samples
// (x, y, pressure, tilt, timestamp) plus a per-stroke seed. Anything a brush reads
// that a replay would NOT have recorded - the wall clock, the display's frame
// cadence - makes it non-replayable.
//
// We measure that with two properties, each recording the geometry calls a brush
// makes against a bare host (createBareHost) and comparing the logs:
//   Property A (pinned determinism): same events + seed + ENVIRONMENT, twice ->
//     must be byte-identical. Every brush has to pass; a failure means raw
//     nondeterminism (an unseeded Math.random in the draw path).
//   Property B (replay-safety): same events + seed, but a PERTURBED environment
//     (different wall clock + rAF cadence). Passes iff the output ignores the
//     perturbation. The frame-driven / clock-reading brushes fail B today.
//
// The transient overlays a brush may animate (Invisible's glow) are NOT part of
// the artwork and are deliberately not recorded - the harness hands those a noop
// renderer, so only permanent marks + deposits count.

import type { BrushBase } from "../src/base";
import { BRUSH_DEFS, type BrushContext } from "../src/brushes/registry";
import { createBareHost, GEOMETRY_METHODS, type PaintHost } from "../src/paint-host";
import { connectionGroups } from "../src/brushes/connections/registry";
import { MOUSE_SAMPLE } from "../src/pen";
import type { IRenderer } from "../src/renderer";
import type { NeighborFinder, Pixel } from "../src/neighbor-finder";
import type { Store } from "../src/store/base";

const SEED = 0x9e3779b9;

// A fixed scripted stroke - the "recorded events". A curving 24-sample path over
// ~140px so connecting brushes actually weave a web (points fall within reach),
// with a recorded timestamp per sample (what a replay would store).
export const EVENTS = Array.from({ length: 24 }, (_, i) => ({
  x: 60 + i * 6 + 10 * Math.sin(i * 0.7),
  y: 60 + 12 * Math.cos(i * 0.9) + (i % 5) * 3,
  time: 1000 + i * 16,
}));

// An environment the harness controls: the wall clock (performance.now / Date.now)
// and the requestAnimationFrame cadence (how many frames elapse per input sample).
// The recorded `time` above is separate - it is passed to stroke() as data, so a
// brush that reads it (correct) is unaffected while one that reads the wall clock
// (Shapes) or counts frames (Spray/Wisp) diverges when these differ.
export type EnvSpec = {
  cadence: number; // rAF frames pumped per input sample
  clock0: number; // wall clock at strokeStart
  clockPerSample: number; // wall clock advance between samples
  clockPerFrame: number; // wall clock advance per pumped frame
};
export const ENV_A: EnvSpec = { cadence: 1, clock0: 1000, clockPerSample: 16, clockPerFrame: 16 };
export const ENV_B: EnvSpec = { cadence: 4, clock0: 777_000, clockPerSample: 53, clockPerFrame: 37 };

const GEOM = new Set<string>(GEOMETRY_METHODS);

function noopRenderer(): IRenderer {
  return new Proxy({}, { get: () => () => {} }) as unknown as IRenderer;
}

// A deterministic in-memory neighbor finder (ids assigned in deposit order, plain
// distance filter) - matches the existing longfur/chroma test finders.
function makeFinder(): NeighborFinder {
  const p: Pixel[] = [];
  let n = 0;
  return {
    addPixel(x, y) {
      const q = { id: n++, x, y };
      p.push(q);
      return q;
    },
    findNeighbors(px, r) {
      return p.filter((z) => z.id !== px.id && Math.hypot(z.x - px.x, z.y - px.y) <= r);
    },
    allPixels: () => [...p],
    pixelCount: () => n,
    livePixelCount: () => p.length,
    clear() {
      p.length = 0;
    },
  };
}

// A bare host that logs every geometry call (draws + deposits, per GEOMETRY_METHODS)
// as a signature string, then delegates so neighbor queries still see real points.
function recordingHost(): { host: PaintHost; log: string[] } {
  const base = createBareHost(noopRenderer(), makeFinder()) as Record<string, unknown>;
  const log: string[] = [];
  const host = new Proxy(base, {
    get(target, key, recv) {
      if (typeof key === "string" && GEOM.has(key)) {
        const orig = base[key] as (...a: unknown[]) => unknown;
        return (...args: unknown[]) => {
          log.push(key + "|" + JSON.stringify(args));
          return orig(...args);
        };
      }
      return Reflect.get(target, key, recv);
    },
  });
  return { host: host as unknown as PaintHost, log };
}

// Install the controllable clock + rAF for the duration of one recording, and
// restore the originals after (whatever the driving does).
function withEnv<T>(spec: EnvSpec, run: (clk: Clock) => T): T {
  const clk = makeClock(spec);
  const g = globalThis as unknown as {
    requestAnimationFrame?: unknown;
    cancelAnimationFrame?: unknown;
  };
  const saved = {
    raf: g.requestAnimationFrame,
    caf: g.cancelAnimationFrame,
    now: performance.now,
    dnow: Date.now,
  };
  g.requestAnimationFrame = clk.raf;
  g.cancelAnimationFrame = clk.caf;
  performance.now = clk.now;
  Date.now = clk.now;
  try {
    return run(clk);
  } finally {
    g.requestAnimationFrame = saved.raf;
    g.cancelAnimationFrame = saved.caf;
    performance.now = saved.now;
    Date.now = saved.dnow;
  }
}

type Clock = {
  raf: (cb: FrameRequestCallback) => number;
  caf: (id: number) => void;
  now: () => number;
  advanceSample: () => void;
  pump: () => void; // run `cadence` frames worth of queued rAF callbacks
};

function makeClock(spec: EnvSpec): Clock {
  let clock = spec.clock0;
  let queue: Array<[number, FrameRequestCallback]> = [];
  let nextId = 1;
  const cancelled = new Set<number>();
  return {
    raf: (cb) => {
      const id = nextId++;
      queue.push([id, cb]);
      return id;
    },
    caf: (id) => {
      cancelled.add(id);
    },
    now: () => clock,
    advanceSample: () => {
      clock += spec.clockPerSample;
    },
    pump: () => {
      for (let f = 0; f < spec.cadence; f++) {
        const batch = queue;
        queue = [];
        for (const [id, cb] of batch) {
          if (cancelled.has(id)) continue;
          clock += spec.clockPerFrame;
          cb(clock);
        }
      }
    },
  };
}

// Record one brush x style run under one environment; returns the ordered geometry log.
export function recordCase(brushName: string, style: string | undefined, spec: EnvSpec): string[] {
  const def = BRUSH_DEFS.find((d) => d.name === brushName);
  if (!def) throw new Error(`unknown brush: ${brushName}`);
  const { host, log } = recordingHost();
  const ctx: BrushContext = {
    host,
    store: undefined as unknown as Store, // brushes read via this.store?.- undefined-safe
    getInvisibleOverlay: () => noopRenderer(), // transient glow, never recorded
  };
  const brush = def.create(ctx);
  if (style) brush.selectArtStyle(style);
  brush.setSeed(SEED); // fixed per-stroke seed (the P0.2 mechanism, exercised here)
  brush.captureStrokeContext(); // freeze the (empty here) colour context (P0.4)

  return withEnv(spec, (clk) => {
    brush.strokeStart(EVENTS[0].x, EVENTS[0].y);
    clk.pump();
    for (let i = 1; i < EVENTS.length; i++) {
      clk.advanceSample();
      brush.stroke(EVENTS[i].x, EVENTS[i].y, true, MOUSE_SAMPLE, EVENTS[i].time);
      clk.pump();
    }
    brush.strokeEnd();
    clk.pump();
    return log;
  });
}

// vector-replay P0.4 support. Record a case against a LIVE colour store, optionally
// flipping the toolbar colour right after the first sample. captureStrokeContext
// freezes the colour at the stroke's start, so a mid-stroke flip must NOT change
// the recorded geometry - that invariance is the P0.4 acceptance. `flipTo` omitted =
// a constant store (the reference run). Colours ride the recorded draw args (line /
// fill colour), so a brush reading them live would diverge on the flip.
export type ColorPair = { main: string; secondary: string };
function colorStore(initial: ColorPair): { store: Store; set: (c: ColorPair) => void } {
  let cur = initial;
  const store = {
    get: (k: string) =>
      k === "app.color.main" ? cur.main : k === "app.color.secondary" ? cur.secondary : undefined,
    set: () => {},
  } as unknown as Store;
  return { store, set: (c) => (cur = c) };
}
export function recordCaseColor(
  brushName: string,
  style: string | undefined,
  opts: { color: ColorPair; flipTo?: ColorPair; configure?: (brush: BrushBase) => void },
): string[] {
  const def = BRUSH_DEFS.find((d) => d.name === brushName);
  if (!def) throw new Error(`unknown brush: ${brushName}`);
  const { host, log } = recordingHost();
  const { store, set } = colorStore(opts.color);
  const brush = def.create({ host, store, getInvisibleOverlay: () => noopRenderer() });
  if (style) brush.selectArtStyle(style);
  opts.configure?.(brush); // e.g. pick a primary-driven colour source
  brush.setSeed(SEED);
  brush.captureStrokeContext(); // freezes opts.color
  return withEnv(ENV_A, (clk) => {
    brush.strokeStart(EVENTS[0].x, EVENTS[0].y);
    clk.pump();
    if (opts.flipTo) set(opts.flipTo); // mutate the store mid-stroke; must be ignored
    for (let i = 1; i < EVENTS.length; i++) {
      clk.advanceSample();
      brush.stroke(EVENTS[i].x, EVENTS[i].y, true, MOUSE_SAMPLE, EVENTS[i].time);
      clk.pump();
    }
    brush.strokeEnd();
    clk.pump();
    return log;
  });
}

// vector-replay P0.2 support. Draw two strokes on one brush + host, returning
// only the SECOND stroke's geometry. Stroke 1 is identical across every call, so
// the cloud + deposit ids stroke 2 sees are identical too - isolating the one
// variable probed here: the RNG position at stroke 2's start. `preSeed` moves the
// RNG between the strokes (a stand-in for prior strokes drawing a different count);
// `reseed` applies the per-stroke boundary seed the live funnel now sets. With the
// reseed, preSeed can't change the output; without it, an RNG-using style leaks it.
const FIRST_STROKE_SEED = 0x12345678;
export function recordSecondStroke(
  brushName: string,
  style: string | undefined,
  opts: { preSeed?: number; reseed: boolean },
): string[] {
  const def = BRUSH_DEFS.find((d) => d.name === brushName);
  if (!def) throw new Error(`unknown brush: ${brushName}`);
  const { host, log } = recordingHost();
  const ctx: BrushContext = {
    host,
    store: undefined as unknown as Store,
    getInvisibleOverlay: () => noopRenderer(),
  };
  const brush = def.create(ctx);
  if (style) brush.selectArtStyle(style);
  const play = (): void => {
    brush.captureStrokeContext(); // per-stroke colour latch (no-op with empty store)
    brush.strokeStart(EVENTS[0].x, EVENTS[0].y);
    for (let i = 1; i < EVENTS.length; i++) {
      brush.stroke(EVENTS[i].x, EVENTS[i].y, true, MOUSE_SAMPLE, EVENTS[i].time);
    }
    brush.strokeEnd();
  };
  brush.setSeed(FIRST_STROKE_SEED); // stroke 1: identical every call
  play();
  const mark = log.length; // keep the cloud; measure only stroke 2
  if (opts.preSeed !== undefined) brush.setSeed(opts.preSeed);
  if (opts.reseed) brush.setSeed(SEED);
  play(); // stroke 2
  return log.slice(mark);
}

const eq = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export type Case = { id: string; brush: string; style?: string };

// The matrix: the Round brush across every built-in connection style, plus every
// other brush once. (Round is the only style-bearing brush; the connection styles
// Fur/LongFur/Chroma/Glow/... run under it.)
export function buildCases(): Case[] {
  const styles = connectionGroups().flatMap((g) => (g.group === "Custom" ? [] : g.defs.map((d) => d.name)));
  const cases: Case[] = styles.map((s) => ({ id: `Round / ${s}`, brush: "Round", style: s }));
  for (const b of ["Shapes", "Spray", "Wisp", "Marker", "Color Pen", "Invisible", "Eraser"]) {
    cases.push({ id: b, brush: b });
  }
  return cases;
}

export type CaseResult = { propA: boolean; propB: boolean; size: number };

// propA: identical env, twice -> identical. propB: env A vs env B -> identical.
export function runCase(c: Case): CaseResult {
  const a1 = recordCase(c.brush, c.style, ENV_A);
  const a2 = recordCase(c.brush, c.style, ENV_A);
  const b1 = recordCase(c.brush, c.style, ENV_B);
  return { propA: eq(a1, a2), propB: eq(a1, b1), size: a1.length };
}

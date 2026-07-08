import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildCases } from "./_replay-harness";
import { EventRecorder } from "../src/log/recorder";
import type { EventLogBackend } from "../src/log/store";
import type { LogEvent, StrokeContext } from "../src/log/events";
import { createBareHost, GEOMETRY_METHODS, type PaintHost } from "../src/paint-host";
import { BRUSH_DEFS } from "../src/brushes/registry";
import { MOUSE_SAMPLE } from "../src/pen";
import { replay } from "../src/replay/engine";
import {
  createBareReplayWorld,
  createMemoryFinder,
  MemoryStore,
  noopRenderer,
} from "../src/replay/bare-world";
import type { BrushBase } from "../src/base";
import type { Store } from "../src/store/base";

// P2.1 KILL-gate acceptance: bare-host equivalence for unit event streams. For
// every brush/style, driving a stroke DIRECTLY and replaying its recorded
// LogEvent stream through the engine must produce byte-identical geometry (draw +
// deposit calls). Generalizes the Phase-0 single-stroke determinism harness from a
// scripted array to a decoded log: if hydration, event ordering, dt->time
// reconstruction, seed, style, or web flags are wrong, the two logs diverge.

const SEED = 0x9e3779b9;
const MAIN = "#e11d48";
const SECONDARY = "#22d3ee";
const LAYER = "L1";

// A curving 24-sample stroke on INTEGER coords + integer-ms times (0-based), so the
// recorder's source quantization round-trips losslessly - the equivalence is about
// the replayer, not quantization.
const STIMULUS = Array.from({ length: 24 }, (_, i) => ({
  x: Math.round(60 + i * 6 + 10 * Math.sin(i * 0.7)),
  y: Math.round(60 + 12 * Math.cos(i * 0.9) + (i % 5) * 3),
  t: i * 16,
}));

const GEOM = new Set<string>(GEOMETRY_METHODS);

// Transient overlay animations (Invisible's glow) schedule via requestAnimationFrame,
// which the node test env lacks. The glow is NOT recorded and goes to a throwaway
// overlay, so a non-firing stub keeps it inert and identical on both drive + replay.
const g = globalThis as unknown as {
  requestAnimationFrame?: (cb: (t: number) => void) => number;
  cancelAnimationFrame?: (id: number) => void;
};
let savedRaf: typeof g.requestAnimationFrame;
let savedCaf: typeof g.cancelAnimationFrame;
beforeAll(() => {
  savedRaf = g.requestAnimationFrame;
  savedCaf = g.cancelAnimationFrame;
  g.requestAnimationFrame = () => 0;
  g.cancelAnimationFrame = () => {};
});
afterAll(() => {
  g.requestAnimationFrame = savedRaf;
  g.cancelAnimationFrame = savedCaf;
});

// A bare host that logs every geometry call as a signature string then delegates,
// so neighbour queries still see the real deposited cloud (the Phase-0 pattern).
function recordingHost(): { host: PaintHost; log: string[] } {
  const base = createBareHost(noopRenderer(), createMemoryFinder()) as Record<string, unknown>;
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

function fakeStore(): EventLogBackend {
  const rows: unknown[] = [];
  return {
    append: async (r) => {
      rows.push(...r);
    },
    load: async () => [...rows],
    count: async () => rows.length,
    clear: async () => {
      rows.length = 0;
    },
    replaceAll: async (r) => {
      rows.length = 0;
      rows.push(...r);
    },
  };
}

// The StrokeContext the funnel assembles (brush snapshot + funnel-owned fields).
function assembleCtx(brush: BrushBase): StrokeContext {
  const snap = brush.strokeSnapshot();
  return {
    brush: snap.brush,
    seed: snap.seed,
    layer: LAYER,
    color: snap.color,
    size: 24,
    alpha: 1,
    erase: snap.erase,
    style: snap.style,
    settings: snap.settings,
    symmetry: { tool: null, params: { centerX: 0.5, centerY: 0.5 } },
    pen: false,
  };
}

// Drive one stroke directly (mirroring the live funnel: setSeed -> captureContext
// -> strokeStart -> stroke*) while tapping the real recorder; return the direct
// geometry log AND the recorded event stream.
async function driveAndRecord(
  brushName: string,
  style: string | undefined,
): Promise<{ log: string[]; events: LogEvent[] }> {
  const { host, log } = recordingHost();
  const store: Store = new MemoryStore();
  store.set("app.color.main", MAIN);
  store.set("app.color.secondary", SECONDARY);
  const def = BRUSH_DEFS.find((d) => d.name === brushName);
  if (!def) throw new Error(`unknown brush ${brushName}`);
  const brush = def.create({ host, store, getInvisibleOverlay: () => noopRenderer() });
  if (style) brush.applyArtStylePreset(style);
  const rec = new EventRecorder({
    store: fakeStore(),
    appVersion: "test",
    dpr: () => 1,
    artworkInit: () => null,
  });
  rec.setEnabled(true);

  const s0 = STIMULUS[0];
  brush.setSeed(SEED);
  brush.captureStrokeContext();
  brush.strokeStart(s0.x, s0.y);
  brush.stroke(s0.x, s0.y, true, MOUSE_SAMPLE, s0.t);
  rec.strokeBegin(assembleCtx(brush), { x: s0.x, y: s0.y, pressure: 1, time: s0.t });
  for (let i = 1; i < STIMULUS.length; i++) {
    const s = STIMULUS[i];
    brush.stroke(s.x, s.y, true, MOUSE_SAMPLE, s.t);
    rec.strokeSample(s.x, s.y, 1, s.t, true);
  }
  brush.strokeEnd();
  rec.strokeEnd();
  const events = (await rec.drain()) as LogEvent[];
  return { log, events };
}

describe("replay equivalence (vector-replay P2.1)", () => {
  for (const c of buildCases()) {
    it(`replays ${c.id} identically to a direct drive`, async () => {
      const { log: direct, events } = await driveAndRecord(c.brush, c.style);
      expect(direct.length).toBeGreaterThan(0); // the direct drive did something

      const { host, log: replayed } = recordingHost();
      replay(events, createBareReplayWorld({ host, store: new MemoryStore() }));
      expect(replayed).toEqual(direct);
    });
  }
});

// Drive one stroke (fresh brush) against a SHARED host/store/recorder, so a
// multi-stroke session accumulates one point cloud across strokes - exactly how
// the engine replays (a fresh brush per `begin`, one host).
function driveStrokeInto(
  host: PaintHost,
  store: Store,
  rec: EventRecorder,
  brushName: string,
  style: string | undefined,
  samples: { x: number; y: number; t: number }[],
  seed: number,
): void {
  const def = BRUSH_DEFS.find((d) => d.name === brushName);
  if (!def) throw new Error(`unknown brush ${brushName}`);
  const brush = def.create({ host, store, getInvisibleOverlay: () => noopRenderer() });
  if (style) brush.applyArtStylePreset(style);
  const s0 = samples[0];
  brush.setSeed(seed);
  brush.captureStrokeContext();
  brush.strokeStart(s0.x, s0.y);
  brush.stroke(s0.x, s0.y, true, MOUSE_SAMPLE, s0.t);
  rec.strokeBegin(assembleCtx(brush), { x: s0.x, y: s0.y, pressure: 1, time: s0.t });
  for (let i = 1; i < samples.length; i++) {
    brush.stroke(samples[i].x, samples[i].y, true, MOUSE_SAMPLE, samples[i].t);
    rec.strokeSample(samples[i].x, samples[i].y, 1, samples[i].t, true);
  }
  brush.strokeEnd();
  rec.strokeEnd();
}

const shift = (dx: number, dy: number, baseT: number) =>
  STIMULUS.map((s) => ({ x: s.x + dx, y: s.y + dy, t: s.t + baseT }));

describe("replay session (vector-replay P2.1)", () => {
  it("replays a multi-stroke, multi-brush session headlessly, identical to a direct drive", async () => {
    // Round/shaded → Marker → Round/fur: different brushes AND styles, one session,
    // overlapping so later strokes weave against earlier deposits. Times are one
    // increasing sequence from 0 so anchor-relative == absolute.
    const strokes = [
      { brush: "Round", style: "shaded" as string | undefined, samples: shift(0, 0, 0) },
      { brush: "Marker", style: undefined as string | undefined, samples: shift(30, 40, 400) },
      { brush: "Round", style: "fur" as string | undefined, samples: shift(-20, 25, 800) },
    ];

    const { host: hd, log: direct } = recordingHost();
    const sd = new MemoryStore();
    sd.set("app.color.main", MAIN);
    sd.set("app.color.secondary", SECONDARY);
    const rec = new EventRecorder({
      store: fakeStore(),
      appVersion: "test",
      dpr: () => 1,
      artworkInit: () => null,
    });
    rec.setEnabled(true);
    let seed = SEED;
    for (const st of strokes) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; // an independent per-stroke seed
      driveStrokeInto(hd, sd, rec, st.brush, st.style, st.samples, seed);
    }
    const events = (await rec.drain()) as LogEvent[];
    expect(events.filter((e) => e.t === "begin")).toHaveLength(3);
    expect(events.filter((e) => e.t === "end")).toHaveLength(3);

    const { host: hr, log: replayed } = recordingHost();
    replay(events, createBareReplayWorld({ host: hr, store: new MemoryStore() }));
    expect(replayed).toEqual(direct);
    expect(replayed.length).toBeGreaterThan(0);
  });
});

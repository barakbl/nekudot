import { describe, it, expect } from "vitest";
import { EventRecorder } from "../src/log/recorder";
import type { EventLogBackend } from "../src/log/store";
import {
  decodeEventLog,
  StrokeContextSchema,
  type LogEvent,
  type StrokeContext,
} from "../src/log/events";
import { BRUSH_DEFS, type BrushContext } from "../src/brushes/registry";
import { createBareHost } from "../src/paint-host";
import type { IRenderer } from "../src/renderer";
import type { NeighborFinder } from "../src/neighbor-finder";
import type { Store } from "../src/store/base";

// P1.2 acceptance: a recorded real session round-trips through the P1.1 schema, and
// the flag off does zero recording work.

const layers = {
  maxLayers: 10,
  activeIndex: 0,
  layers: [{ id: "L1", index: 0, name: "Layer 1", types: ["normal"], opacity: 100 }],
  neighborsMaps: [{ id: "M1", name: "Map 1", opacity: 100 }],
  selectedNeighborsMapIndex: 0,
  background: { color: "#0d0e12", transparent: false },
};

const ctx: StrokeContext = {
  brush: "Round",
  seed: 0x1234abcd,
  layer: "L1",
  color: { main: "#e11d48", secondary: "#22d3ee" },
  size: 24,
  alpha: 0.8,
  erase: false,
  settings: { density: 40, color: "web" },
  symmetry: { tool: null, params: { centerX: 0.5, centerY: 0.5 } },
  pen: false,
};

function fakeStore(): EventLogBackend & { rows: unknown[] } {
  const rows: unknown[] = [];
  return {
    rows,
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

function makeRecorder(store: EventLogBackend | null) {
  return new EventRecorder({
    store,
    appVersion: "0.41.1",
    dpr: () => 2,
    artworkInit: () => ({ width: 800, height: 600, layers }),
  });
}

// Drive one stroke: a StrokeBegin then `samples` move samples 8 ms apart.
function stroke(rec: EventRecorder, samples: number, t0 = 1_000_000): void {
  rec.strokeBegin(ctx, { x: 480.0625, y: 512.3, pressure: 0.7, time: t0 });
  for (let i = 1; i <= samples; i++) {
    rec.strokeSample(480 + i, 512 + i * 0.5, 0.6, t0 + i * 8, i % 2 === 0);
  }
  rec.strokeEnd();
}

describe("event recorder (vector-replay P1.2)", () => {
  it("a recorded session round-trips through the schema", async () => {
    const store = fakeStore();
    const rec = makeRecorder(store);
    rec.setEnabled(true);
    stroke(rec, 10);
    const events = (await rec.drain()) as LogEvent[];

    // Every recorded event validates + survives a JSONL round-trip unchanged.
    const jsonl = events.map((e) => JSON.stringify(e)).join("\n");
    const decoded = decodeEventLog(jsonl);
    expect(decoded).toEqual(events);
    // The expected shape: session, init, begin, samples..., end.
    expect(events[0].t).toBe("session");
    expect(events[1].t).toBe("init");
    expect(events.map((e) => e.t)).toContain("begin");
    expect(events.map((e) => e.t)).toContain("end");
  });

  it("emits SessionStart + ArtworkInit exactly once across strokes", async () => {
    const rec = makeRecorder(fakeStore());
    rec.setEnabled(true);
    stroke(rec, 3);
    stroke(rec, 3);
    const events = (await rec.drain()) as LogEvent[];
    expect(events.filter((e) => e.t === "session")).toHaveLength(1);
    expect(events.filter((e) => e.t === "init")).toHaveLength(1);
    expect(events.filter((e) => e.t === "begin")).toHaveLength(2);
  });

  it("batches samples into 64-long StrokeSamples events", async () => {
    const rec = makeRecorder(fakeStore());
    rec.setEnabled(true);
    stroke(rec, 130); // 130 move samples -> 64 + 64 + 2
    const events = (await rec.drain()) as LogEvent[];
    const batches = events.filter((e) => e.t === "samples") as Extract<LogEvent, { t: "samples" }>[];
    expect(batches.map((b) => b.x.length)).toEqual([64, 64, 2]);
    expect(batches.reduce((n, b) => n + b.x.length, 0)).toBe(130);
  });

  it("records the web-sample flag as given (never re-derived)", async () => {
    const rec = makeRecorder(fakeStore());
    rec.setEnabled(true);
    stroke(rec, 4); // web flags: i%2==0 -> 0,1,0,1 for i=1..4
    const events = (await rec.drain()) as LogEvent[];
    const batch = events.find((e) => e.t === "samples") as Extract<LogEvent, { t: "samples" }>;
    expect(batch.web).toEqual([0, 1, 0, 1]);
  });

  it("does zero work when disabled (flag off)", async () => {
    const store = fakeStore();
    const rec = makeRecorder(store);
    // never setEnabled(true)
    stroke(rec, 20);
    await rec.flush();
    expect(store.rows).toHaveLength(0);
    expect((await rec.drain()).length).toBe(0);
  });

  it("a real brush's strokeSnapshot assembles a schema-valid StrokeContext", () => {
    // The recorder tests above hand-build the context; this proves the REAL brush
    // seam (BrushBase.strokeSnapshot + the funnel's fields) matches the schema.
    const noop = () => new Proxy({}, { get: () => () => {} }) as unknown as IRenderer;
    const pts: { id: number; x: number; y: number }[] = [];
    let n = 0;
    const finder = {
      addPixel: (x: number, y: number) => {
        const p = { id: n++, x, y };
        pts.push(p);
        return p;
      },
      findNeighbors: () => [],
      allPixels: () => [...pts],
      pixelCount: () => n,
      livePixelCount: () => pts.length,
      clear: () => {
        pts.length = 0;
      },
    } as unknown as NeighborFinder;
    const def = BRUSH_DEFS.find((d) => d.name === "Round")!;
    const brush = def.create({
      host: createBareHost(noop(), finder),
      store: undefined as unknown as Store,
      getInvisibleOverlay: () => noop(),
    } as BrushContext);
    brush.selectArtStyle("web");
    brush.setSeed(0x1234abcd);
    brush.captureStrokeContext();
    const snap = brush.strokeSnapshot();
    const assembled = {
      ...snap,
      layer: "L1",
      size: 24,
      alpha: 0.8,
      symmetry: { tool: null, params: { centerX: 0.5, centerY: 0.5 } },
      pen: false,
    };
    expect(StrokeContextSchema.safeParse(assembled).success).toBe(true);
  });

  it("survives a storeless recorder (no IDB): buffers in memory, never throws", async () => {
    const rec = makeRecorder(null);
    rec.setEnabled(true);
    expect(() => stroke(rec, 5)).not.toThrow();
    // Nothing can persist without a store, but the events stay buffered (and valid).
    const events = (await rec.drain()) as LogEvent[];
    expect(events.length).toBeGreaterThan(0);
    expect(decodeEventLog(events.map((e) => JSON.stringify(e)).join("\n"))).toEqual(events);
  });
});

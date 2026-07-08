import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { RecorderTelemetry } from "../src/log/telemetry";
import { EventRecorder } from "../src/log/recorder";
import { EventLogStore, type EventLogBackend } from "../src/log/store";
import type { StrokeContext } from "../src/log/events";

// P1.3 acceptance: the three Gate 1 numbers are measured correctly - pointermove
// tap p95, log byte rate (bytes/stroke + bytes/min), and flush stalls > 8 ms.

describe("RecorderTelemetry (vector-replay P1.3)", () => {
  it("an untouched snapshot is all zeros (no NaN / divide-by-zero)", () => {
    const s = new RecorderTelemetry().snapshot();
    expect(s).toMatchObject({
      strokes: 0,
      samples: 0,
      pointermoveP95Ms: 0,
      totalBytes: 0,
      bytesPerStroke: 0,
      bytesPerMinute: 0,
      flushes: 0,
      flushStalls: 0,
      maxFlushMs: 0,
      elapsedMs: 0,
    });
  });

  it("p95 is the nearest-rank 95th percentile of the tap window", () => {
    const t = new RecorderTelemetry();
    for (let i = 1; i <= 100; i++) t.sample(i); // 1..100 ms
    expect(t.snapshot().pointermoveP95Ms).toBe(95);
    expect(t.snapshot().samples).toBe(100);
  });

  it("bytes/stroke and bytes/min use the injected clock", () => {
    let now = 0;
    const t = new RecorderTelemetry(() => now);
    t.strokeBegan(); // first activity anchors startMs at now=0
    t.strokeBegan();
    t.addBytes(1200); // one flush
    t.addBytes(600);
    now = 60_000; // one minute elapses
    const s = t.snapshot();
    expect(s.strokes).toBe(2);
    expect(s.totalBytes).toBe(1800);
    expect(s.bytesPerStroke).toBe(900);
    expect(s.bytesPerMinute).toBeCloseTo(1800, 5); // 1800 bytes over 1 min
    expect(s.flushes).toBe(2);
    expect(s.elapsedMs).toBe(60_000);
  });

  it("counts only flushes whose sync cost exceeds 8 ms, and tracks the max", () => {
    const t = new RecorderTelemetry();
    t.flushCost(2);
    t.flushCost(8); // exactly 8 is NOT a stall (must exceed)
    t.flushCost(12.5);
    t.flushCost(9);
    const s = t.snapshot();
    expect(s.flushStalls).toBe(2); // 12.5 and 9
    expect(s.maxFlushMs).toBe(12.5);
  });

  it("reset clears everything back to the empty snapshot", () => {
    const t = new RecorderTelemetry();
    t.strokeBegan();
    t.sample(5);
    t.addBytes(100);
    t.flushCost(20);
    t.reset();
    expect(t.snapshot()).toMatchObject({ strokes: 0, samples: 0, totalBytes: 0, flushStalls: 0, maxFlushMs: 0 });
  });
});

// --- recorder wiring: a real stroke feeds the telemetry ----------------------

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

describe("EventRecorder telemetry wiring (P1.3)", () => {
  it("a recorded stroke populates strokes, samples and byte counts", async () => {
    const telemetry = new RecorderTelemetry();
    const rec = new EventRecorder({
      store: fakeStore(),
      appVersion: "0.42.0",
      dpr: () => 2,
      artworkInit: () => ({ width: 800, height: 600, layers }),
      telemetry,
    });
    rec.setEnabled(true);
    rec.strokeBegin(ctx, { x: 480, y: 512, pressure: 0.7, time: 1_000_000 });
    for (let i = 1; i <= 10; i++) rec.strokeSample(480 + i, 512 + i, 0.6, 1_000_000 + i * 8, i % 2 === 0);
    rec.strokeEnd();
    await rec.drain(); // let the strokeEnd flush() land through the chain

    const s = telemetry.snapshot();
    expect(s.strokes).toBe(1);
    expect(s.samples).toBe(10);
    expect(s.totalBytes).toBeGreaterThan(0);
    expect(s.flushes).toBeGreaterThan(0);
    expect(Number.isFinite(s.pointermoveP95Ms)).toBe(true);
    expect(s.pointermoveP95Ms).toBeGreaterThanOrEqual(0);
  });

  it("does not feed telemetry while recording is off", async () => {
    const telemetry = new RecorderTelemetry();
    const rec = new EventRecorder({
      store: fakeStore(),
      appVersion: "0.42.0",
      dpr: () => 2,
      artworkInit: () => ({ width: 800, height: 600, layers }),
      telemetry,
    });
    // never setEnabled(true)
    rec.strokeBegin(ctx, { x: 1, y: 1, pressure: 0.5, time: 0 });
    rec.strokeSample(2, 2, 0.5, 8, false);
    rec.strokeEnd();
    await rec.flush();
    expect(telemetry.snapshot().strokes).toBe(0);
    expect(telemetry.snapshot().samples).toBe(0);
    expect(telemetry.snapshot().totalBytes).toBe(0);
  });
});

// --- store flush-cost meter over real (fake) IDB -----------------------------

const g = globalThis as { indexedDB?: unknown; IDBKeyRange?: unknown };
g.IDBKeyRange = IDBKeyRange;
beforeEach(() => {
  g.indexedDB = new IDBFactory();
});

describe("EventLogStore flush-cost meter (P1.3)", () => {
  it("reports the synchronous add-loop cost once per non-empty append", async () => {
    const costs: { ms: number; rows: number }[] = [];
    const store = new EventLogStore({ onWriteCost: (ms, rows) => costs.push({ ms, rows }) });
    await store.append([{ t: "end" }, { t: "end" }, { t: "end" }]);
    expect(costs).toHaveLength(1);
    expect(costs[0].rows).toBe(3);
    expect(typeof costs[0].ms).toBe("number");
    expect(costs[0].ms).toBeGreaterThanOrEqual(0);
    // an empty append does no work and fires no meter
    await store.append([]);
    expect(costs).toHaveLength(1);
    // the rows really landed
    expect(await store.count()).toBe(3);
  });

  it("works without a meter (back-compat: default constructor)", async () => {
    const store = new EventLogStore();
    await store.append([{ t: "clear" }]);
    expect(await store.count()).toBe(1);
  });
});

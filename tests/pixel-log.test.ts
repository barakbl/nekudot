import { describe, it, expect } from "vitest";
import { PixelLog, type PixelLogBackend, type PixelLogEntry } from "../src/pixel-log";
import { brushNames } from "../src/brushes/registry";

const BRUSH = brushNames()[0];
const entry = (n: number): PixelLogEntry => ({
  brush_type: BRUSH,
  dash: "solid",
  width: 2,
  x: n,
  y: 20,
  layer_id: "L1",
  pixel_map_id: "M1",
});
const row = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ ...entry(10), ...over });

// Records calls; `failNextAppend` simulates a quota/IO failure.
class FakeBackend implements PixelLogBackend {
  appends: { rows: unknown[]; max: number }[] = [];
  replaced: unknown[][] = [];
  cleared = 0;
  preset: unknown[] = [];
  failNextAppend = false;
  async load() {
    return this.preset;
  }
  async append(rows: unknown[], max: number) {
    if (this.failNextAppend) {
      this.failNextAppend = false;
      throw new Error("quota boom");
    }
    this.appends.push({ rows: [...rows], max });
  }
  async replaceAll(rows: unknown[]) {
    this.replaced.push([...rows]);
  }
  async clear() {
    this.cleared++;
  }
}

describe("PixelLog.loadRawJSONL — validates untrusted .nekudot input", () => {
  it("keeps valid rows and drops every kind of bad one", async () => {
    const log = new PixelLog();
    const text = [
      row(), // ok
      row({ x: -5, y: 5 }), // ok (negative within bounds)
      "{ not json", // unparseable
      row({ brush_type: "Ghost Brush" }), // unknown brush
      row({ x: 1e9 }), // coordinate out of range
      row({ width: -1 }), // negative width
      row({ dash: "zigzag" }), // bad enum
      JSON.stringify({ brush_type: BRUSH }), // missing fields
      "", // blank line
    ].join("\n");
    await log.loadRawJSONL(text);
    expect(log.count).toBe(2);
  });

  it("drops everything from a garbage blob", async () => {
    const log = new PixelLog();
    await log.loadRawJSONL("garbage\n{}\n[1,2,3]\n42");
    expect(log.count).toBe(0);
  });

  it("round-trips valid rows through toJSONL", async () => {
    const log = new PixelLog();
    await log.loadRawJSONL([row(), row({ x: 1, y: 2 })].join("\n"));
    const out = log.toJSONL().trim().split("\n");
    expect(out.length).toBe(2);
    expect(JSON.parse(out[0]).brush_type).toBe(BRUSH);
  });
});

describe("PixelLog enable gate (off by default)", () => {
  it("drops appends until enabled, then records them", async () => {
    const backend = new FakeBackend();
    const log = new PixelLog(backend);
    log.append(entry(1)); // disabled by default -> dropped
    await log.flush();
    expect(backend.appends.length).toBe(0);
    expect(log.count).toBe(0);
    log.setEnabled(true);
    log.append(entry(2));
    await log.flush();
    expect(backend.appends.length).toBe(1);
    expect(log.count).toBe(1);
  });
});

describe("PixelLog flushing — appends only the new rows", () => {
  it("each flush writes exactly the rows appended since the last one", async () => {
    const backend = new FakeBackend();
    const log = new PixelLog(backend);
    log.setEnabled(true); // writing is off by default now
    log.append(entry(1));
    log.append(entry(2));
    await log.flush();
    log.append(entry(3));
    await log.flush();
    expect(backend.appends.map((a) => a.rows.length)).toEqual([2, 1]);
    expect(backend.appends[1].rows).toEqual([entry(3)]);
    expect(backend.appends[0].max).toBe(100_000);
    // ...and the in-memory log still holds everything.
    expect(log.count).toBe(3);
  });

  it("flush with nothing pending writes nothing", async () => {
    const backend = new FakeBackend();
    const log = new PixelLog(backend);
    log.setEnabled(true); // writing is off by default now
    await log.flush();
    log.append(entry(1));
    await log.flush();
    await log.flush();
    expect(backend.appends.length).toBe(1);
  });

  it("a failed write is retried by the next flush, rows in order", async () => {
    const backend = new FakeBackend();
    const log = new PixelLog(backend);
    log.setEnabled(true); // writing is off by default now
    log.append(entry(1));
    log.append(entry(2));
    backend.failNextAppend = true;
    await log.flush(); // swallowed, like every store failure today
    expect(backend.appends.length).toBe(0);
    log.append(entry(3));
    await log.flush();
    expect(backend.appends[0].rows).toEqual([entry(1), entry(2), entry(3)]);
  });

  it("init validates loaded rows; bad ones are dropped", async () => {
    const backend = new FakeBackend();
    backend.preset = [entry(1), { garbage: true }, entry(2), 42];
    const log = new PixelLog(backend);
    log.setEnabled(true); // writing is off by default now
    await log.init();
    expect(log.count).toBe(2);
  });

  it("loadRawJSONL replaces the persisted log and supersedes pending rows", async () => {
    const backend = new FakeBackend();
    const log = new PixelLog(backend);
    log.setEnabled(true); // writing is off by default now
    log.append(entry(1)); // pending, never flushed
    await log.loadRawJSONL([row({ x: 7 })].join("\n"));
    expect(backend.replaced.length).toBe(1);
    expect(backend.replaced[0].length).toBe(1);
    await log.flush(); // the pre-load pending row must not resurface
    expect(backend.appends.length).toBe(0);
  });

  it("clear wipes memory, pending and the store", async () => {
    const backend = new FakeBackend();
    const log = new PixelLog(backend);
    log.setEnabled(true); // writing is off by default now
    log.append(entry(1));
    await log.clear();
    expect(log.count).toBe(0);
    expect(backend.cleared).toBe(1);
    await log.flush();
    expect(backend.appends.length).toBe(0);
  });
});

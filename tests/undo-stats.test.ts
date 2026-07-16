import { afterEach, describe, expect, it, vi } from "vitest";

import type { UndoSnapshot } from "../src/undo";
import {
  UndoStats,
  snapshotBlobBytes,
  snapshotPointCount,
  undoStatsEnabled,
} from "../src/app/undo-stats";

// Build a snapshot with the given layer blob sizes (-1 = a null blob, i.e. a
// failed/empty capture) and neighbour-map point count.
const snap = (blobSizes: number[], pts = 0): UndoSnapshot => ({
  config: {} as UndoSnapshot["config"],
  paint: {
    version: 2,
    layers: blobSizes.map((size, i) => ({
      layerIndex: i,
      blob: size >= 0 ? ({ size } as Blob) : null,
    })),
    neighborsMaps:
      pts > 0
        ? [{ index: 0, pixels: Array.from({ length: pts }, (_, k) => ({ x: k, y: k })) }]
        : [],
  },
});

const joined = (log: ReturnType<typeof vi.fn>): string =>
  log.mock.calls.map((c) => c[0]).join("\n");

describe("undoStatsEnabled", () => {
  afterEach(() => vi.unstubAllGlobals());

  const withFlag = (value: string | null) => {
    const store = new Map<string, string>();
    if (value !== null) store.set("nekudot.undoStats", value);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
    });
  };

  it("is off when the key is absent", () => {
    withFlag(null);
    expect(undoStatsEnabled()).toBe(false);
  });

  it("is on for the truthy toggles, case-insensitively", () => {
    for (const v of ["on", "1", "true", "yes", "ON", "True"]) {
      withFlag(v);
      expect(undoStatsEnabled()).toBe(true);
    }
  });

  it("is off for explicit off-ish values", () => {
    for (const v of ["off", "0", "false", "no", ""]) {
      withFlag(v);
      expect(undoStatsEnabled()).toBe(false);
    }
  });

  it("is off when localStorage access throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("disabled");
      },
    });
    expect(undoStatsEnabled()).toBe(false);
  });
});

describe("snapshot accounting", () => {
  it("sums layer blob bytes, treating null blobs as zero", () => {
    expect(snapshotBlobBytes(snap([100, 200, -1]))).toBe(300);
  });

  it("counts neighbour-map points", () => {
    expect(snapshotPointCount(snap([10], 7))).toBe(7);
    expect(snapshotPointCount(snap([10]))).toBe(0);
  });
});

describe("UndoStats disabled (the default) is a strict no-op", () => {
  it("passes a pending capture straight through and logs nothing", () => {
    const log = vi.fn();
    const stats = new UndoStats({ enabled: false, log });
    const pending = Promise.resolve(snap([100]));
    // Same promise reference: no wrapping, no timing, nothing.
    expect(stats.measureCapture("stroke", pending)).toBe(pending);
    expect(log).not.toHaveBeenCalled();
  });

  it("runs the restore callback and returns its value without logging", async () => {
    const log = vi.fn();
    const stats = new UndoStats({ enabled: false, log });
    const run = vi.fn(async () => "restored");
    expect(await stats.measureRestore("undo", run)).toBe("restored");
    expect(run).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
  });

  it("reports no stack and never touches navigator for the estimate", async () => {
    const log = vi.fn();
    const estimate = vi.fn();
    vi.stubGlobal("navigator", { storage: { estimate } });
    const stats = new UndoStats({ enabled: false, log });
    stats.reportStack([snap([100]), snap([200])]);
    await stats.logStorageEstimate();
    expect(log).not.toHaveBeenCalled();
    expect(estimate).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("UndoStats enabled logs the baseline numbers", () => {
  it("times a capture and reports its blob bytes + point count", async () => {
    const log = vi.fn();
    let t = 0;
    const stats = new UndoStats({ enabled: true, log, now: () => t });
    const pending = stats.measureCapture("stroke", Promise.resolve(snap([100, 200], 3)));
    t = 8; // clock advances before the encode resolves
    await pending;
    expect(joined(log)).toContain('capture "stroke": 8.0ms, 300 B blob, 3 pts');
  });

  it("times a restore and returns the applied value", async () => {
    const log = vi.fn();
    let t = 0;
    const stats = new UndoStats({ enabled: true, log, now: () => t });
    const value = await stats.measureRestore("redo", async () => {
      t = 5;
      return 42;
    });
    expect(value).toBe(42);
    expect(joined(log)).toContain("redo restore: 5.0ms");
  });

  it("reports stack bytes but dedupes when count and total are unchanged", () => {
    const log = vi.fn();
    const stats = new UndoStats({ enabled: true, log });
    stats.reportStack([snap([100])]);
    stats.reportStack([snap([100])]); // same 1 entry / 100 bytes -> no new line
    stats.reportStack([snap([100]), snap([50])]); // 2 entries / 150 bytes -> logs
    const lines = log.mock.calls.map((c) => c[0] as string);
    expect(lines).toEqual([
      "[undoStats] stack: 1 entries, 100 B blob",
      "[undoStats] stack: 2 entries, 150 B blob",
    ]);
  });

  it("logs the storage estimate once at boot", async () => {
    const log = vi.fn();
    vi.stubGlobal("navigator", {
      storage: { estimate: async () => ({ usage: 1024, quota: 4096 }) },
    });
    const stats = new UndoStats({ enabled: true, log });
    await stats.logStorageEstimate();
    expect(joined(log)).toContain("storage estimate: 1.0 KB / 4.0 KB (25.0%)");
    vi.unstubAllGlobals();
  });
});

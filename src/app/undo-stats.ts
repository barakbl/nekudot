import type { UndoBackend, UndoSnapshot } from "../undo";

// Capture/restore instrumentation for the undo stack, gated by
// localStorage["nekudot.undoStats"]. This exists to baseline the tile-undo work
// (docs/internals.local/tile-undo-plan.md, PR3): capture latency, per-entry blob
// bytes, whole-stack bytes, and restore latency, plus the storage estimate at
// boot. Every hook below is a strict no-op unless the flag is on, so a normal
// session pays nothing and behaves identically - the flag only turns on logging.

const FLAG_KEY = "nekudot.undoStats";
const ON_VALUES = new Set(["on", "1", "true", "yes"]);

// Read once at construction. localStorage is absent in some test/node contexts
// (and can throw when disabled), so every access is guarded to "off".
export function undoStatsEnabled(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    const raw = localStorage.getItem(FLAG_KEY);
    return raw != null && ON_VALUES.has(raw.toLowerCase());
  } catch {
    return false;
  }
}

// Blob bytes held by a snapshot's layers - the real memory cost we want to
// shrink. Null blobs (a failed capture, or the bare test env) count as zero.
export function snapshotBlobBytes(snap: UndoSnapshot): number {
  let bytes = 0;
  for (const layer of snap.paint.layers) bytes += layer.blob?.size ?? 0;
  return bytes;
}

// Total neighbour-map points carried alongside the blobs - reported next to the
// blob bytes because the tile plan journals these separately from pixels.
export function snapshotPointCount(snap: UndoSnapshot): number {
  let n = 0;
  for (const map of snap.paint.neighborsMaps ?? []) n += map.pixels.length;
  return n;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const fmtMs = (ms: number): string => `${ms.toFixed(1)}ms`;

const defaultNow = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const defaultLog = (msg: string): void => console.log(msg);

export type UndoStatsOptions = {
  // Forced on/off (tests); defaults to reading the flag.
  enabled?: boolean;
  // Monotonic clock; injectable so tests can assert latency deterministically.
  now?: () => number;
  // Sink for the formatted lines; defaults to console.log.
  log?: (msg: string) => void;
};

export class UndoStats {
  readonly enabled: boolean;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  // Dedupe the stack line: the backend save() taps every push/undo/redo, but
  // undo/redo leave the stack bytes unchanged (only the pointer moves), so we
  // only log when the entry count or total actually shifts.
  private lastStackKey = "";

  constructor(opts: UndoStatsOptions = {}) {
    this.enabled = opts.enabled ?? undoStatsEnabled();
    this.now = opts.now ?? defaultNow;
    this.log = opts.log ?? defaultLog;
  }

  // Log usage/quota once at boot. Fire-and-forget from init so it never stalls
  // the history FIFO. Guarded: navigator.storage.estimate is not everywhere.
  async logStorageEstimate(): Promise<void> {
    if (!this.enabled) return;
    try {
      const estimate = await navigator?.storage?.estimate?.();
      if (!estimate) return;
      const usage = estimate.usage ?? 0;
      const quota = estimate.quota ?? 0;
      const pct = quota > 0 ? ((usage / quota) * 100).toFixed(1) : "?";
      this.log(
        `[undoStats] storage estimate: ${fmtBytes(usage)} / ${fmtBytes(quota)} (${pct}%)`,
      );
    } catch {
      // estimate() rejected or is unavailable - nothing to report.
    }
  }

  // Wrap a pending capture: passes the same promise through untouched when off,
  // otherwise logs how long the blob encoding took and how big the entry is.
  measureCapture(
    description: string,
    pending: Promise<UndoSnapshot>,
  ): Promise<UndoSnapshot> {
    if (!this.enabled) return pending;
    const start = this.now();
    return pending.then((snap) => {
      const ms = this.now() - start;
      this.log(
        `[undoStats] capture "${description}": ${fmtMs(ms)}, ` +
          `${fmtBytes(snapshotBlobBytes(snap))} blob, ${snapshotPointCount(snap)} pts`,
      );
      return snap;
    });
  }

  // Time an undo/redo apply. Runs the callback unchanged when off.
  async measureRestore<T>(
    kind: "undo" | "redo",
    run: () => Promise<T>,
  ): Promise<T> {
    if (!this.enabled) return run();
    const start = this.now();
    try {
      return await run();
    } finally {
      this.log(`[undoStats] ${kind} restore: ${fmtMs(this.now() - start)}`);
    }
  }

  // Report the whole stack's byte footprint, deduped (see lastStackKey).
  reportStack(stack: readonly UndoSnapshot[]): void {
    if (!this.enabled) return;
    let total = 0;
    for (const snap of stack) total += snapshotBlobBytes(snap);
    const key = `${stack.length}:${total}`;
    if (key === this.lastStackKey) return;
    this.lastStackKey = key;
    this.log(
      `[undoStats] stack: ${stack.length} entries, ${fmtBytes(total)} blob`,
    );
  }
}

// Wrap an undo backend so every persisted save reports the live stack's bytes.
// Only installed when stats are enabled, so the un-instrumented path is the
// bare backend with zero indirection.
export function withStackReporting(
  backend: UndoBackend,
  stats: UndoStats,
): UndoBackend {
  return {
    load: () => backend.load(),
    clear: () => backend.clear(),
    save: (state) => {
      stats.reportStack(state.stack);
      return backend.save(state);
    },
  };
}

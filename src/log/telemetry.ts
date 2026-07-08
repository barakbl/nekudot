// Recording telemetry (vector-replay P1.3): the Gate 1 numbers, measured live so
// the Diagnostics panel shows facts, not vibes. Three metrics, one per gate check:
//
//   1. pointermove tap overhead (p95, ms) - the time the recorder's strokeSample
//      tap adds to a pointermove. Recording OFF is a no-op early-return (~0), so
//      the on-cost IS the delta vs off. Gate 1: < 0.2 ms p95.
//   2. log byte rate - bytes/stroke and KB/min of the JSONL the recorder emits.
//      Gate 1: < 1 MB/min raw.
//   3. flush stalls - flushes whose SYNCHRONOUS main-thread work (the IDB
//      structured-clone at store.add) ran past FLUSH_STALL_MS. Gate 1: none > 8 ms.
//
// It's a passive sink: the recorder + store feed it, the panel reads snapshot().
// A no-op unless a recorder is wired to it, so it costs nothing when recording is
// off. The clock is injectable so tests can drive elapsed time deterministically.

export const FLUSH_STALL_MS = 8; // a flush stalling the main thread past this is jank
const SAMPLE_CAP = 4096; // rolling window of pointermove tap durations for the p95

export type TelemetrySnapshot = {
  strokes: number; // StrokeBegin count
  samples: number; // pointermove taps measured
  pointermoveP95Ms: number; // p95 tap overhead over the rolling window
  totalBytes: number; // JSONL bytes persisted so far
  bytesPerStroke: number; // totalBytes / strokes (0 when no strokes)
  bytesPerMinute: number; // totalBytes / elapsed minutes (0 before any elapsed)
  flushes: number; // persisted batches
  flushStalls: number; // flushes with syncMs > FLUSH_STALL_MS
  maxFlushMs: number; // worst single flush main-thread stall
  elapsedMs: number; // since first recorded activity
};

export class RecorderTelemetry {
  // Fixed ring of tap durations (ms); allocation-free on the hot path so measuring
  // the overhead barely adds to it.
  private readonly taps = new Float64Array(SAMPLE_CAP);
  private tapWrite = 0;
  private tapFilled = 0;
  private samples = 0;
  private strokes = 0;
  private totalBytes = 0;
  private flushes = 0;
  private flushStalls = 0;
  private maxFlushMs = 0;
  private startMs = -1; // performance.now() at the first recorded activity
  private readonly now: () => number;

  constructor(now: () => number = () => performance.now()) {
    this.now = now;
  }

  private touch(): void {
    if (this.startMs < 0) this.startMs = this.now();
  }

  // A stroke started (one StrokeBegin).
  strokeBegan(): void {
    this.touch();
    this.strokes++;
  }

  // One pointermove tap took `ms` on the main thread.
  sample(ms: number): void {
    this.touch();
    this.samples++;
    this.taps[this.tapWrite] = ms;
    this.tapWrite = (this.tapWrite + 1) % SAMPLE_CAP;
    if (this.tapFilled < SAMPLE_CAP) this.tapFilled++;
  }

  // A flush persisted `bytes` of JSONL. Separate from flushCost because the byte
  // count is the recorder's to compute and the stall is the store's to measure.
  addBytes(bytes: number): void {
    this.touch();
    this.totalBytes += bytes;
    this.flushes++;
  }

  // A flush's synchronous main-thread work took `syncMs` (the IDB clone at add()).
  flushCost(syncMs: number): void {
    if (syncMs > this.maxFlushMs) this.maxFlushMs = syncMs;
    if (syncMs > FLUSH_STALL_MS) this.flushStalls++;
  }

  reset(): void {
    this.tapWrite = 0;
    this.tapFilled = 0;
    this.samples = 0;
    this.strokes = 0;
    this.totalBytes = 0;
    this.flushes = 0;
    this.flushStalls = 0;
    this.maxFlushMs = 0;
    this.startMs = -1;
  }

  snapshot(): TelemetrySnapshot {
    const elapsedMs = this.startMs < 0 ? 0 : Math.max(0, this.now() - this.startMs);
    const minutes = elapsedMs / 60_000;
    return {
      strokes: this.strokes,
      samples: this.samples,
      pointermoveP95Ms: this.p95(),
      totalBytes: this.totalBytes,
      bytesPerStroke: this.strokes > 0 ? this.totalBytes / this.strokes : 0,
      bytesPerMinute: minutes > 0 ? this.totalBytes / minutes : 0,
      flushes: this.flushes,
      flushStalls: this.flushStalls,
      maxFlushMs: this.maxFlushMs,
      elapsedMs,
    };
  }

  // 95th percentile of the rolling tap window (nearest-rank). 0 when empty.
  private p95(): number {
    const n = this.tapFilled;
    if (n === 0) return 0;
    const sorted = Array.prototype.slice.call(this.taps, 0, n).sort((a: number, b: number) => a - b);
    const idx = Math.min(n - 1, Math.ceil(0.95 * n) - 1);
    return sorted[Math.max(0, idx)];
  }
}

import {
  LOG_SCHEMA_VERSION,
  type LogEvent,
  type StrokeContext,
} from "./events";
import { quantizeCoord, quantizePressure, quantizeDt } from "./sample-codec";
import type { EventLogBackend } from "./store";

// The shadow event recorder (P1.2): taps the live draw path and writes P1.1 events
// to the append-only store. RECORD-ONLY, OFF by default - every entry point early-
// returns when disabled, so the flag off means zero hot-path work. Samples batch
// into a StrokeSamples event every SAMPLE_BATCH (or at stroke end); the buffer
// flushes to IDB at stroke end / every FLUSH_MS of stroke time / on hide, through
// one FIFO write chain (AppHistory.enqueue pattern) so a late append can't overtake
// an earlier one.

const SAMPLE_BATCH = 64;
const FLUSH_MS = 250;

// The parts of a StrokeBegin the caller supplies; the recorder stamps the time.
export type BeginSample = { x: number; y: number; pressure: number; time: number };

export type RecorderDeps = {
  store: EventLogBackend | null;
  appVersion: string;
  dpr: () => number;
  // Canvas + layers snapshot for the ArtworkInit emitted once per session; null
  // skips it (e.g. a bare test harness).
  artworkInit: () => { width: number; height: number; layers: unknown } | null;
};

type SampleBatch = { x: number[]; y: number[]; p: number[]; dt: number[]; web: (0 | 1)[] };

export class EventRecorder {
  private enabled = false;
  private readonly deps: RecorderDeps;
  private pending: LogEvent[] = []; // closed events awaiting a store flush
  private batch: SampleBatch = emptyBatch(); // the open StrokeSamples being filled
  private chain: Promise<void> = Promise.resolve(); // FIFO write chain
  private sessionStarted = false; // SessionStart/ArtworkInit emitted?
  private anchor = 0; // ms origin the stroke times are relative to
  private lastTime = 0; // previous sample time, for dt
  private lastFlush = 0; // stroke time of the last flush, for the FLUSH_MS cadence
  private inStroke = false;

  constructor(deps: RecorderDeps) {
    this.deps = deps;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }
  get recording(): boolean {
    return this.enabled;
  }

  // A stroke begins: emit SessionStart/ArtworkInit once, then StrokeBegin with the
  // frozen context and the (quantized) first sample. Call AFTER the brush's
  // captureStrokeContext so the context's colours are frozen.
  strokeBegin(ctx: StrokeContext, s: BeginSample): void {
    if (!this.enabled) return;
    this.ensureSession(s.time);
    this.emit({
      t: "begin",
      ctx,
      x: quantizeCoord(s.x),
      y: quantizeCoord(s.y),
      p: quantizePressure(s.pressure),
      time: Math.max(0, s.time - this.anchor),
    });
    this.batch = emptyBatch();
    this.lastTime = s.time;
    this.inStroke = true;
  }

  // One input sample after the first. `web` is the recorded web-sample flag (G4).
  strokeSample(x: number, y: number, pressure: number, time: number, web: boolean): void {
    if (!this.enabled || !this.inStroke) return;
    this.batch.x.push(quantizeCoord(x));
    this.batch.y.push(quantizeCoord(y));
    this.batch.p.push(quantizePressure(pressure));
    this.batch.dt.push(quantizeDt(time - this.lastTime));
    this.batch.web.push(web ? 1 : 0);
    this.lastTime = time;
    if (this.batch.x.length >= SAMPLE_BATCH) this.closeBatch();
    // Mid-stroke durability: flush every FLUSH_MS of stroke time (a killed tab loses
    // at most that much), keyed on the recorded time so it stays deterministic.
    if (time - this.lastFlush >= FLUSH_MS) {
      this.lastFlush = time;
      void this.flush();
    }
  }

  strokeEnd(): void {
    if (!this.enabled || !this.inStroke) return;
    this.closeBatch();
    this.emit({ t: "end" });
    this.inStroke = false;
    void this.flush();
  }

  // A non-stroke event (config op / paste / clear). Buffered like the rest.
  event(ev: LogEvent): void {
    if (!this.enabled) return;
    this.ensureSession(this.lastTime);
    this.emit(ev);
  }

  // Persist the pending buffer through the FIFO chain. Safe to call any time
  // (hide, stroke end); a no-op when disabled, empty, or storeless.
  flush(): Promise<void> {
    const store = this.deps.store;
    if (!store || this.pending.length === 0) return Promise.resolve();
    const rows = this.pending;
    this.pending = [];
    return this.enqueue(async () => {
      try {
        await store.append(rows);
      } catch (e) {
        this.pending = [...rows, ...this.pending]; // requeue in order for the next flush
        console.warn("EventRecorder.flush failed", e);
      }
    });
  }

  // Read back everything recorded so far (pending buffer + persisted rows). Used
  // by tests and, later, by save/replay.
  async drain(): Promise<unknown[]> {
    await this.chain; // let in-flight appends land
    const persisted = this.deps.store ? await this.deps.store.load() : [];
    return [...persisted, ...this.pending];
  }

  private ensureSession(time: number): void {
    if (this.sessionStarted) return;
    this.sessionStarted = true;
    this.anchor = time;
    this.lastFlush = time;
    this.emit({
      t: "session",
      schema: LOG_SCHEMA_VERSION,
      time: this.anchor,
      app: this.deps.appVersion,
      dpr: this.deps.dpr(),
    });
    const init = this.deps.artworkInit();
    if (init) this.emit({ t: "init", width: init.width, height: init.height, layers: init.layers } as LogEvent);
  }

  private closeBatch(): void {
    if (this.batch.x.length === 0) return;
    this.emit({ t: "samples", ...this.batch });
    this.batch = emptyBatch();
  }

  private emit(ev: LogEvent): void {
    this.pending.push(ev);
  }

  private enqueue(op: () => Promise<void>): Promise<void> {
    const next = this.chain.then(op).catch((e) => console.warn("EventRecorder: write failed", e));
    this.chain = next;
    return next;
  }
}

function emptyBatch(): SampleBatch {
  return { x: [], y: [], p: [], dt: [], web: [] };
}

import { z } from "zod";
import { LayersConfigSchema } from "../layered/schema";
import { isKnownBrush } from "../brushes/registry";

// Vector-replay event vocabulary (roadmap P1.1). An artwork's process is an
// ordered, append-only log of these events; replaying them reproduces the art.
// RECORD-ONLY for now (the recorder + IDB store are P1.2) - this file is just the
// zod-schema'd types plus a JSONL round-trip for the `.nekudot` slot. JSONL first;
// the compact binary codec is deferred to P6.1.
//
// The pixel log (src/pixel-log.ts) records deposited points, not input - "right
// plumbing, wrong grain". This is the grain: stroke boundaries, the frozen
// per-stroke context (seed + settings), quantized input samples with timing, and
// the config/paste/clear ops between strokes.
//
// Deliberate NON-events (report section 3): undo/redo (a head pointer +
// truncate-on-draw, not modelled here), camera (not paint state), mid-stroke dial
// drags (settings freeze per stroke), and Spray/Wisp ticks (derived from the
// recorded timestamps - see fixed-timestep.ts).

// Bumped whenever the vocabulary changes shape; written into every SessionStart so
// a loaded log always says which schema produced it (version field from day 1).
export const LOG_SCHEMA_VERSION = 1;

// Quantization the recorder applies AT SOURCE (contract G2) so the live path and
// the log consume the same values; the codec itself lands with the recorder
// (P1.2). Coords in 1/8 px, pressure in 10 bits, dt in 0.1 ms - documented here
// because the schemas below store the quantized integers.
export const COORD_UNIT = 1 / 8; // px per quantized coord unit
export const PRESSURE_MAX = 1023; // 10-bit pressure
export const DT_UNIT = 0.1; // ms per quantized dt unit

// Generous sanity bounds. A loaded .nekudot event log is UNTRUSTED input, so every
// row is validated on decode; these reject crafted/corrupt garbage without
// rejecting anything a real session produces (see pixel-log.ts for the pattern).
const MAX_DIM = 32_768; // canvas dimension (app max is 8192)
const MAX_QCOORD = 100_000 * 8; // quantized 1/8 px units (~100k px canvas)
const MAX_SIZE = 10_000; // brush size, px
const MAX_SEED = 0xffffffff; // mulberry32 seed (uint32)
const MAX_SAMPLES = 200_000; // samples per batch (sanity; batches are ~64)
const MAX_TIME = 1e12; // ms since the session anchor (~31 years)

const hex = z.string().regex(/^#[0-9a-fA-F]{3,8}$/);
// The ConnectingFlat / dial snapshot: a flat map of primitives. Kept permissive by
// design (brushes churn; the log stays version-tolerant) - only the SHAPE is
// pinned, not the ~35 individual keys.
const flat = z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()]));
const qcoord = z.number().int().min(-MAX_QCOORD).max(MAX_QCOORD);
const pressureQ = z.number().int().min(0).max(PRESSURE_MAX);

// The only mutable world a stroke may read, frozen at pointerdown (see the P0.2
// seed + P0.4 colour/settings latches that make this capturable).
export const StrokeContextSchema = z.object({
  brush: z.string().min(1).refine(isKnownBrush, { message: "unknown brush" }),
  seed: z.number().int().nonnegative().max(MAX_SEED), // per-stroke RNG seed (P0.2)
  layer: z.string().min(1),
  color: z.object({
    main: hex,
    secondary: hex,
    source: z.string().max(64).optional(), // connection colour source
    gradientSpace: z.string().max(32).optional(),
  }),
  size: z.number().finite().nonnegative().max(MAX_SIZE),
  alpha: z.number().finite().min(0).max(1),
  erase: z.boolean(),
  settings: flat, // the ConnectingFlat dial snapshot (P0.4)
  symmetry: z.object({ tool: z.string().max(64).nullable(), params: flat }),
  pen: z.boolean(), // pen support (pen-mode) on for this stroke
});
export type StrokeContext = z.infer<typeof StrokeContextSchema>;

// --- events (discriminated on `t`; terse for JSONL size) ---------------------

// Canvas + layer configuration the artwork opens with.
export const ArtworkInitSchema = z.object({
  t: z.literal("init"),
  width: z.number().int().positive().max(MAX_DIM),
  height: z.number().int().positive().max(MAX_DIM),
  layers: LayersConfigSchema,
});

// A recording session's anchor: the schema version, a time origin the stroke
// timestamps are relative to, the app version, and the device dpr (provenance
// only - replay renders at the current dpr, contract G9).
export const SessionStartSchema = z.object({
  t: z.literal("session"),
  schema: z.number().int().positive(),
  time: z.number().finite().nonnegative().max(MAX_TIME),
  app: z.string().max(64),
  dpr: z.number().finite().positive().max(16),
});

// Stroke boundary: the frozen context + the quantized first sample and its time
// (ms since the session anchor).
export const StrokeBeginSchema = z.object({
  t: z.literal("begin"),
  ctx: StrokeContextSchema,
  x: qcoord,
  y: qcoord,
  p: pressureQ,
  time: z.number().finite().nonnegative().max(MAX_TIME),
});

// A batch of quantized input samples, as equal-length parallel arrays: 1/8 px
// coords, 10-bit pressure, 0.1 ms inter-sample dt, and the RECORDED web-sample
// flag (contract G4 - captured at input time, never re-derived on replay).
export const StrokeSamplesSchema = z.object({
  t: z.literal("samples"),
  x: z.array(qcoord).max(MAX_SAMPLES),
  y: z.array(qcoord).max(MAX_SAMPLES),
  p: z.array(pressureQ).max(MAX_SAMPLES),
  dt: z.array(z.number().int().nonnegative().max(MAX_TIME)).max(MAX_SAMPLES),
  web: z.array(z.union([z.literal(0), z.literal(1)])).max(MAX_SAMPLES),
});

export const StrokeEndSchema = z.object({ t: z.literal("end") });

// A layer/map/background/resize/clear operation between strokes. Carries the new
// layers config and/or canvas size it produced (exact op semantics land in P1.2).
export const ConfigOpSchema = z.object({
  t: z.literal("config"),
  op: z.string().min(1).max(64),
  layers: LayersConfigSchema.optional(),
  width: z.number().int().positive().max(MAX_DIM).optional(),
  height: z.number().int().positive().max(MAX_DIM).optional(),
});

// A pasted image: the content hash (the blob lives in a separate hash-keyed store)
// plus where it landed. Coords are raw px (not a stroke sample).
export const PasteImageSchema = z.object({
  t: z.literal("paste"),
  hash: z.string().min(1).max(128),
  x: z.number().finite().min(-MAX_QCOORD).max(MAX_QCOORD),
  y: z.number().finite().min(-MAX_QCOORD).max(MAX_QCOORD),
  width: z.number().finite().positive().max(MAX_DIM),
  height: z.number().finite().positive().max(MAX_DIM),
  layer: z.string().min(1),
});

export const ClearCanvasSchema = z.object({ t: z.literal("clear") });

// Imported pre-log state (a v1/v2 .nekudot loaded into the log world): replay
// starts from the baked bitmaps, which is honest - there's no input to replay.
export const LegacyBaseSchema = z.object({
  t: z.literal("legacy"),
  note: z.string().max(256).optional(),
});

const EVENT_MEMBERS = [
  ArtworkInitSchema,
  SessionStartSchema,
  StrokeBeginSchema,
  StrokeSamplesSchema,
  StrokeEndSchema,
  ConfigOpSchema,
  PasteImageSchema,
  ClearCanvasSchema,
  LegacyBaseSchema,
] as const;

// Discriminated for precise per-type errors; a superRefine enforces the one
// cross-field invariant (a samples batch's parallel arrays must be equal length),
// which a plain discriminated union can't express.
export const LogEventSchema = z
  .discriminatedUnion("t", EVENT_MEMBERS)
  .superRefine((ev, ctx) => {
    if (ev.t === "samples") {
      const n = ev.x.length;
      if (ev.y.length !== n || ev.p.length !== n || ev.dt.length !== n || ev.web.length !== n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "sample arrays must all be the same length",
        });
      }
    }
  });
export type LogEvent = z.infer<typeof LogEventSchema>;

// --- JSONL round-trip (the `.nekudot` event-log slot) ------------------------

// One validated event per line. Invalid events are dropped (they can't have been
// produced legitimately), mirroring the log's own append discipline.
export function encodeEventLog(events: readonly LogEvent[]): string {
  const out: string[] = [];
  for (const e of events) {
    const r = LogEventSchema.safeParse(e);
    if (r.success) out.push(JSON.stringify(r.data));
  }
  return out.join("\n");
}

// Parse UNTRUSTED newline-delimited JSON: unparseable lines and rows that fail the
// schema (unknown brush, out-of-range numbers, mismatched sample arrays, missing
// fields) are skipped, exactly like PixelLog.loadRawJSONL.
export function decodeEventLog(text: string): LogEvent[] {
  const out: LogEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      continue; // skip unparseable line
    }
    const r = LogEventSchema.safeParse(json);
    if (r.success) out.push(r.data);
  }
  return out;
}

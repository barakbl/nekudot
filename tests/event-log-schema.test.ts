import { describe, it, expect } from "vitest";
import {
  LOG_SCHEMA_VERSION,
  LogEventSchema,
  encodeEventLog,
  decodeEventLog,
  type LogEvent,
} from "../src/log/events";

// P1.1 of the vector-replay roadmap: the event vocabulary + its JSONL round-trip.
// A loaded .nekudot event log is UNTRUSTED, so decode must drop anything a real
// session couldn't have produced (the src/pixel-log.ts hardening pattern).

const layers = {
  maxLayers: 10,
  activeIndex: 0,
  layers: [{ id: "L1", index: 0, name: "Layer 1", types: ["normal"], opacity: 100 }],
  neighborsMaps: [{ id: "M1", name: "Map 1", opacity: 100 }],
  selectedNeighborsMapIndex: 0,
  background: { color: "#0d0e12", transparent: false },
};

const ctx = {
  brush: "Round", // a real registered brush (isKnownBrush)
  seed: 0x9e3779b9,
  layer: "L1",
  color: { main: "#e11d48", secondary: "#22d3ee", source: "web", gradientSpace: "oklch" },
  size: 24,
  alpha: 0.8,
  erase: false,
  settings: { density: 40, radius: 80, dash: "solid", bloom: false },
  symmetry: { tool: "radial", params: { count: 8, centerX: 0.5, centerY: 0.5 } },
  pen: true,
};

// One fully-specified event of every kind.
const SAMPLE_EVENTS: unknown[] = [
  { t: "init", width: 1920, height: 1080, layers },
  { t: "session", schema: LOG_SCHEMA_VERSION, time: 1_000_000, app: "0.41.1", dpr: 2 },
  { t: "begin", ctx, x: 480, y: 512, p: 800, time: 12 },
  { t: "samples", x: [481, 490, 505], y: [513, 520, 540], p: [790, 810, 760], dt: [8, 8, 9], web: [0, 1, 1] },
  { t: "end" },
  { t: "config", op: "resize", width: 2048, height: 1152 },
  { t: "config", op: "layer-add", layers },
  { t: "paste", hash: "sha256-abc123", x: 100, y: 200, width: 640, height: 480, layer: "L1" },
  { t: "clear" },
  { t: "legacy", note: "imported v2 .nekudot" },
];

const canonical = (): LogEvent[] => SAMPLE_EVENTS.map((e) => LogEventSchema.parse(e));

describe("event-log schema (vector-replay P1.1)", () => {
  it("every valid event survives a JSONL round-trip unchanged", () => {
    const events = canonical();
    const round = decodeEventLog(encodeEventLog(events));
    expect(round).toEqual(events);
    expect(round.length).toBe(SAMPLE_EVENTS.length);
  });

  it("encodes one line per event and carries the schema version", () => {
    const events = canonical();
    const lines = encodeEventLog(events).split("\n");
    expect(lines).toHaveLength(events.length);
    const session = decodeEventLog(encodeEventLog(events)).find((e) => e.t === "session");
    expect(session).toMatchObject({ schema: LOG_SCHEMA_VERSION });
  });

  it("skips blank and unparseable lines, keeps the valid ones", () => {
    const good = encodeEventLog(canonical().slice(0, 3));
    const jsonl = `\n  \n${good}\nnot json{\n{"t":"nope"}\n`;
    expect(decodeEventLog(jsonl)).toHaveLength(3);
  });

  it("drops an unknown event type", () => {
    expect(decodeEventLog(JSON.stringify({ t: "teleport", x: 1 }))).toEqual([]);
  });

  describe("untrusted-input hardening drops crafted/corrupt rows", () => {
    const dropped = (bad: unknown) => {
      expect(LogEventSchema.safeParse(bad).success).toBe(false);
      expect(decodeEventLog(JSON.stringify(bad))).toEqual([]);
    };

    it("unknown brush in the stroke context", () => {
      dropped({ t: "begin", ctx: { ...ctx, brush: "Bulldozer" }, x: 1, y: 1, p: 1, time: 1 });
    });
    it("out-of-range seed / coord / pressure", () => {
      dropped({ t: "begin", ctx: { ...ctx, seed: -1 }, x: 1, y: 1, p: 1, time: 1 });
      dropped({ t: "begin", ctx, x: 9e9, y: 1, p: 1, time: 1 });
      dropped({ t: "begin", ctx, x: 1, y: 1, p: 5000, time: 1 }); // > 10-bit
    });
    it("non-integer (unquantized) sample coords", () => {
      dropped({ t: "samples", x: [1.5], y: [2], p: [10], dt: [8], web: [0] });
    });
    it("mismatched sample array lengths", () => {
      dropped({ t: "samples", x: [1, 2], y: [3], p: [10, 20], dt: [8, 8], web: [0, 1] });
    });
    it("a bad web flag (not 0/1)", () => {
      dropped({ t: "samples", x: [1], y: [2], p: [10], dt: [8], web: [2] });
    });
    it("a malformed colour hex in the context", () => {
      dropped({ t: "begin", ctx: { ...ctx, color: { main: "red", secondary: "#fff" } }, x: 1, y: 1, p: 1, time: 1 });
    });
    it("missing required fields", () => {
      dropped({ t: "session", schema: LOG_SCHEMA_VERSION }); // no time/app/dpr
      dropped({ t: "init", width: 100 }); // no height/layers
    });
    it("a nested settings value that isn't a primitive", () => {
      dropped({ t: "begin", ctx: { ...ctx, settings: { nested: { a: 1 } } }, x: 1, y: 1, p: 1, time: 1 });
    });
  });

  it("keeps valid rows even when interleaved with rejected ones", () => {
    const jsonl = [
      JSON.stringify({ t: "clear" }), // valid
      JSON.stringify({ t: "begin", ctx: { ...ctx, brush: "???" }, x: 1, y: 1, p: 1, time: 1 }), // bad brush
      JSON.stringify({ t: "end" }), // valid
      JSON.stringify({ t: "samples", x: [1], y: [2, 3], p: [1], dt: [1], web: [0] }), // length mismatch
      JSON.stringify(canonical()[1]), // valid session
    ].join("\n");
    const out = decodeEventLog(jsonl);
    expect(out.map((e) => e.t)).toEqual(["clear", "end", "session"]);
  });
});

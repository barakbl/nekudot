import { describe, it, expect } from "vitest";
import { CanvasRenderer } from "../src/renderer";
import type { Pixel } from "../src/neighbor-finder";

// Regression tests for LineStyle.composite - the renderer half of the Chroma
// blend feature. drawLine must set ctx.globalCompositeOperation to
// style.composite for the duration of the draw, and its save/restore must scope
// it so it never leaks into the next line or clobbers a persistent mode (erase).

// A spy 2D context: records the globalCompositeOperation live at each stroke()
// and implements save/restore over the mutable style state (so a missed restore
// shows up as a leak). Only the calls drawLine makes are stubbed.
function makeSpyCtx() {
  const strokeGco: string[] = [];
  const raw: Record<string, unknown> = {
    strokeStyle: "#000000",
    lineWidth: 1,
    globalAlpha: 1,
    lineCap: "butt",
    lineJoin: "miter",
    lineDashOffset: 0,
    globalCompositeOperation: "source-over",
    canvas: { width: 10, height: 10 },
  };
  const SAVED = [
    "globalCompositeOperation",
    "globalAlpha",
    "strokeStyle",
    "lineWidth",
    "lineCap",
    "lineJoin",
    "lineDashOffset",
  ];
  const stack: Record<string, unknown>[] = [];
  raw.save = () => {
    const s: Record<string, unknown> = {};
    for (const k of SAVED) s[k] = raw[k];
    stack.push(s);
  };
  raw.restore = () => {
    const s = stack.pop();
    if (s) for (const k of SAVED) raw[k] = s[k];
  };
  const noop = () => {};
  raw.beginPath = noop;
  raw.moveTo = noop;
  raw.lineTo = noop;
  raw.quadraticCurveTo = noop;
  raw.arc = noop;
  raw.setLineDash = noop;
  raw.scale = noop;
  raw.stroke = () => strokeGco.push(raw.globalCompositeOperation as string);
  return { ctx: raw as unknown as CanvasRenderingContext2D, raw, strokeGco };
}

const A: Pixel = { id: 0, x: 0, y: 0 };
const B: Pixel = { id: 1, x: 5, y: 5 };

describe("renderer: LineStyle.composite", () => {
  it("applies the composite during the draw and restores it after", () => {
    const { ctx, raw, strokeGco } = makeSpyCtx();
    const r = new CanvasRenderer(ctx);
    r.drawLine(A, B, { color: "#ffffff", composite: "lighten" });
    expect(strokeGco).toEqual(["lighten"]); // live during stroke
    expect(raw.globalCompositeOperation).toBe("source-over"); // restored, not left set
  });

  it("leaves the composite untouched when the style omits it", () => {
    const { ctx, raw, strokeGco } = makeSpyCtx();
    const r = new CanvasRenderer(ctx);
    r.drawLine(A, B, { color: "#ffffff" });
    expect(strokeGco).toEqual(["source-over"]);
    expect(raw.globalCompositeOperation).toBe("source-over");
  });

  it("does not leak a composite into the next line", () => {
    const { ctx, strokeGco } = makeSpyCtx();
    const r = new CanvasRenderer(ctx);
    r.drawLine(A, B, { color: "#ffffff", composite: "lighten" });
    r.drawLine(A, B, { color: "#ffffff" }); // no composite: must be back to normal
    expect(strokeGco).toEqual(["lighten", "source-over"]);
  });

  it("restores to a persistent mode (erase), not blindly to source-over", () => {
    const { ctx, raw, strokeGco } = makeSpyCtx();
    const r = new CanvasRenderer(ctx, { eraseMode: true });
    expect(raw.globalCompositeOperation).toBe("destination-out");
    r.drawLine(A, B, { color: "#ffffff", composite: "lighten" });
    expect(strokeGco).toEqual(["lighten"]);
    expect(raw.globalCompositeOperation).toBe("destination-out"); // erase mode intact
  });

  it("styleless hot path draws without touching the composite", () => {
    const { ctx, raw, strokeGco } = makeSpyCtx();
    const r = new CanvasRenderer(ctx);
    r.drawLine(A, B); // no style -> save/restore skipped
    expect(strokeGco).toEqual(["source-over"]);
    expect(raw.globalCompositeOperation).toBe("source-over");
  });
});

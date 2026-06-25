import { describe, it, expect } from "vitest";
import { SquaresBrush } from "../src/brushes/squares";

// base.stroke(): only a sampled (sample=true), non-erasing, non-throttled stroke
// deposits a searchable point into the persistent cloud (host.addPixel). Coalesced
// sub-samples (sample=false) and erasing strokes paint the mark but use an
// ephemeral id:-1 point, so they must NOT grow the cloud - otherwise the web
// builds up ~quadratically with the pointer's report rate (the "web darkens"
// regression). Squares is a convenient non-connecting brush, so depositPixel goes
// straight to host.addPixel.
function setup(erasing = false) {
  const deposits: { x: number; y: number }[] = [];
  const tracked: Record<string, unknown> = {
    addPixel: (x: number, y: number) => {
      deposits.push({ x, y });
      return { id: deposits.length - 1, x, y };
    },
    selectedMapId: () => "",
    isErasing: () => erasing,
    strokeWidth: () => 1,
    strokeAlpha: () => 1,
  };
  // Any other host method the draw path touches is a harmless no-op.
  const host = new Proxy(tracked, {
    get: (t, p) => (p in t ? t[p as string] : () => {}),
  }) as never;
  const brush = new SquaresBrush(host, 1); // fixed seed, no store
  return { brush, deposits };
}

describe("persistent cloud deposits (id:-1 stays out)", () => {
  it("a sampled, non-erasing stroke deposits exactly one searchable point", () => {
    const { brush, deposits } = setup();
    brush.strokeStart(0, 0);
    brush.stroke(50, 0, true);
    expect(deposits.length).toBe(1);
  });

  it("coalesced sub-samples (sample=false) never deposit", () => {
    const { brush, deposits } = setup();
    brush.strokeStart(0, 0);
    brush.stroke(50, 0, true); // one real deposit
    brush.stroke(60, 0, false); // coalesced sub-frame
    brush.stroke(70, 0, false); // coalesced sub-frame
    expect(deposits.length).toBe(1); // still just the one
  });

  it("erasing strokes never deposit, even when sampled", () => {
    const { brush, deposits } = setup(true);
    brush.strokeStart(0, 0);
    brush.stroke(50, 0, true);
    brush.stroke(60, 0, true);
    expect(deposits.length).toBe(0);
  });
});

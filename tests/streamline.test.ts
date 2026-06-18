import { describe, it, expect } from "vitest";
import { Streamliner } from "../src/brushes/streamline";

describe("Streamliner", () => {
  it("strength 0 is a raw passthrough with nothing to drain", () => {
    const s = new Streamliner();
    expect(s.push(10, 20, 0)).toEqual({ x: 10, y: 20 });
    expect(s.push(30, 40, 0)).toEqual({ x: 30, y: 40 });
    expect([...s.drain(0)]).toEqual([]);
  });

  it("self-seeds to the first raw sample, then lags toward the cursor", () => {
    const s = new Streamliner();
    expect(s.push(0, 0, 50)).toEqual({ x: 0, y: 0 }); // seed: no start lag
    const p = s.push(10, 0, 50); // k = 0.5 → halfway to the cursor
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(0);
  });

  it("higher strength lags more", () => {
    const light = new Streamliner();
    light.push(0, 0, 20);
    const heavy = new Streamliner();
    heavy.push(0, 0, 90);
    expect(light.push(100, 0, 20).x).toBeGreaterThan(heavy.push(100, 0, 90).x);
  });

  it("drain catches the stroke up to the last cursor point", () => {
    const s = new Streamliner();
    s.push(0, 0, 50);
    s.push(100, 0, 50); // smoothed point now lags at x≈50, target x=100
    const tail = [...s.drain(50)];
    expect(tail.length).toBeGreaterThan(0);
    expect(100 - tail.at(-1)!.x).toBeLessThan(1);
    expect(tail.at(-1)!.y).toBeCloseTo(0);
  });

  it("reset re-seeds on the next stroke", () => {
    const s = new Streamliner();
    s.push(0, 0, 50);
    s.push(10, 0, 50);
    s.reset();
    expect(s.push(99, 99, 50)).toEqual({ x: 99, y: 99 }); // seeded afresh
  });
});

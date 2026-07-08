import { describe, it, expect } from "vitest";
import { buildCases, runCase, type Case, type CaseResult } from "./_replay-harness";

// P0.1 of the vector-replay roadmap: the determinism matrix that every later card
// depends on. See tests/_replay-harness.ts for the method (Property A = pinned
// determinism, Property B = replay-safety under a perturbed clock + frame cadence).
//
// KNOWN_REPLAY_UNSAFE is now EMPTY: every brush is replay-safe (Gate 0). Shapes
// (P0.3) sizes from the recorded time, and Spray + Wisp (P0.5a/b) step on a fixed
// virtual timestep instead of counting rAF frames. If a new brush reads the wall
// clock / frame cadence, add it here with a note - but the goal is to keep this
// empty so the whole matrix stays replay-safe.
const KNOWN_REPLAY_UNSAFE = new Set<string>([]);

const results: Array<{ c: Case } & CaseResult> = buildCases().map((c) => ({ c, ...runCase(c) }));

describe("replay determinism matrix (P0.1)", () => {
  it("produces the brush x style matrix", () => {
    console.table(
      results.map((r) => ({
        case: r.c.id,
        "deposits+draws": r.size,
        "pinned (A)": r.propA ? "ok" : "FAIL",
        "replay-safe (B)": r.propB ? "yes" : "NO",
      })),
    );
    expect(results.length).toBeGreaterThan(10); // 10 styles + 7 brushes
  });

  it("no case is vacuous (every brush drew or deposited something)", () => {
    expect(results.filter((r) => r.size === 0).map((r) => r.c.id)).toEqual([]);
  });

  it("every brush is fully deterministic under identical conditions (property A)", () => {
    expect(results.filter((r) => !r.propA).map((r) => r.c.id)).toEqual([]);
  });

  it("exactly the documented brushes are replay-unsafe (property B baseline)", () => {
    const unsafe = new Set(results.filter((r) => !r.propB).map((r) => r.c.brush));
    expect([...unsafe].sort()).toEqual([...KNOWN_REPLAY_UNSAFE].sort());
  });

  it.each(results.map((r) => [r.c.id, r.c.brush, r.propB] as const))(
    "%s replay-safety matches baseline",
    (_id, brush, propB) => {
      expect(propB).toBe(!KNOWN_REPLAY_UNSAFE.has(brush));
    },
  );
});

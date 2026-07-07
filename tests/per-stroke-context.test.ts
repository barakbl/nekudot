import { describe, it, expect } from "vitest";
import type { BrushBase } from "../src/base";
import { buildCases, recordCaseColor, type ColorPair } from "./_replay-harness";

// P0.4 of the vector-replay roadmap (card #116): the toolbar colours are frozen at
// a stroke's start (BrushBase.captureStrokeContext), so a stroke's pixels depend
// only on the colours at pointer-down - never on the live store read mid-stroke.
// recordCaseColor drives a case against a live colour store and, in the "flip"
// variant, changes that store right after the first sample; the frozen latch must
// make that change invisible in the recorded geometry.

const A: ColorPair = { main: "#e11d48", secondary: "#22d3ee" }; // rose / cyan
const B: ColorPair = { main: "#84cc16", secondary: "#a855f7" }; // lime / violet

describe("per-stroke colour latch (vector-replay P0.4)", () => {
  // The card's acceptance: the whole P0.1 matrix is unchanged when the toolbar
  // colour is mutated mid-stroke. Doubles as a completeness check - any colour read
  // I failed to freeze would make the mutated run diverge here.
  it.each(buildCases().map((c) => [c.id, c.brush, c.style] as const))(
    "%s: a mid-stroke colour change does not alter the stroke",
    (_id, brush, style) => {
      const frozen = recordCaseColor(brush, style, { color: A });
      const mutated = recordCaseColor(brush, style, { color: A, flipTo: B });
      expect(mutated).toEqual(frozen);
    },
  );

  // Vacuity guards: prove the frozen colour genuinely rides the recorded output
  // (else the invariance above would be trivially satisfied), through BOTH the
  // brush path (Color Pen's line colour) and the connection path (Chroma's
  // shimmer). Color Pen's default source is angle-driven "rainbow", which ignores
  // the toolbar colour, so pin it to "main" (line colour = Primary) for this probe.
  const useMainSource = (b: BrushBase) => {
    (b as unknown as { source: string }).source = "main";
  };
  const cases: Array<[string, string, string | undefined, ((b: BrushBase) => void)?]> = [
    ["Color Pen (source=main)", "Color Pen", undefined, useMainSource],
    ["Round / chroma", "Round", "chroma", undefined],
  ];
  it.each(cases)("%s: the frozen colour really rides the output", (_id, brush, style, configure) => {
    const withA = recordCaseColor(brush, style, { color: A, configure });
    const withB = recordCaseColor(brush, style, { color: B, configure });
    expect(withA.length).toBeGreaterThan(0);
    expect(withB).not.toEqual(withA); // a different frozen colour -> different geometry
    // ...and a mid-stroke flip is ignored (frozen), matching the constant-A run.
    const flipped = recordCaseColor(brush, style, { color: A, flipTo: B, configure });
    expect(flipped).toEqual(withA);
  });
});

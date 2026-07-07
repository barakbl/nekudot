import { describe, it, expect } from "vitest";
import { recordSecondStroke } from "./_replay-harness";

// P0.2 of the vector-replay roadmap (card #114): each stroke re-seeds the brush
// RNG at its start, so a stroke's look depends only on its own seed + samples,
// never on how many random values earlier strokes drew (the stream used to run
// cumulatively across a session). recordSecondStroke isolates that: stroke 1 is
// identical every call, so only stroke 2's RNG position varies. The styles below
// all consume the shared RNG when they weave.
const RNG_STYLES = ["web", "chroma", "longfur", "fur"];

describe("per-stroke RNG seed (vector-replay P0.2)", () => {
  it.each(RNG_STYLES)(
    "Round/%s: a reseeded stroke is identical regardless of prior RNG position",
    (style) => {
      const plain = recordSecondStroke("Round", style, { reseed: true });
      const afterPrior = recordSecondStroke("Round", style, { preSeed: 0x0badf00d, reseed: true });
      expect(plain.length).toBeGreaterThan(0); // the style actually wove something
      expect(afterPrior).toEqual(plain); // the boundary reseed erased the difference
    },
  );

  it.each(RNG_STYLES)(
    "Round/%s: WITHOUT the reseed, prior RNG position leaks into the stroke",
    (style) => {
      // The dependency the reseed removes is real: same cloud, only the RNG
      // position differs, and the recorded geometry changes. This is the pre-P0.2
      // behavior - the reason a stroke's look used to depend on its predecessors.
      const plain = recordSecondStroke("Round", style, { reseed: false });
      const afterPrior = recordSecondStroke("Round", style, { preSeed: 0x0badf00d, reseed: false });
      expect(afterPrior).not.toEqual(plain);
    },
  );
});

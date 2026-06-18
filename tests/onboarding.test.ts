import { describe, it, expect } from "vitest";
import { shouldShowOnboarding } from "../src/onboarding/onboarding";

describe("shouldShowOnboarding (first-run gating)", () => {
  it("shows on a clean first run - nothing stored", () => {
    expect(shouldShowOnboarding({ onboarded: false, hasPriorUse: false })).toBe(
      true,
    );
  });

  it("shows again after a reset (storage wiped: not onboarded, no prior use)", () => {
    // A reset clears localStorage, so both flags are false - same as first run.
    expect(shouldShowOnboarding({ onboarded: false, hasPriorUse: false })).toBe(
      true,
    );
  });

  it("does not show once the user has onboarded", () => {
    expect(shouldShowOnboarding({ onboarded: true, hasPriorUse: false })).toBe(
      false,
    );
  });

  it("does not hide an existing user's canvas (prior data, not yet flagged)", () => {
    expect(shouldShowOnboarding({ onboarded: false, hasPriorUse: true })).toBe(
      false,
    );
  });

  it("stays hidden for a returning, onboarded user", () => {
    expect(shouldShowOnboarding({ onboarded: true, hasPriorUse: true })).toBe(
      false,
    );
  });
});

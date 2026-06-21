import { describe, it, expect } from "vitest";
import { gradientCatalog, onboardingPalettes } from "../src/colors/gradients/catalog";
import { moodById } from "../src/colors/moods";

// The catalog is settings.json + the bundled .gpl files, parsed into palettes.
describe("gradient catalog", () => {
  const items = gradientCatalog();

  it("parses every settings.json entry into a usable palette", () => {
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      expect(i.id).toBeTruthy();
      expect(i.palette.colors.length).toBeGreaterThan(0);
      expect(moodById(i.palette.mood ?? "")).toBeDefined(); // a valid mood id
    }
  });

  it("ships at least one palette for every mood (incl. Cool/Earthy/Pastel)", () => {
    const moods = new Set(items.map((i) => i.palette.mood));
    for (const m of ["CALM", "HOT", "COOL", "VIBRANT", "EARTHY", "PASTEL", "GENERAL"]) {
      expect(moods.has(m)).toBe(true);
    }
  });

  it("includes App Colors (12) and the default gradients with stable ids", () => {
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get("app")?.palette.name).toBe("App Colors");
    expect(byId.get("app")?.palette.colors).toHaveLength(12);
    for (const id of ["conn:ocean", "conn:sunset", "conn:fire", "conn:neon"]) {
      expect(byId.has(id)).toBe(true);
    }
  });

  it("onboardingPalettes is the onboarding:true subset of the catalog", () => {
    const onboard = onboardingPalettes();
    const onboardIds = new Set(onboard.map((p) => p.id));
    const expected = items.filter((i) => i.onboarding).map((i) => i.id);
    expect([...onboardIds].sort()).toEqual(expected.sort());
    // Invariants (independent of per-palette onboarding tuning): the original
    // gradients are always seeded; the large Copic marker sets never are.
    expect([...onboardIds]).toEqual(
      expect.arrayContaining(["app", "conn:ocean", "conn:sunset", "conn:fire", "conn:neon"]),
    );
    for (const id of ["conn:copic_classic", "conn:copic_sketch", "conn:copic_ciao"]) {
      expect(onboardIds.has(id)).toBe(false);
    }
  });
});

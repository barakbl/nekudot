import "fake-indexeddb/auto";
import { beforeEach, describe, it, expect } from "vitest";
import {
  clearColorsStore,
  loadCustomPalettes,
  loadGradientPalettes,
  saveCustomPalettes,
} from "../src/colors/store";

// fake-indexeddb persists across tests in a file; clearColorsStore wipes the
// keys + resets the one-time seed guard so each test starts fresh.
beforeEach(async () => {
  await clearColorsStore();
});

describe("palette store: gradient flag, mood, and seeding", () => {
  it("round-trips the gradient flag + mood on palettes", async () => {
    await saveCustomPalettes([
      { id: "p1", name: "A", colors: ["#ff0000"], gradient: true, mood: "CALM" },
      { id: "p2", name: "B", colors: ["#00ff00"], gradient: false },
    ]);
    const loaded = await loadCustomPalettes();
    expect(loaded.find((p) => p.id === "p1")?.gradient).toBe(true);
    expect(loaded.find((p) => p.id === "p1")?.mood).toBe("CALM");
    expect(loaded.find((p) => p.id === "p2")?.gradient).toBe(false);
    expect(loaded.find((p) => p.id === "p2")?.mood).toBe("GENERAL"); // default
  });

  it("seeds the bundled onboarding gradients once (idempotent)", async () => {
    const ids = (await loadGradientPalettes()).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["app", "conn:ocean", "conn:fire"]));
    // A second load doesn't duplicate the seeds.
    const all = await loadCustomPalettes();
    expect(all.filter((p) => p.id === "conn:ocean")).toHaveLength(1);
  });

  it("loadGradientPalettes = seeded gradients + custom gradient:true palettes", async () => {
    await saveCustomPalettes([
      { id: "p1", name: "A", colors: ["#ff0000"], gradient: true },
      { id: "p2", name: "B", colors: ["#00ff00"], gradient: false },
    ]);
    const ids = (await loadGradientPalettes()).map((p) => p.id);
    expect(ids).toContain("p1"); // custom, gradient on
    expect(ids).not.toContain("p2"); // custom, gradient off
    expect(ids).toContain("conn:ocean"); // a seeded gradient (default on)
  });
});

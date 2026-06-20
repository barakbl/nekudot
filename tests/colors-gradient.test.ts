import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import {
  loadBuiltinGradients,
  loadCustomPalettes,
  loadGradientPalettes,
  saveBuiltinGradients,
  saveCustomPalettes,
} from "../src/colors/store";

describe("gradient flag persistence", () => {
  it("round-trips the gradient flag on custom palettes", async () => {
    await saveCustomPalettes([
      { id: "p1", name: "A", colors: ["#ff0000"], gradient: true },
      { id: "p2", name: "B", colors: ["#00ff00"], gradient: false },
    ]);
    const loaded = await loadCustomPalettes();
    expect(loaded.find((p) => p.id === "p1")?.gradient).toBe(true);
    expect(loaded.find((p) => p.id === "p2")?.gradient).toBe(false);
  });

  it("round-trips built-in gradient on/off overrides", async () => {
    await saveBuiltinGradients({ "conn:sunset": false, app: true });
    const m = await loadBuiltinGradients();
    expect(m["conn:sunset"]).toBe(false);
    expect(m.app).toBe(true);
  });

  it("loadGradientPalettes = built-ins (default on, minus toggled-off) + custom gradients", async () => {
    await saveBuiltinGradients({ "conn:sunset": false });
    await saveCustomPalettes([
      { id: "p1", name: "A", colors: ["#ff0000"], gradient: true },
      { id: "p2", name: "B", colors: ["#00ff00"], gradient: false },
    ]);
    const ids = (await loadGradientPalettes()).map((p) => p.id);
    expect(ids).toContain("app"); // built-in, default on
    expect(ids).not.toContain("conn:sunset"); // built-in, toggled off
    expect(ids).toContain("p1"); // custom, gradient on
    expect(ids).not.toContain("p2"); // custom, gradient off
  });
});

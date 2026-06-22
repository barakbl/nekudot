import { describe, it, expect } from "vitest";
import { opacityStorageKey, recalledOpacity } from "../src/app/opacity-store";

describe("opacityStorageKey", () => {
  it("scopes per (brush, art-style) for connecting brushes", () => {
    expect(opacityStorageKey("Round", true, "shaded")).toBe("brush.Round.opacity.shaded");
    expect(opacityStorageKey("Round", true, "web")).toBe("brush.Round.opacity.web");
  });
  it("scopes per brush for non-connecting brushes", () => {
    expect(opacityStorageKey("Marker", false, "shaded")).toBe("brush.Marker.opacity");
  });
});

describe("recalledOpacity", () => {
  it("prefers the saved value", () => {
    expect(recalledOpacity(0.7, 0.05)).toBe(0.7);
    expect(recalledOpacity(0, 0.5)).toBe(0); // a saved 0 is honoured, not skipped
  });
  it("falls back to the style default when nothing is saved", () => {
    expect(recalledOpacity(undefined, 0.05)).toBe(0.05);
  });
  it("falls back to fully opaque when there's neither", () => {
    expect(recalledOpacity(undefined, undefined)).toBe(1);
  });
});

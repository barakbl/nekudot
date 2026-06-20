import { describe, it, expect } from "vitest";
import { createBareHost } from "../src/paint-host";
import { RoundBrush } from "../src/brushes/round";
import { connectionColorOptions } from "../src/brushes/color-source";
import type { IRenderer } from "../src/renderer";
import type { NeighborFinder } from "../src/neighbor-finder";
import {
  applyConnectionColor,
  mandalaConnectionColor,
  DEFAULT_MANDALA_CONNECTION_COLOR,
} from "../src/onboarding/connection-color";

const noopRenderer = () =>
  new Proxy({} as Record<string, unknown>, { get: () => () => {} }) as unknown as IRenderer;

const makeFinder = (): NeighborFinder => {
  let id = 0;
  return {
    addPixel: (x, y) => ({ id: id++, x, y }),
    findNeighbors: () => [],
    allPixels: () => [],
    pixelCount: () => id,
    livePixelCount: () => 0,
    clear: () => {},
  };
};

const roundBrush = () => new RoundBrush(createBareHost(noopRenderer(), makeFinder()));

describe("onboarding mandala connection colour", () => {
  it("defaults to rainbow, which is a real colour-source option", () => {
    expect(DEFAULT_MANDALA_CONNECTION_COLOR).toBe("rainbow");
    expect(connectionColorOptions()).toContain(DEFAULT_MANDALA_CONNECTION_COLOR);
  });

  it("uses the JSON-configured colour, falling back to the default", () => {
    expect(mandalaConnectionColor("gradient")).toBe("gradient");
    expect(mandalaConnectionColor(undefined)).toBe("rainbow");
  });

  it("applies the colour to the connecting brush's active connection", () => {
    const brush = roundBrush();
    expect(applyConnectionColor(brush, "rainbow")).toBe(true);
    expect(brush.activeConnection()!.toFlat().color).toBe("rainbow");
  });

  it("ignores an unknown colour, leaving the connection unchanged", () => {
    const brush = roundBrush();
    applyConnectionColor(brush, "rainbow");
    expect(applyConnectionColor(brush, "chartreuse")).toBe(false);
    expect(brush.activeConnection()!.toFlat().color).toBe("rainbow");
  });
});

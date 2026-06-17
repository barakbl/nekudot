import { describe, it, expect } from "vitest";
import { CanvasRenderer } from "../src/renderer";
import { GEOMETRY_METHODS } from "../src/paint-host";

// The symmetry proxy (src/symmetry/proxy.ts) forwards any method it doesn't
// override straight to the base, untransformed. Its override table is typed
// against GEOMETRY_METHODS, so it can't miss one of those — but a NEW renderer
// method added without classification would silently skip symmetry. This test
// forces the classification: every method on CanvasRenderer must be listed
// either in GEOMETRY_METHODS (mirrored by the proxy) or in NON_GEOMETRY below.

const NON_GEOMETRY = new Set([
  "constructor",
  // Raw path building. No brush draws marks through these today; a brush that
  // starts to needs them mirrored (move to GEOMETRY_METHODS + proxy override).
  "moveTo",
  "lineTo",
  "arc",
  "stroke",
  // Whole-canvas and state operations — nothing positional to mirror.
  "clear",
  "setLineWidth",
  "setStrokeStyle",
  "setGlobalAlpha",
  "setEraseMode",
  "fillBackground",
  "drawSource",
  "drawBitmap",
  // Bakes a pasted image once at its placed rect (called on the raw
  // LayerManager, not the brush/symmetry proxy) - a placement, not a mark.
  "drawImageRect",
  "toBlob",
  // Internal helpers (TS-private, but still on the prototype).
  "applyLineStyle",
  "styled",
  "filled",
  "tracePath",
]);

// Geometry entries that live on the router/finder surface of a PaintHost,
// not on CanvasRenderer.
const NON_RENDERER_GEOMETRY = new Set([
  "drawConnectionToLayer",
  "addPixel",
  "addPixelToMap",
]);

const rendererMethods = Object.getOwnPropertyNames(
  CanvasRenderer.prototype,
).filter(
  (n) =>
    typeof Object.getOwnPropertyDescriptor(CanvasRenderer.prototype, n)
      ?.value === "function",
);

describe("symmetry proxy method coverage", () => {
  it("classifies every CanvasRenderer method as geometry or non-geometry", () => {
    for (const name of rendererMethods) {
      const classified =
        (GEOMETRY_METHODS as readonly string[]).includes(name) ||
        NON_GEOMETRY.has(name);
      expect(
        classified,
        `CanvasRenderer.${name} is unclassified — add it to GEOMETRY_METHODS ` +
          `(and the symmetry proxy's overrides) if it draws/deposits at ` +
          `coordinates, or to NON_GEOMETRY in this test if it doesn't`,
      ).toBe(true);
    }
  });

  it("lists only real methods in GEOMETRY_METHODS", () => {
    for (const name of GEOMETRY_METHODS) {
      const real =
        rendererMethods.includes(name) || NON_RENDERER_GEOMETRY.has(name);
      expect(
        real,
        `GEOMETRY_METHODS lists "${name}" but no such method exists on ` +
          `CanvasRenderer or the router/finder surface`,
      ).toBe(true);
    }
  });

  it("classifies no method as both geometry and non-geometry", () => {
    for (const name of GEOMETRY_METHODS) {
      expect(NON_GEOMETRY.has(name), `"${name}" is in both lists`).toBe(false);
    }
  });
});

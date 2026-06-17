import type { IRenderer, LineStyle, LineConnectType } from "./renderer";
import type { NeighborFinder, Pixel } from "./neighbor-finder";
import type { ConnectRouter } from "./connecting-types";

// The full surface a brush draws through: renderer (marks go to the active
// layer), neighbor finder (points go to the selected memory map) and connect
// router (id-addressed layers/maps + stroke context). At runtime this is the
// LayerManager (wrapped in the symmetry proxy); tests and the headless render
// harnesses use createBareHost() below. Naming the merge keeps the contract
// explicit — brushes need ONE object serving all three roles, not three
// objects that happen to coincide.
//
// Note the deliberate collision resolution: both IRenderer and NeighborFinder
// declare clear(). On a PaintHost, clear() is the renderer's (wipe the active
// canvas); the point clouds are wiped via the router's clearPixels().
export interface PaintHost extends IRenderer, NeighborFinder, ConnectRouter {}

// The methods on a PaintHost that carry geometry (points/marks the symmetry
// proxy must replay at every transform). The proxy's override table is typed
// against this list, so adding a method here without handling it there fails
// to compile; tests/symmetry-coverage.test.ts guards the reverse direction
// (adding a draw method to the renderer without classifying it here).
export const GEOMETRY_METHODS = [
  // draws
  "drawLine",
  "drawConnection",
  "drawConnectionToLayer",
  "drawChisel",
  "strokeRect",
  "fillRect",
  "strokeCircle",
  "fillCircle",
  "strokeEllipse",
  "fillEllipse",
  // deposits
  "addPixel",
  "addPixelToMap",
] as const;
export type GeometryMethod = (typeof GEOMETRY_METHODS)[number];

// A PaintHost over a bare renderer + finder, for unit tests and the headless
// render harnesses (no layer stack, no maps). The router role answers
// neutrally, reproducing what the app does when an id is unknown: pinned-map
// calls fall back to the one finder, connection lines land on the renderer,
// nothing erases, and the empty ids keep the pixel log silent.
export function createBareHost(
  renderer: IRenderer,
  finder: NeighborFinder,
): PaintHost {
  return {
    // ---- IRenderer ----------------------------------------------------------
    moveTo: (x, y) => renderer.moveTo(x, y),
    lineTo: (x, y) => renderer.lineTo(x, y),
    arc: (x, y, r, a0, a1) => renderer.arc(x, y, r, a0, a1),
    stroke: () => renderer.stroke(),
    drawLine: (p1, p2, style, kind) => renderer.drawLine(p1, p2, style, kind),
    drawConnection: (p1, p2, style, kind) =>
      renderer.drawConnection(p1, p2, style, kind),
    drawChisel: (p1, p2, angle, style) =>
      renderer.drawChisel(p1, p2, angle, style),
    strokeRect: (x, y, w, h, style, angle) =>
      renderer.strokeRect(x, y, w, h, style, angle),
    strokeCircle: (x, y, r, style) => renderer.strokeCircle(x, y, r, style),
    fillEllipse: (x, y, rx, ry, angle, color, alpha) =>
      renderer.fillEllipse(x, y, rx, ry, angle, color, alpha),
    strokeEllipse: (x, y, rx, ry, angle, style) =>
      renderer.strokeEllipse(x, y, rx, ry, angle, style),
    fillRect: (x, y, w, h, color, angle, alpha) =>
      renderer.fillRect(x, y, w, h, color, angle, alpha),
    fillCircle: (x, y, r, color, alpha) =>
      renderer.fillCircle(x, y, r, color, alpha),
    clear: () => renderer.clear(), // the canvas — points clear via clearPixels()
    setLineWidth: (w) => renderer.setLineWidth(w),
    setStrokeStyle: (c) => renderer.setStrokeStyle(c),
    setGlobalAlpha: (a) => renderer.setGlobalAlpha(a),
    setEraseMode: (on) => renderer.setEraseMode(on),
    fillBackground: (color) => renderer.fillBackground(color),
    drawSource: (other, opacity, scale) =>
      renderer.drawSource(other, opacity, scale),
    drawBitmap: (bitmap) => renderer.drawBitmap(bitmap),
    drawImageRect: (img, x, y, w, h) => renderer.drawImageRect(img, x, y, w, h),
    toBlob: (type) => renderer.toBlob(type),

    // ---- NeighborFinder (the one finder doubles as "the selected map") -------
    addPixel: (x, y) => finder.addPixel(x, y),
    findNeighbors: (px, radius) => finder.findNeighbors(px, radius),
    allPixels: () => finder.allPixels(),
    pixelCount: () => finder.pixelCount(),
    livePixelCount: () => finder.livePixelCount(),

    // ---- ConnectRouter (neutral answers) -------------------------------------
    listLayers: () => [],
    listMaps: () => [],
    addPixelToMap: (_mapId: string, x: number, y: number): Pixel =>
      finder.addPixel(x, y),
    findNeighborsInMap: (_mapId: string, px: Pixel, radius: number): Pixel[] =>
      finder.findNeighbors(px, radius),
    mapSize: (_mapId: string): number => finder.pixelCount(),
    clearPixels: () => finder.clear(),
    isErasing: () => false,
    activeLayerId: () => "",
    activeConnectionLayerId: () => "",
    selectedMapId: () => "", // falsy → BrushBase skips pixel-log rows
    strokeWidth: () => 1,
    strokeAlpha: () => 1,
    drawConnectionToLayer: (
      _layerId: string,
      p1: Pixel,
      p2: Pixel,
      style?: LineStyle,
      kind?: LineConnectType,
    ) => renderer.drawConnection(p1, p2, style, kind),
  };
}

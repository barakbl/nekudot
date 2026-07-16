import type { IRenderer, LineConnectType } from "../renderer";
import type { Pixel } from "../neighbor-finder";

// Closed-form dirty bounds for each geometry primitive. Every bound must be a
// strict SUPERSET of the touched pixels - too small silently loses paint on undo
// - so they err wide (convex hulls, half-diagonal circles, an AA skirt).

// A dirty rect in LOGICAL (css) px - the space the geometry methods receive (the
// ctx carries the dpr scale; the manager scales to device px at snap time).
export type Rect = { x: number; y: number; w: number; h: number };

// AA skirt added around every bound (logical px), covering antialiasing spread.
export const DIRTY_PAD = 1;

function bboxOfPoints(pts: readonly { x: number; y: number }[]): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function inflate(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, w: r.w + 2 * by, h: r.h + 2 * by };
}

// drawLine / drawConnection between two points. The point hull inflated by half
// the stroke width (caps reach w/2 past each endpoint) plus the AA skirt.
export function lineBounds(
  p1: Pixel,
  p2: Pixel,
  kind: LineConnectType,
  width: number,
  curve = 0.3,
): Rect {
  let hull: { x: number; y: number }[];
  switch (kind) {
    case "arc": {
      // The arc rides a circle centred on the chord midpoint, radius chord/2;
      // that circle's bbox covers it whichever way it bulges (endpoints included).
      const cx = (p1.x + p2.x) / 2;
      const cy = (p1.y + p2.y) / 2;
      const r = Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2;
      hull = [
        { x: cx - r, y: cy - r },
        { x: cx + r, y: cy + r },
      ];
      break;
    }
    case "quadraticCurve": {
      // A quadratic Bezier stays within the triangle of its endpoints + control
      // point (constructed as in tracePath).
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      hull = [p1, p2, { x: mx - dy * curve, y: my + dx * curve }];
      break;
    }
    default: // "line"
      hull = [p1, p2];
  }
  return inflate(bboxOfPoints(hull), width / 2 + DIRTY_PAD);
}

// drawChisel: a filled quad whose four corners already carry the width, so only
// the AA skirt is added.
export function chiselBounds(
  p1: Pixel,
  p2: Pixel,
  angle: number,
  width: number,
): Rect {
  const dx = (Math.cos(angle) * width) / 2;
  const dy = (Math.sin(angle) * width) / 2;
  const corners = [
    { x: p1.x + dx, y: p1.y + dy },
    { x: p2.x + dx, y: p2.y + dy },
    { x: p2.x - dx, y: p2.y - dy },
    { x: p1.x - dx, y: p1.y - dy },
  ];
  return inflate(bboxOfPoints(corners), DIRTY_PAD);
}

// strokeRect / fillRect: a w x h box centred at (x, y). A rotation of unknown
// angle is bounded by the corner circle (half-diagonal). strokeWidth is 0 for fills.
export function rectBounds(
  x: number,
  y: number,
  w: number,
  h: number,
  angle: number | undefined,
  strokeWidth: number,
): Rect {
  let box: Rect;
  if (angle) {
    const r = Math.hypot(w, h) / 2;
    box = { x: x - r, y: y - r, w: 2 * r, h: 2 * r };
  } else {
    box = { x: x - w / 2, y: y - h / 2, w, h };
  }
  return inflate(box, strokeWidth / 2 + DIRTY_PAD);
}

// strokeCircle / fillCircle. strokeWidth is 0 for fills.
export function circleBounds(
  x: number,
  y: number,
  radius: number,
  strokeWidth: number,
): Rect {
  const box = { x: x - radius, y: y - radius, w: 2 * radius, h: 2 * radius };
  return inflate(box, strokeWidth / 2 + DIRTY_PAD);
}

// strokeEllipse / fillEllipse: bounded by the max(rx, ry) circle (any rotation).
// strokeWidth is 0 for fills.
export function ellipseBounds(
  x: number,
  y: number,
  rx: number,
  ry: number,
  strokeWidth: number,
): Rect {
  const r = Math.max(rx, ry);
  const box = { x: x - r, y: y - r, w: 2 * r, h: 2 * r };
  return inflate(box, strokeWidth / 2 + DIRTY_PAD);
}

// drawImageRect: the top-left-origin rect (x, y, w, h), matching ctx.drawImage.
export function imageRectBounds(
  x: number,
  y: number,
  w: number,
  h: number,
): Rect {
  return inflate({ x, y, w, h }, DIRTY_PAD);
}

// How TrackingRenderer treats each IRenderer method: "bounded" marks a computed
// rect, "full" marks the whole layer (fail closed), "none" is untracked (state,
// path building, readback). Typed against keyof IRenderer so a new method must be
// classified to compile; the dirty-tracking test guards that every bounded/full
// method is actually overridden.
export type DirtyClass = "bounded" | "full" | "none";

export const DIRTY_CLASSIFICATION: Record<keyof IRenderer, DirtyClass> = {
  drawLine: "bounded",
  drawConnection: "bounded",
  drawChisel: "bounded",
  strokeRect: "bounded",
  fillRect: "bounded",
  strokeCircle: "bounded",
  fillCircle: "bounded",
  strokeEllipse: "bounded",
  fillEllipse: "bounded",
  drawImageRect: "bounded",
  stroke: "full",
  clear: "full",
  fillBackground: "full",
  drawSource: "full",
  drawBitmap: "full",
  // Restore-only blit; always runs inside tracker.silently() during undo, so this
  // markAll never actually fires there - but if ever called live, fail closed.
  blitPatch: "full",
  moveTo: "none",
  lineTo: "none",
  arc: "none",
  setLineWidth: "none",
  setStrokeStyle: "none",
  setGlobalAlpha: "none",
  setEraseMode: "none",
  toBlob: "none",
};

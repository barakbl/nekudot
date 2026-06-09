// A symmetry transform: an affine isometry (rotation / reflection / translation)
// plus an opacity multiplier for that copy.
//   x' = a*x + c*y + e ;  y' = b*x + d*y + f
export type Transform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  aMul: number; // opacity multiplier for this copy (tile fades; radial = 1)
};

export const IDENTITY: Transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, aMul: 1 };

export function isIdentity(t: Transform): boolean {
  return t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1 && t.e === 0 && t.f === 0;
}

// True when the transform list does nothing (symmetry off) — a single identity.
export function isPassthrough(ts: readonly Transform[]): boolean {
  return ts.length === 1 && isIdentity(ts[0]);
}

export function applyPoint(t: Transform, x: number, y: number): { x: number; y: number } {
  return { x: t.a * x + t.c * y + t.e, y: t.b * x + t.d * y + t.f };
}

// Transform a shape's intrinsic angle: map its unit direction by the linear
// part. Handles rotation and reflection uniformly (translation leaves it).
export function applyAngle(t: Transform, angle: number): number {
  const cx = Math.cos(angle);
  const sy = Math.sin(angle);
  return Math.atan2(t.b * cx + t.d * sy, t.a * cx + t.c * sy);
}

export type TileParams = {
  xSpacing: number;
  ySpacing: number;
  reach: number;
  falloffPct: number;
};
export type RadialParams = { segments: number; mirror: boolean };
export type MirrorAxis = "vertical" | "horizontal";
export type MirrorParams = { axis: MirrorAxis };

// Affine isometry: rotation by `theta` about (cx,cy), optionally pre-reflected
// across the x-axis through the centre. Shared by Radial and Mirror.
function rotateReflect(
  theta: number,
  flip: boolean,
  cx: number,
  cy: number,
): Transform {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // R(theta): [[cos,-sin],[sin,cos]];  R(theta)*reflectX: [[cos,sin],[sin,-cos]]
  const a = cos;
  const b = sin;
  const c = flip ? sin : -sin;
  const d = flip ? -cos : cos;
  // translate so the centre is a fixed point
  const e = cx - (a * cx + c * cy);
  const f = cy - (b * cx + d * cy);
  return { a, b, c, d, e, f, aMul: 1 };
}

function translate(dx: number, dy: number, aMul: number): Transform {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy, aMul };
}

// Cap on tile copies so a small spacing + large reach can't explode the work
// (each copy also deposits mirrored points into the memory).
const MAX_TILE_COPIES = 120;

// Tile: translated copies to each junction within `reach` of the anchor (the
// junction nearest the stroke start), faded toward the edge. (= old Handfree.)
export function tileTransforms(
  p: TileParams,
  startX: number,
  startY: number,
): Transform[] {
  const sx = p.xSpacing;
  const sy = p.ySpacing;
  const r = p.reach;
  if (sx <= 0 || sy <= 0 || r <= 0) return [IDENTITY];
  const rx = Math.round(startX / sx) * sx; // anchor = nearest junction to start
  const ry = Math.round(startY / sy) * sy;
  const power = (p.falloffPct / 100) * 2.5;
  const spanX = Math.ceil(r / sx) * sx;
  const spanY = Math.ceil(r / sy) * sy;
  const out: Transform[] = [];
  for (let jy = ry - spanY; jy <= ry + spanY; jy += sy) {
    for (let jx = rx - spanX; jx <= rx + spanX; jx += sx) {
      const dist = Math.hypot(jx - rx, jy - ry);
      if (dist > r) continue;
      const aMul = Math.pow(1 - dist / r, power); // 1 at anchor, 0 at the edge
      if (aMul <= 0) continue;
      out.push(translate(jx - rx, jy - ry, aMul));
    }
  }
  if (out.length > MAX_TILE_COPIES) {
    // Keep the strongest copies (nearest the anchor) if we overflow the cap.
    out.sort((p1, p2) => p2.aMul - p1.aMul);
    out.length = MAX_TILE_COPIES;
  }
  return out.length ? out : [IDENTITY];
}

// Radial (kaleidoscope): N rotations about (cx,cy); with `mirror`, each rotation
// is paired with a reflected copy — full strength.
export function radialTransforms(
  p: RadialParams,
  cx: number,
  cy: number,
): Transform[] {
  const n = Math.max(1, Math.floor(p.segments));
  const step = (2 * Math.PI) / n;
  const out: Transform[] = [];
  for (let k = 0; k < n; k++) {
    out.push(rotateReflect(k * step, false, cx, cy));
    if (p.mirror) out.push(rotateReflect(k * step, true, cx, cy));
  }
  return out.length ? out : [IDENTITY];
}

// Mirror: the master plus one reflection across a single axis through the
// centre. A vertical mirror line flips left/right (x→−x); a horizontal one
// flips top/bottom (y→−y). It's a one-line Radial, sharing rotateReflect.
export function mirrorTransforms(
  p: MirrorParams,
  cx: number,
  cy: number,
): Transform[] {
  const refl =
    p.axis === "vertical"
      ? rotateReflect(Math.PI, true, cx, cy) // reflect across the y-axis (x→−x)
      : rotateReflect(0, true, cx, cy); // reflect across the x-axis (y→−y)
  return [IDENTITY, refl];
}

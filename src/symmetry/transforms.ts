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
  fillCanvas: boolean; // tile the whole canvas (reach + falloff ignored)
};
export type RadialParams = { segments: number; mirror: boolean };
// Mirror line angle in degrees through the centre: 90 = vertical line (flips
// left/right), 0 = horizontal (flips top/bottom), in between = a diagonal mirror.
export type MirrorParams = { angle: number };
// Concentric: `rings` copies, each scaled by `scalePct`% of the previous about
// the centre and rotated by `twist` degrees (twist 0 = pure concentric rings).
export type ConcentricParams = { rings: number; scalePct: number; twist: number };
// Spiral: `copies` copies marching around the centre, each rotated by `angleStep`
// degrees and scaled by `scalePct`% of the previous (a log spiral when <100, a
// flat rotational fan at 100). `arms` repeats the whole spiral N times.
export type SpiralParams = {
  copies: number;
  arms: number;
  angleStep: number;
  scalePct: number;
};

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
// Fill mode covers the whole canvas at full strength, so it legitimately needs
// far more copies than reach mode — a higher budget, still bounded so a tiny
// spacing on a huge canvas can't melt things (the live stroke redraws every
// copy on every pointer move). Past the budget the grid is stepped over
// uniformly, keeping coverage even rather than clustered near the stroke.
const MAX_TILE_FILL_COPIES = 1600;

// Tile: translated copies to each junction within `reach` of the anchor (the
// junction nearest the stroke start), faded toward the edge. (= old Handfree.)
// With `fillCanvas`, instead tile the whole canvas at full strength (reach +
// falloff are ignored) — needs `size`.
export function tileTransforms(
  p: TileParams,
  startX: number,
  startY: number,
  size?: { width: number; height: number },
): Transform[] {
  const sx = p.xSpacing;
  const sy = p.ySpacing;
  if (sx <= 0 || sy <= 0) return [IDENTITY];
  const rx = Math.round(startX / sx) * sx; // anchor = nearest junction to start
  const ry = Math.round(startY / sy) * sy;

  // Fill the canvas: a full-opacity copy at every grid junction across it (one
  // cell of margin on each side so edge tiles aren't clipped). If the grid is
  // denser than the budget, step over junctions uniformly (a coarser but still
  // even grid) so coverage stays spread across the whole canvas instead of
  // clustering around the stroke.
  if (p.fillCanvas && size) {
    const nx = Math.ceil(size.width / sx) + 3;
    const ny = Math.ceil(size.height / sy) + 3;
    const stride = Math.max(1, Math.ceil(Math.sqrt((nx * ny) / MAX_TILE_FILL_COPIES)));
    const out: Transform[] = [];
    for (let iy = 0; iy < ny; iy += stride)
      for (let ix = 0; ix < nx; ix += stride)
        out.push(translate((ix - 1) * sx - rx, (iy - 1) * sy - ry, 1));
    return out.length ? out : [IDENTITY];
  }

  const r = p.reach;
  if (r <= 0) return [IDENTITY];
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

// Reflection across a line through (cx,cy) at angle `theta` (radians). The
// reflection matrix about a line at angle t is [[cos2t, sin2t],[sin2t, -cos2t]].
function reflectAcrossLine(theta: number, cx: number, cy: number): Transform {
  const a = Math.cos(2 * theta);
  const b = Math.sin(2 * theta);
  const c = Math.sin(2 * theta);
  const d = -Math.cos(2 * theta);
  const e = cx - (a * cx + c * cy);
  const f = cy - (b * cx + d * cy);
  return { a, b, c, d, e, f, aMul: 1 };
}

// Mirror: the master plus one reflection across a line through the centre at
// `angle` degrees. 90 = vertical (flips left/right), 0 = horizontal, between =
// a diagonal mirror.
export function mirrorTransforms(
  p: MirrorParams,
  cx: number,
  cy: number,
): Transform[] {
  return [IDENTITY, reflectAcrossLine((p.angle * Math.PI) / 180, cx, cy)];
}

// scale * R(theta), as an affine fixing (cx,cy). Shared by Concentric + Spiral.
function scaleRotateAbout(
  scale: number,
  theta: number,
  cx: number,
  cy: number,
): Transform {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const a = scale * cos;
  const b = scale * sin;
  const c = -scale * sin;
  const d = scale * cos;
  return { a, b, c, d, e: cx - (a * cx + c * cy), f: cy - (b * cx + d * cy), aMul: 1 };
}

// Concentric: `rings` copies about (cx,cy), each scaled by scalePct% of the
// previous and rotated by `twist` degrees. The first copy is the identity
// (k=0: scale 1, rotation 0), so the master stroke is included.
export function concentricTransforms(
  p: ConcentricParams,
  cx: number,
  cy: number,
): Transform[] {
  const rings = Math.max(1, Math.floor(p.rings));
  const step = p.scalePct / 100;
  const twist = (p.twist * Math.PI) / 180;
  const out: Transform[] = [];
  let scale = 1;
  for (let k = 0; k < rings; k++) {
    out.push(scaleRotateAbout(scale, twist * k, cx, cy));
    scale *= step;
  }
  return out.length ? out : [IDENTITY];
}

// Cap so a long copy count (× arms) can't melt the live redraw / point cloud.
const MAX_SPIRAL_COPIES = 120;

// Spiral: `arms` copies of a log spiral about (cx,cy). Within each arm, copy k is
// rotated by k·angleStep and scaled by scalePct^k; arms are spread evenly around
// the centre. Arm 0 / copy 0 is the identity, so the master stroke is included.
export function spiralTransforms(
  p: SpiralParams,
  cx: number,
  cy: number,
): Transform[] {
  const arms = Math.max(1, Math.floor(p.arms));
  const perArm = Math.min(
    Math.max(1, Math.floor(p.copies)),
    Math.max(1, Math.floor(MAX_SPIRAL_COPIES / arms)),
  );
  const da = (p.angleStep * Math.PI) / 180;
  const step = p.scalePct / 100;
  const out: Transform[] = [];
  for (let m = 0; m < arms; m++) {
    const arm0 = (m * 2 * Math.PI) / arms;
    let scale = 1;
    for (let k = 0; k < perArm; k++) {
      out.push(scaleRotateAbout(scale, arm0 + k * da, cx, cy));
      scale *= step;
    }
  }
  return out.length ? out : [IDENTITY];
}

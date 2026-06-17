// Affine primitives shared by every symmetry tool. A Transform is an affine map
//   x' = a*x + c*y + e ;  y' = b*x + d*y + f
// plus an opacity multiplier for that copy. Each tool (src/symmetry/tools/*)
// composes these builders into its own list of copies - the per-mode logic
// lives in the tool, not here.
export type Transform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  aMul: number; // opacity multiplier for this copy (1 = full)
};

export const IDENTITY: Transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, aMul: 1 };

export function isIdentity(t: Transform): boolean {
  return t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1 && t.e === 0 && t.f === 0;
}

// True when the transform list does nothing (symmetry off) - a single identity.
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

// ---- affine builders (compose these in a tool's transforms()) --------------

// Pure translation by (dx,dy), carrying an opacity multiplier (Tile fades).
export function translate(dx: number, dy: number, aMul: number): Transform {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy, aMul };
}

// Rotation by `theta` about (cx,cy), optionally pre-reflected across the x-axis
// through the centre. The building block for Radial.
//   R(theta): [[cos,-sin],[sin,cos]];  R(theta)*reflectX: [[cos,sin],[sin,-cos]]
export function rotateReflect(theta: number, flip: boolean, cx: number, cy: number): Transform {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const a = cos;
  const b = sin;
  const c = flip ? sin : -sin;
  const d = flip ? -cos : cos;
  return { a, b, c, d, e: cx - (a * cx + c * cy), f: cy - (b * cx + d * cy), aMul: 1 };
}

// Reflection across a line through (cx,cy) at angle `theta` (radians). The
// reflection matrix about a line at angle t is [[cos2t, sin2t],[sin2t, -cos2t]].
// The building block for Mirror.
export function reflectAcrossLine(theta: number, cx: number, cy: number): Transform {
  const a = Math.cos(2 * theta);
  const b = Math.sin(2 * theta);
  const c = Math.sin(2 * theta);
  const d = -Math.cos(2 * theta);
  return { a, b, c, d, e: cx - (a * cx + c * cy), f: cy - (b * cx + d * cy), aMul: 1 };
}

// scale * R(theta), as an affine fixing (cx,cy). The building block for
// Concentric and Spiral.
export function scaleRotateAbout(scale: number, theta: number, cx: number, cy: number): Transform {
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const a = scale * cos;
  const b = scale * sin;
  const c = -scale * sin;
  const d = scale * cos;
  return { a, b, c, d, e: cx - (a * cx + c * cy), f: cy - (b * cx + d * cy), aMul: 1 };
}

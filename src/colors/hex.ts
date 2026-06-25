// The single hex -> RGB parse, shared by the gradient blender (parseHex) and the
// OKLCH / HSV converters - they all expanded #rgb to #rrggbb, parsed the 6 hex
// digits, and split into bytes by hand. Accepts a leading # or not, #rgb or
// #rrggbb (an 8-digit #rrggbbaa has its alpha ignored); anything invalid yields
// [0, 0, 0]. Returns the [r, g, b] channels as 0-255 integers.
export function hexToRgb(hex: string): [number, number, number] {
  let s = hex.trim().replace(/^#/, "");
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = /^[0-9a-f]{6,8}$/i.test(s) ? parseInt(s.slice(0, 6), 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

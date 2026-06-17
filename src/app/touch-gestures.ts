import type { Viewport } from "./viewport";

// Two-finger touch gestures over the viewport: pan (drag), pinch (zoom) and
// twist (rotate) at once, all about the fingers' midpoint. One finger draws
// (handled by the drawing input). The moment a 2nd finger lands we commit the
// in-progress 1-finger stroke (onGestureBegin) and take over the camera until
// every finger lifts - so the leftover finger never resumes drawing.
//
// A 2-finger *tap* (no travel) stays the undo gesture (see shortcuts.ts): we
// only move the camera once the fingers actually move, and the tap detector
// there ignores a gesture that moved. `active()` lets the drawing input bail on
// touch while the camera owns the gesture (covers either event order).
export function bindTouchGestures(opts: {
  viewportEl: HTMLElement;
  viewport: Viewport;
  onGestureBegin: () => void; // commit/clear the active 1-finger stroke
}): { active: () => boolean } {
  const { viewportEl, viewport } = opts;
  let active = false; // 2-finger camera control engaged (until all fingers lift)
  // The previous frame's two finger positions, or null until (re)anchored.
  let prev: { ax: number; ay: number; bx: number; by: number } | null = null;

  const snapshot = (e: TouchEvent) => {
    const a = e.touches[0];
    const b = e.touches[1];
    return { ax: a.clientX, ay: a.clientY, bx: b.clientX, by: b.clientY };
  };

  const onStart = (e: TouchEvent) => {
    if (e.touches.length < 2) return;
    if (!active) {
      active = true;
      opts.onGestureBegin();
    }
    prev = snapshot(e); // (re)anchor so a 2->1->2 finger change doesn't jump
  };

  const onMove = (e: TouchEvent) => {
    if (!active || e.touches.length !== 2) return;
    e.preventDefault();
    if (!prev) {
      prev = snapshot(e);
      return;
    }
    const cur = snapshot(e);
    const cpx = (prev.ax + prev.bx) / 2;
    const cpy = (prev.ay + prev.by) / 2;
    const ccx = (cur.ax + cur.bx) / 2;
    const ccy = (cur.ay + cur.by) / 2;
    const dp = Math.hypot(prev.bx - prev.ax, prev.by - prev.ay);
    const dc = Math.hypot(cur.bx - cur.ax, cur.by - cur.ay);
    const ap = Math.atan2(prev.by - prev.ay, prev.bx - prev.ax);
    const ac = Math.atan2(cur.by - cur.ay, cur.bx - cur.ax);
    let dAng = ac - ap;
    if (dAng > Math.PI) dAng -= 2 * Math.PI;
    if (dAng < -Math.PI) dAng += 2 * Math.PI;

    viewport.panBy(ccx - cpx, ccy - cpy);
    if (dp > 0) viewport.zoomAt(ccx, ccy, dc / dp);
    viewport.rotateBy(dAng, ccx, ccy);
    prev = cur;
  };

  const onEnd = (e: TouchEvent) => {
    if (e.touches.length === 0) {
      active = false;
      prev = null;
    } else if (e.touches.length < 2) {
      prev = null; // wait to re-anchor when a 2nd finger returns
    }
  };

  viewportEl.addEventListener("touchstart", onStart, { passive: true });
  viewportEl.addEventListener("touchmove", onMove, { passive: false });
  viewportEl.addEventListener("touchend", onEnd);
  viewportEl.addEventListener("touchcancel", onEnd);

  return { active: () => active };
}

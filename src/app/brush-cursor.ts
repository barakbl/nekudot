import { Overlay } from "./overlay";
import type { CanvasSize } from "../canvas-size";
import type { Store } from "../store/base";
import type { Viewport } from "./viewport";

// How the canvas cursor reads, chosen in App settings:
//   size-reach  - a ring at the brush's painted size + a dashed web-reach ring
//   cross-reach - the OS crosshair + the dashed web-reach ring
//   size        - just the brush-size ring
//   cross       - just the OS crosshair (the classic precise cursor)
export type BrushCursorMode = "size-reach" | "cross-reach" | "size" | "cross";

export const CURSOR_STORE_KEY = "app.cursor";
const DEFAULT_MODE: BrushCursorMode = "size-reach";

// Which parts a mode draws: the brush-size ring, the dashed web-reach ring, and
// whether it uses the OS crosshair (size and cross are the two mutually exclusive
// "primary" indicators; reach is an add-on).
export function cursorModeParts(mode: BrushCursorMode): {
  size: boolean;
  reach: boolean;
  cross: boolean;
} {
  return {
    size: mode === "size-reach" || mode === "size",
    reach: mode === "size-reach" || mode === "cross-reach",
    cross: mode === "cross-reach" || mode === "cross",
  };
}

// A lightweight cursor preview. It lives on an Overlay stacked over the layer
// canvases (a child of the transformed stage), so it rides the camera for free:
// drawn in canvas pixels, the rings' on-screen size always matches the painted
// dab / web reach under pan/zoom/rotate. Only the outlines are un-scaled
// (1/scale) so they stay hairlines at any zoom, and mix-blend-mode "difference"
// keeps them visible on any colour underneath. Mouse/pen hover only - a finger
// has no hover cursor, so touch hides it.
export function createBrushCursor(deps: {
  stage: HTMLElement;
  dpr: number;
  initialCanvasSize: CanvasSize;
  viewport: Viewport;
  store: Store;
  brushRadius: () => number; // painted radius in canvas px (strokeWidth / 2)
}) {
  const { stage, dpr, initialCanvasSize, viewport, store, brushRadius } = deps;

  // Below the invisible-brush glow (9999) / symmetry guides (9998) so those read
  // over the ring, but above the layer canvases.
  const overlay = new Overlay(stage, dpr, 9997, initialCanvasSize, { hidden: true });
  overlay.el.style.mixBlendMode = "difference";

  const SIZE_HAIRLINE = 1.5; // brush-size ring thickness on screen, in CSS px
  const REACH_HAIRLINE = 1; // reach ring is thinner + fainter (a secondary hint)

  let mode: BrushCursorMode =
    store.get<BrushCursorMode>(CURSOR_STORE_KEY) ?? DEFAULT_MODE;
  // The active brush's web reach in canvas px (0 = no web); injected from main
  // once the brush state exists.
  let reachSource: () => number = () => 0;
  // Last hover position in screen (client) coords, or null when nothing hovers.
  // Kept so a camera change can re-place the rings under the same point.
  let last: { clientX: number; clientY: number } | null = null;

  const parts = () => cursorModeParts(mode);
  const hasRings = () => parts().size || parts().reach;

  const draw = (): void => {
    const r = overlay.renderer;
    r.clear();
    if (!last || !hasRings()) return;
    const { x, y } = viewport.toCanvas(last.clientX, last.clientY);
    const scale = viewport.scale;
    const { size: showSize, reach: showReach } = parts();
    const sizeR = brushRadius();
    if (showSize && sizeR > 0) {
      r.strokeCircle(x, y, sizeR, { color: "#fff", width: SIZE_HAIRLINE / scale });
    }
    if (showReach) {
      const reach = reachSource();
      // Only when the web actually reaches past the brush footprint - otherwise
      // the reach ring hides inside the size ring and just adds noise.
      if (reach > sizeR) {
        r.strokeCircle(x, y, reach, {
          color: "#fff",
          alpha: 0.6,
          width: REACH_HAIRLINE / scale,
          dash: [5 / scale, 5 / scale],
        });
      }
    }
  };

  const hide = (): void => {
    last = null;
    overlay.setVisible(false);
    overlay.renderer.clear();
  };

  // Native crosshair for the cross modes; hidden (the ring is the cursor) for the
  // size modes so the two indicators don't double up.
  const applyStageCursor = (): void => {
    stage.style.cursor = parts().cross ? "crosshair" : "none";
  };
  applyStageCursor();

  stage.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return hide();
    last = { clientX: e.clientX, clientY: e.clientY };
    overlay.setVisible(hasRings());
    draw();
  });
  stage.addEventListener("pointerleave", hide);
  stage.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") hide();
  });

  return {
    redraw: draw, // call after a camera change or a brush-size change
    resize: (size: CanvasSize): void => {
      overlay.resize(size);
      draw();
    },
    // Live source for the active brush's web reach (canvas px). Wired from main
    // once appState exists.
    setReach: (fn: () => number): void => {
      reachSource = fn;
    },
    setMode: (next: BrushCursorMode): void => {
      mode = next;
      applyStageCursor();
      if (last && hasRings()) {
        overlay.setVisible(true);
        draw();
      } else {
        overlay.setVisible(false);
        overlay.renderer.clear();
      }
    },
    mode: (): BrushCursorMode => mode,
  };
}

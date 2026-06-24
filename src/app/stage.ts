import {
  clampSize,
  fullScreenSize,
  safeLoadSize,
  type CanvasSize,
} from "../canvas-size";
import type { Theme } from "../menu";
import type { Store } from "../store/base";

const BORDER = 2;
const CANVAS_SIZE_KEY = "app.canvas.size";

// Build the fixed full-window viewport + the transformed stage it holds, size
// the initial canvas (persisted and clamped to the window, else full-window),
// and apply any saved theme before any UI renders. Pure DOM scaffold + sizing;
// returns the handles the rest of boot wires onto.
export function createStage({ store }: { store: Store }) {
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.style.minHeight = "100vh";

  const dpr = window.devicePixelRatio || 1;
  const screenMax = (): CanvasSize => ({
    width: Math.max(1, window.innerWidth - BORDER * 2),
    height: Math.max(1, window.innerHeight - BORDER * 2),
  });

  const persistedSize = safeLoadSize(store.get<unknown>(CANVAS_SIZE_KEY));
  const initialCanvasSize: CanvasSize = (() => {
    const max = screenMax();
    return persistedSize
      ? clampSize(persistedSize, max.width, max.height)
      : fullScreenSize(max.width, max.height);
  })();

  // The viewport is a fixed full-window container; the camera (Viewport) pans /
  // zooms / rotates the stage inside it via a CSS transform. The stage sits at
  // 0,0 with transform-origin 0,0 so the camera matrix maps canvas px -> screen.
  const viewportEl = document.createElement("div");
  viewportEl.className = "viewport";
  viewportEl.style.position = "fixed";
  viewportEl.style.inset = "0";
  viewportEl.style.overflow = "hidden";
  viewportEl.style.touchAction = "none";
  document.body.appendChild(viewportEl);

  const stage = document.createElement("div");
  stage.className = "stage";
  stage.style.position = "absolute";
  stage.style.left = "0";
  stage.style.top = "0";
  stage.style.transformOrigin = "0 0";
  // Own stacking context so the stage's high-z overlays (symmetry guides, the
  // map flash, the invisible-brush glow) stay above the drawing layers but BELOW
  // the body-level toolbar and panels - without it they'd paint over the UI.
  stage.style.zIndex = "0";
  stage.style.touchAction = "none";
  stage.style.cursor = "crosshair"; // drawing-app style precise cursor
  viewportEl.appendChild(stage);

  // Apply saved theme before any UI renders
  const savedTheme = store.get<Theme>("app.theme") ?? "auto";
  if (savedTheme !== "auto") {
    document.documentElement.dataset.theme = savedTheme;
  }

  return {
    viewportEl,
    stage,
    dpr,
    screenMax,
    initialCanvasSize,
    CANVAS_SIZE_KEY,
    savedTheme,
    BORDER,
  };
}

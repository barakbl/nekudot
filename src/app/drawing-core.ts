import { Overlay } from "./overlay";
import { createMapHighlighter } from "./map-highlight";
import type { CanvasSize } from "../canvas-size";
import type { LayerManager } from "../layered/manager";
import type { Store } from "../store/base";
import type { SymmetryController } from "../symmetry/controller";
import type { Viewport } from "./viewport";

// The on-stage drawing overlays + the symmetry-guide wiring + the new-canvas
// resize/reframe. The symmetry CONTROLLER and the symmetry PROXY stay in main
// (the proxy is the brushes' host, constructed right before the brush loop that
// consumes it); this owns only the visual overlays the controller drives.
export function createDrawingCore(deps: {
  stage: HTMLElement;
  dpr: number;
  initialCanvasSize: CanvasSize;
  layerManager: LayerManager;
  store: Store;
  symmetry: SymmetryController;
  viewport: Viewport;
}) {
  const { stage, dpr, initialCanvasSize, layerManager, store, symmetry, viewport } = deps;

  // Transient overlay above all layer canvases - used by InvisibleBrush to
  // briefly glow each newly-added pixel without leaving a permanent mark. The
  // brush only ever talks to an IRenderer; the Overlay owns the canvas wiring.
  const invisibleOverlay = new Overlay(stage, dpr, 9999, initialCanvasSize);

  // Static overlay (one z-index below the invisible glow) that shows the symmetry
  // guide lines (tile lattice / radial spokes / mirror line) while a symmetry mode
  // is active. Visual help, not paint.
  const symmetryOverlay = new Overlay(stage, dpr, 9998, initialCanvasSize, {
    hidden: true,
  });

  // Top-most highlight of a neighbors map's dots, asked for by the Maps box/pill:
  // a one-shot Flash, plus a persistent "hot map" pin (active map's dots held
  // visible while drawing). Restore the pinned state and keep it re-rendered as the
  // active map / its points change (camera moves need no refresh - it rides the
  // transformed stage).
  const mapHighlighter = createMapHighlighter(stage, layerManager, dpr);
  const storedHighlightColor = store.get<string>("app.maps.highlightColor");
  if (storedHighlightColor) mapHighlighter.setColor(storedHighlightColor);
  if (store.get<boolean>("app.maps.pinHighlight")) mapHighlighter.setPinned(true);
  layerManager.subscribe(() => mapHighlighter.refresh());

  // Symmetry guide overlay: the tile lattice, radial spokes or mirror line, shown
  // whenever a symmetry mode is active. Brush-independent - driven by the controller.
  const updateSymmetryOverlay = () => {
    if (symmetry.active()) {
      symmetryOverlay.setVisible(true);
      symmetry.drawGuides(symmetryOverlay.renderer, symmetryOverlay.size);
    } else {
      symmetryOverlay.setVisible(false);
      symmetryOverlay.renderer.clear();
    }
  };
  symmetry.subscribe(updateSymmetryOverlay);
  updateSymmetryOverlay();

  // A new canvas was opened (New art / mandala / blank / Load artwork): resize the
  // overlays to match, and re-frame the camera. Without the reframe the camera
  // stays laid out for the *previous* canvas size, so the new canvas lands
  // off-centre or partly off-screen until you hit "Reset view" - exactly what the
  // camera-reset button does, just done automatically here.
  const applyNewCanvasSize = (size: CanvasSize) => {
    invisibleOverlay.resize(size);
    symmetryOverlay.resize(size);
    updateSymmetryOverlay();
    mapHighlighter.refresh(); // re-fit the pinned highlight to the new canvas
    viewport.reset();
  };

  return {
    invisibleOverlay,
    symmetryOverlay,
    mapHighlighter,
    updateSymmetryOverlay,
    applyNewCanvasSize,
  };
}

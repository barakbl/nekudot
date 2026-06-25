import type { LayerManager } from "../layered/manager";
import { sizeCanvasForDpr } from "../canvas-size";

const DEFAULT_COLOR = "#22d3ee"; // cyan accent — reads on light + dark
const DURATION = 2500;

export type MapHighlighter = {
  // One-shot pulse of a map's dots (the navbar Flash button + per-map flash).
  flash: (index: number) => void;
  // Persistent "hot map": keep the ACTIVE map's dots quietly visible while you
  // draw, so you can see what the brush will connect to. setPinned toggles it;
  // refresh re-renders it (active map switched, points added by a stroke, canvas
  // resized). Camera pan/zoom/rotate needs no refresh - the overlay is a child of
  // the transformed stage, so it moves with the canvas.
  setPinned: (on: boolean) => void;
  isPinned: () => boolean;
  refresh: () => void;
  // Dot colour, shared by the flash and the pinned highlight (set from the Maps
  // box). Changing it recolours the pinned dots immediately.
  getColor: () => string;
  setColor: (hex: string) => void;
};

// Two top-most, click-through overlay canvases over the live canvas: a transient
// flash (thicker glowing dots that pulse then fade) and a persistent pin (subtle
// static dots). The flash sits above the pin so a flash still reads when pinned.
export function createMapHighlighter(
  stage: HTMLElement,
  layerManager: LayerManager,
  dpr: number,
): MapHighlighter {
  const makeOverlay = (z: number): HTMLCanvasElement => {
    const c = document.createElement("canvas");
    c.style.position = "absolute";
    c.style.left = "0";
    c.style.top = "0";
    c.style.pointerEvents = "none";
    c.style.zIndex = String(z);
    stage.appendChild(c);
    return c;
  };
  // Match a canvas to the live canvas size; only reallocate when it actually
  // changes (setting width/height clears the bitmap).
  const ensureSize = (c: HTMLCanvasElement): void => {
    const size = layerManager.currentSize;
    const w = Math.round(size.width * dpr);
    const h = Math.round(size.height * dpr);
    // Guard so we only clear the bitmap (width/height write) when the size changed.
    if (c.width !== w || c.height !== h) {
      sizeCanvasForDpr(c, size.width, size.height, dpr);
    }
  };

  let color = DEFAULT_COLOR; // shared by flash + pin

  // --- one-shot flash --------------------------------------------------------
  const flashOverlay = makeOverlay(10000);
  let token = 0; // bump to cancel any in-flight flash
  const flash = (index: number): void => {
    const nm = layerManager.allNeighborsMaps[index];
    const ctx = flashOverlay.getContext("2d");
    if (!nm || !ctx) return;
    const pts = nm.finder.allPixels();
    ensureSize(flashOverlay);

    // Pre-render the glowing dots once at full strength; the loop only flickers
    // overall opacity (cheap even for thousands of points).
    const off = document.createElement("canvas");
    off.width = flashOverlay.width;
    off.height = flashOverlay.height;
    const octx = off.getContext("2d");
    if (octx) {
      octx.scale(dpr, dpr);
      octx.fillStyle = color;
      octx.shadowColor = color;
      octx.shadowBlur = 6;
      for (const p of pts) {
        octx.beginPath();
        octx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        octx.fill();
      }
    }

    const flashToken = ++token;
    const start = performance.now();
    const clear = () => ctx.clearRect(0, 0, flashOverlay.width, flashOverlay.height);
    const frame = (now: number) => {
      if (flashToken !== token) return; // a newer flash took over
      const t = (now - start) / DURATION;
      if (t >= 1) {
        clear();
        return;
      }
      const fadeIn = Math.min(1, t / 0.08);
      const fadeOut = t > 0.7 ? (1 - t) / 0.3 : 1;
      const flicker = 0.55 + 0.45 * Math.sin(t * Math.PI * 10); // ~5 pulses
      clear();
      ctx.globalAlpha = Math.max(0, 0.75 * fadeIn * fadeOut * flicker);
      ctx.drawImage(off, 0, 0);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  // --- persistent pin (subtle static dots of the active map) -----------------
  const pinOverlay = makeOverlay(9999); // just below the flash
  let pinned = false;
  const renderPinned = (): void => {
    const ctx = pinOverlay.getContext("2d");
    if (!ctx) return;
    ensureSize(pinOverlay);
    ctx.clearRect(0, 0, pinOverlay.width, pinOverlay.height);
    if (!pinned) return;
    const nm = layerManager.allNeighborsMaps[layerManager.selectedNeighborsMapIdx];
    if (!nm) return;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.4; // quietly present, not distracting
    for (const p of nm.finder.allPixels()) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };

  return {
    flash,
    isPinned: () => pinned,
    setPinned: (on: boolean) => {
      pinned = on;
      renderPinned();
    },
    refresh: () => {
      if (pinned) renderPinned();
    },
    getColor: () => color,
    setColor: (hex: string) => {
      color = hex;
      renderPinned(); // recolour the pinned dots now (flash picks it up next time)
    },
  };
}

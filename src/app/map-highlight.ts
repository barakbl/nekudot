import type { LayerManager } from "../layered/manager";

const HIGHLIGHT_COLOR = "#22d3ee"; // cyan accent — reads on light + dark
const DURATION = 2500;

// Transient highlight overlay (top-most): flashes a neighbors map's pixels
// over the canvas for a couple of seconds — thicker, glowing dots that pulse,
// then fade. The canvas is created once and sized on demand to the live
// canvas; starting a new flash cancels the one in flight.
export function createMapHighlighter(
  stage: HTMLElement,
  layerManager: LayerManager,
  dpr: number,
): (index: number) => void {
  const overlay = document.createElement("canvas");
  overlay.style.position = "absolute";
  overlay.style.left = "0";
  overlay.style.top = "0";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "10000";
  stage.appendChild(overlay);

  let token = 0; // bump to cancel any in-flight flash

  return (index: number) => {
    const nm = layerManager.allNeighborsMaps[index];
    const ctx = overlay.getContext("2d");
    if (!nm || !ctx) return;
    const pts = nm.finder.allPixels();
    const size = layerManager.currentSize;
    overlay.width = Math.round(size.width * dpr);
    overlay.height = Math.round(size.height * dpr);
    overlay.style.width = `${size.width}px`;
    overlay.style.height = `${size.height}px`;

    // Pre-render the glowing dots once at full strength; the loop only flickers
    // overall opacity (cheap even for thousands of points).
    const off = document.createElement("canvas");
    off.width = overlay.width;
    off.height = overlay.height;
    const octx = off.getContext("2d");
    if (octx) {
      octx.scale(dpr, dpr);
      octx.fillStyle = HIGHLIGHT_COLOR;
      octx.shadowColor = HIGHLIGHT_COLOR;
      octx.shadowBlur = 6;
      for (const p of pts) {
        octx.beginPath();
        octx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        octx.fill();
      }
    }

    const flashToken = ++token;
    const start = performance.now();
    const clear = () => ctx.clearRect(0, 0, overlay.width, overlay.height);
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
}

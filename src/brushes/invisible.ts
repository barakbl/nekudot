import { BrushBase, type BrushSetting } from "../base";
import type { IRenderer } from "../renderer";
import type { Pixel } from "../neighbor-finder";
import type { PaintHost } from "../paint-host";
import type { Store } from "../store/base";
import type { BrushContext } from "./registry";

const GLOW_DURATION_MS = 1000;
const GLOW_RADIUS_PX = 6;
const GLOW_COLOR = "#ffcc33";

export const icon =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-dasharray="2 2" aria-hidden="true">' +
  '<circle cx="8" cy="8" r="5"/>' +
  "</svg>";

export function create(c: BrushContext): InvisibleBrush {
  return new InvisibleBrush(c.host, c.getInvisibleOverlay, undefined, c.store);
}

type GlowDot = { x: number; y: number; t: number };

export class InvisibleBrush extends BrushBase {
  // Resolved via getter so a resize can swap in a fresh renderer without the
  // brush needing to know about canvas/context internals.
  private getOverlayRenderer: () => IRenderer;
  private dots: GlowDot[] = [];
  private animFrame: number | null = null;

  constructor(
    host: PaintHost,
    getOverlayRenderer: () => IRenderer,
    seed?: number,
    store?: Store,
  ) {
    super(host, seed, store);
    this.getOverlayRenderer = getOverlayRenderer;
  }

  name() {
    return "Invisible";
  }

  // Pixels go into the finder, no paint on the layer canvas, no connections
  // (it attaches no preset).
  protected onStroke(x: number, y: number, _current: Pixel): void {
    this.dots.push({ x, y, t: performance.now() });
    if (this.animFrame === null) {
      this.animFrame = requestAnimationFrame(this.tick);
    }
  }

  getSettings(): BrushSetting[] {
    return [];
  }

  clear(): void {
    super.clear();
    this.dots = [];
    if (this.animFrame !== null) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    this.getOverlayRenderer().clear();
  }

  private tick = (): void => {
    this.animFrame = null;
    const now = performance.now();
    this.dots = this.dots.filter((d) => now - d.t < GLOW_DURATION_MS);

    const r = this.getOverlayRenderer();
    r.clear();
    for (const d of this.dots) {
      const age = now - d.t;
      const alpha = Math.max(0, 1 - age / GLOW_DURATION_MS);
      r.fillCircle(d.x, d.y, GLOW_RADIUS_PX, GLOW_COLOR, alpha);
    }

    if (this.dots.length > 0) {
      this.animFrame = requestAnimationFrame(this.tick);
    }
  };
}

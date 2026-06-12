import { BrushBase } from "../base";
import type { Pixel } from "../neighbor-finder";
import type { PaintHost } from "../paint-host";
import type { Store } from "../store/base";
import { hasConnection } from "./connections/registry";
import { DEFAULT_ART_STYLE } from "./round";
import type { BrushContext } from "./registry";

// Menu glyph for the toolbar — the classic eraser block.
export const icon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M15 4 L20 9 L11 18 H6 V13 Z"/>' +
  '<path d="M9 18 H20"/>' +
  "</svg>";

export function create(c: BrushContext): EraserBrush {
  return new EraserBrush(c.host, undefined, c.store);
}

// The Eraser: a round-capped line painted in erase mode (destination-out), so it
// wipes the layer instead of drawing. Like Round it can weave connections — but
// while erasing those lines erase too, so you can rub out the connecting web.
// It defaults to the "no connect" routing, so out of the box it's a plain
// eraser; switch "Connect to stroke or map?" on in Connecting settings to also
// erase along connections. Selecting it flips the renderer into erase mode (see
// LayerManager.setEraseMode, driven by erases() in main.ts).
export class EraserBrush extends BrushBase {
  private lastX = 0;
  private lastY = 0;

  constructor(host: PaintHost, seed?: number, store?: Store) {
    super(host, seed, store);
    // Attach a connection so the Connecting combo/box engage like Round, but
    // start with "no connect" routing so the eraser only wipes its own line.
    this.initConnection(DEFAULT_ART_STYLE);
    this.applyRoutingPreset("no_connect");
  }

  name() {
    return "Eraser";
  }

  erases(): boolean {
    return true;
  }

  strokeStart(x: number, y: number): void {
    this.lastX = x;
    this.lastY = y;
  }

  protected onStroke(x: number, y: number, _current: Pixel): void {
    this.renderer.drawLine(
      { id: 0, x: this.lastX, y: this.lastY },
      { id: 0, x, y },
      { cap: "round" },
    );
    this.lastX = x;
    this.lastY = y;
  }

  // Match the navbar Connecting combo so a chosen art style applies to the
  // erased web too; routing (the "no connect" default) is preserved across the
  // swap. Falls back to the default style until a custom preset finishes loading.
  onSelect(): void {
    const name = this.store?.get<string>("app.artStyle") ?? DEFAULT_ART_STYLE;
    this.applyArtStylePreset(hasConnection(name) ? name : DEFAULT_ART_STYLE);
  }

  // Erase at full strength regardless of the connection style's stroke alpha.
  getSelectOpacity(): number {
    return 1;
  }
}

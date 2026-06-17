import { SymmetryTool, type SymSetting, type ToolContext } from "../tool";
import type { IRenderer } from "../../renderer";
import { type Transform, IDENTITY, translate } from "../transforms";

// Cap on tile copies so a small spacing + large reach can't explode the live
// redraw. Fill mode legitimately needs far more (whole canvas) but stays bounded.
const MAX_TILE_COPIES = 120;
const MAX_TILE_FILL_COPIES = 1600;

export const icon =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2.4" y="2.4" width="4.6" height="4.6" rx="0.8"/><rect x="9" y="2.4" width="4.6" height="4.6" rx="0.8"/><rect x="2.4" y="9" width="4.6" height="4.6" rx="0.8"/><rect x="9" y="9" width="4.6" height="4.6" rx="0.8"/></svg>';

// Tile: translated copies across a lattice (anchored to the stroke start), or
// the whole canvas at full strength. The one tool that pivots on the stroke,
// not the shared centre - so usesCentre stays false.
class TileTool extends SymmetryTool {
  xSpacing = 40;
  ySpacing = 40;
  reach = 140;
  falloffPct = 70;
  fillCanvas = false;

  // Translated copies to each junction within `reach` of the anchor (the
  // junction nearest the stroke start), faded toward the edge. With fillCanvas,
  // instead tile the whole canvas at full strength.
  transforms(ctx: ToolContext): Transform[] {
    const sx = this.xSpacing;
    const sy = this.ySpacing;
    if (sx <= 0 || sy <= 0) return [IDENTITY];
    const { startX, startY, size } = ctx;
    const rx = Math.round(startX / sx) * sx; // anchor = nearest junction to start
    const ry = Math.round(startY / sy) * sy;

    // Fill: a full-opacity copy at every grid junction across the canvas (one
    // cell of margin so edge tiles aren't clipped). If denser than the budget,
    // step over junctions uniformly so coverage stays even, not clustered.
    if (this.fillCanvas) {
      const nx = Math.ceil(size.width / sx) + 3;
      const ny = Math.ceil(size.height / sy) + 3;
      const stride = Math.max(1, Math.ceil(Math.sqrt((nx * ny) / MAX_TILE_FILL_COPIES)));
      const out: Transform[] = [];
      for (let iy = 0; iy < ny; iy += stride)
        for (let ix = 0; ix < nx; ix += stride)
          out.push(translate((ix - 1) * sx - rx, (iy - 1) * sy - ry, 1));
      return out.length ? out : [IDENTITY];
    }

    const r = this.reach;
    if (r <= 0) return [IDENTITY];
    const power = (this.falloffPct / 100) * 2.5;
    const spanX = Math.ceil(r / sx) * sx;
    const spanY = Math.ceil(r / sy) * sy;
    const out: Transform[] = [];
    for (let jy = ry - spanY; jy <= ry + spanY; jy += sy) {
      for (let jx = rx - spanX; jx <= rx + spanX; jx += sx) {
        const dist = Math.hypot(jx - rx, jy - ry);
        if (dist > r) continue;
        const aMul = Math.pow(1 - dist / r, power); // 1 at the anchor, 0 at the edge
        if (aMul <= 0) continue;
        out.push(translate(jx - rx, jy - ry, aMul));
      }
    }
    if (out.length > MAX_TILE_COPIES) {
      out.sort((p1, p2) => p2.aMul - p1.aMul); // keep the strongest (nearest) copies
      out.length = MAX_TILE_COPIES;
    }
    return out.length ? out : [IDENTITY];
  }

  // Fill canvas draws a copy in every tile but must NOT deposit them all, or a
  // full-canvas stroke would evict the point cloud (see proxy / neighbor-finder).
  mirrorsPoints(): boolean {
    return !this.fillCanvas;
  }

  settings(): SymSetting[] {
    return [
      {
        kind: "slider",
        key: "xSpacing",
        label: "X spacing",
        min: 10,
        max: 200,
        value: this.xSpacing,
        onChange: (v) => (this.xSpacing = v),
      },
      {
        kind: "slider",
        key: "ySpacing",
        label: "Y spacing",
        min: 10,
        max: 200,
        value: this.ySpacing,
        onChange: (v) => (this.ySpacing = v),
      },
      {
        kind: "toggle",
        key: "fillCanvas",
        label: "Fill canvas",
        value: this.fillCanvas,
        onChange: (v) => (this.fillCanvas = v),
        help: "Tile the motif across the whole canvas at full strength instead of a faded patch - Reach and Falloff then don't apply. Best with a small motif.",
      },
      // Reach + Falloff only shape the faded patch; grey them out under Fill canvas.
      {
        kind: "slider",
        key: "reach",
        label: "Reach",
        min: 20,
        max: 800,
        value: this.reach,
        disabled: this.fillCanvas,
        onChange: (v) => (this.reach = v),
        help: "How far the tiling spreads out from where you started, in pixels.",
      },
      {
        kind: "slider",
        key: "falloffPct",
        label: "Falloff",
        min: 0,
        max: 100,
        value: this.falloffPct,
        disabled: this.fillCanvas,
        onChange: (v) => (this.falloffPct = v),
        help: "How sharply copies fade toward the reach edge. 0 = even; higher = a soft vignette.",
      },
    ];
  }

  drawGuides(r: IRenderer, ctx: ToolContext): void {
    const { size, guide } = ctx;
    const sx = this.xSpacing;
    const sy = this.ySpacing;
    if (sx <= 0 || sy <= 0) return;
    const { width: w, height: h } = size;
    for (let x = 0; x <= w; x += sx)
      r.drawLine({ id: 0, x, y: 0 }, { id: 0, x, y: h }, guide);
    for (let y = 0; y <= h; y += sy)
      r.drawLine({ id: 0, x: 0, y }, { id: 0, x: w, y }, guide);
  }
}

export const create = () => new TileTool();

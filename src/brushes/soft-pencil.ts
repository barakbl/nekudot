import { BrushBase, type BrushSetting } from "../base";
import type { IRenderer } from "../renderer";
import type { NeighborFinder } from "../neighbor-finder";
import type { Store } from "../store/base";

// Port of mrdoob's Harmony "shaded" brush. There is no solid core — the mark is
// made entirely of faint connecting lines to nearby points whose alpha fades
// with distance (the "shaded" art-style preset), so scribbling builds up smooth
// soft-pencil tone. Connecting is handled by the attached preset.
export class SoftPencilBrush extends BrushBase {
  constructor(
    renderer: IRenderer,
    finder: NeighborFinder,
    seed?: number,
    store?: Store,
  ) {
    super(renderer, finder, seed, store);
    this.initConnection("shaded");
  }

  name() {
    return "Soft Pencil";
  }

  // No solid stroke; deposited point + faded connections do all the drawing.
  protected onStroke(): void {}

  onSelect(): void {
    this.applyArtStylePreset("shaded");
  }

  // No solid stroke to dim, so keep global opacity full — the shading comes
  // from the (already low, distance-faded) connection alpha.
  getSelectOpacity(): number {
    return 1;
  }

  getSettings(): BrushSetting[] {
    return this.persistSettings([...(this.connection?.sliders() ?? [])]);
  }
}

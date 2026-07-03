import { attachHelp } from "../help";

// Help hints (press ? to toggle visibility): attach an explanatory bubble to
// each panel's <h3> heading. Pure side effects, run once at boot after the
// panels exist.
const attachToHeading = (panel: HTMLElement, text: string) => {
  const h = panel.querySelector("h3");
  if (h instanceof HTMLElement) attachHelp(h, text);
};

export function registerHelpHints(panels: {
  layersBox: HTMLElement;
  settingsPanel: HTMLElement;
  symmetryBox: HTMLElement;
  mapsBox: HTMLElement;
}): void {
  attachToHeading(
    panels.layersBox,
    "Drawing layers. Each layer holds its own canvas plus its connections sub-layers; the active layer is the target for strokes and connection drawings.",
  );
  attachToHeading(
    panels.settingsPanel,
    "Settings for the selected brush. The Brush tab has size, opacity and brush-specific options; the Web tab (for brushes that weave a web) has routing and the art-style dials. Reset reverts both to defaults.",
  );
  attachToHeading(
    panels.symmetryBox,
    "Repeat every stroke with symmetry: Tile repeats your marks across a lattice, Radial mirrors them around the centre (kaleidoscope), Mirror reflects across one line. Works with any brush.",
  );
  attachToHeading(
    panels.mapsBox,
    "Memory maps remember sets of dots so the Web brush can connect to them. Pick the active map (drawn into now), flash any map to see its dots on the canvas, or rename/add/delete maps.",
  );
}

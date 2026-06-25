import { createPanel } from "../ui/panel";
import type { SymmetryController } from "./controller";
import { makeSymmetrySection } from "./menu-section";

export type SymmetryBox = {
  el: HTMLElement;
  toggle: () => void;
};

// The Symmetry tool's own draggable panel (Tile / Radial / Mirror). Shares the panel
// chrome with the Layers/Maps boxes; the controls come from makeSymmetrySection.
export function createSymmetryBox(controller: SymmetryController): SymmetryBox {
  const { panel } = createPanel({
    className: "layers-box symmetry-box",
    title: "Symmetry",
  });

  panel.appendChild(makeSymmetrySection(controller));

  const toggle = () => {
    panel.style.display = panel.style.display === "none" ? "" : "none";
  };

  return { el: panel, toggle };
}

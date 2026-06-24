import { makeCloseButton } from "../settings-panel";
import { makeDraggable } from "../drag";
import type { SymmetryController } from "./controller";
import { makeSymmetrySection } from "./menu-section";

export type SymmetryBox = {
  el: HTMLElement;
  toggle: () => void;
};

// The Symmetry tool's own draggable panel (Tile / Radial / Mirror). Shares the panel
// chrome with the Layers/Maps boxes; the controls come from makeSymmetrySection.
export function createSymmetryBox(controller: SymmetryController): SymmetryBox {
  const panel = document.createElement("div");
  panel.className = "layers-box symmetry-box";
  panel.style.display = "none";

  const header = document.createElement("div");
  header.className = "panel-header";
  const title = document.createElement("h3");
  title.textContent = "Symmetry";
  header.appendChild(title);
  header.appendChild(
    makeCloseButton(() => {
      panel.style.display = "none";
    }),
  );
  panel.appendChild(header);
  makeDraggable(panel, header);

  panel.appendChild(makeSymmetrySection(controller));

  const toggle = () => {
    panel.style.display = panel.style.display === "none" ? "" : "none";
  };

  return { el: panel, toggle };
}

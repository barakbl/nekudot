import { makeDraggable } from "./drag";
import { makeCloseButton } from "../settings-panel";

// The draggable floating-panel shell shared by the Layers / Maps / Symmetry boxes,
// the App-settings box, and the Shortcuts panel: a `.panel-header` holding an <h3>
// title and a close button, dragged by that header, hidden by default. The close
// button hides the panel unless `onClose` overrides it. Callers append their body
// to the returned `panel`.
//
// The brush settings panel and the colour picker keep their own headers - they add
// extra header-action buttons (preview/reset) or aren't draggable - so they don't
// use this.
export function createPanel(opts: {
  className: string;
  title: string;
  onClose?: () => void;
}): { panel: HTMLElement; header: HTMLElement } {
  const panel = document.createElement("div");
  panel.className = opts.className;
  panel.style.display = "none";
  // Opt this panel into the window-stack's open-cascade + on-screen clamp (see
  // window-stack.ts). Marks only the corner-anchored draggable boxes, not the
  // centered brush-preview window, which positions itself.
  panel.dataset.cascade = "1";

  const header = document.createElement("div");
  header.className = "panel-header";
  const title = document.createElement("h3");
  title.textContent = opts.title;
  header.appendChild(title);
  header.appendChild(
    makeCloseButton(
      opts.onClose ??
        (() => {
          panel.style.display = "none";
        }),
    ),
  );
  panel.appendChild(header);
  makeDraggable(panel, header);

  return { panel, header };
}

import { makeCloseButton } from "../settings-panel";
import { makeDraggable } from "../drag";
import type { LayerManager } from "./manager";
import type { CanvasSize } from "../canvas-size";

export type NeighborsMapBox = {
  el: HTMLElement;
  toggle: () => void;
  render: () => void;
  refreshPreviews: () => void;
  pokePixel: (mapIndex: number, x: number, y: number) => void;
};

const PREVIEW_CSS_W = 72;

export function createNeighborsMapBox(
  manager: LayerManager,
  getCanvasSize: () => CanvasSize,
  getBackgroundColor: () => string = () => "transparent",
  onCommit: (description: string) => void = () => {},
  getDotColor: () => string = () => "rgba(0,0,0,0.7)",
  onHighlightMap: (index: number) => void = () => {},
): NeighborsMapBox {
  const panel = document.createElement("div");
  panel.className = "layers-box neighbors-map-box";
  panel.style.display = "none";

  const header = document.createElement("div");
  header.className = "panel-header";
  const title = document.createElement("h3");
  title.textContent = "Neighbors Maps";
  header.appendChild(title);
  header.appendChild(
    makeCloseButton(() => {
      panel.style.display = "none";
    }),
  );
  panel.appendChild(header);
  makeDraggable(panel, header);

  const list = document.createElement("div");
  list.className = "layers-list";
  panel.appendChild(list);

  const addBtn = document.createElement("button");
  addBtn.className = "layers-add-btn";
  addBtn.type = "button";
  addBtn.textContent = "+ Add map";
  addBtn.addEventListener("click", () => {
    const nm = manager.addNeighborsMap();
    onCommit(`Add ${nm.config.name}`);
  });
  panel.appendChild(addBtn);

  let refreshers: Array<() => void> = [];
  let pokers: Map<number, (x: number, y: number) => void> = new Map();

  const render = () => {
    list.replaceChildren();
    refreshers = [];
    pokers = new Map();
    // Most recent on top, like Layers.
    const items = [...manager.allNeighborsMaps].map((nm, i) => ({ nm, i }));
    items.reverse();
    for (const { i } of items) {
      list.appendChild(
        makeRow(
          manager,
          i,
          refreshers,
          pokers,
          getCanvasSize(),
          getBackgroundColor,
          getDotColor,
          onCommit,
          onHighlightMap,
        ),
      );
    }
  };

  const refreshPreviews = () => {
    for (const fn of refreshers) fn();
  };

  const pokePixel = (mapIndex: number, x: number, y: number) => {
    pokers.get(mapIndex)?.(x, y);
  };

  manager.subscribe(render);
  render();

  const toggle = () => {
    panel.style.display = panel.style.display === "none" ? "" : "none";
  };

  return { el: panel, toggle, render, refreshPreviews, pokePixel };
}

function makeRow(
  manager: LayerManager,
  index: number,
  refreshers: Array<() => void>,
  pokers: Map<number, (x: number, y: number) => void>,
  size: CanvasSize,
  getBgColor: () => string,
  getDotColor: () => string,
  onCommit: (description: string) => void,
  onHighlightMap: (index: number) => void,
): HTMLElement {
  const nm = manager.allNeighborsMaps[index];

  const row = document.createElement("div");
  row.className = "layer-row";
  if (index === manager.selectedNeighborsMapIdx) row.classList.add("active");
  row.addEventListener("click", (e) => {
    if (
      (e.target as HTMLElement).closest(
        "input, button, [contenteditable='true']",
      )
    )
      return;
    manager.selectNeighborsMap(index);
  });

  const { thumb, refresh, pokeDot } = makeDotPreview(
    size,
    () => nm.finder.allPixels().map((p) => ({ x: p.x, y: p.y })),
    getBgColor,
    getDotColor,
  );
  refreshers.push(refresh);
  pokers.set(index, pokeDot);
  row.appendChild(thumb);

  // Per-map options. "Flash on canvas" briefly overlays this map's pixels on
  // the artwork so you can see where they sit.
  const optionsSlot = document.createElement("div");
  optionsSlot.className = "nm-options-slot";
  const flash = document.createElement("button");
  flash.type = "button";
  flash.className = "nm-flash-btn";
  flash.title = "Flash this map's pixels on the canvas";
  flash.innerHTML =
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">' +
    '<circle cx="8" cy="8" r="5.2"/>' +
    '<circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/>' +
    '<path d="M8 0.5 V2.5 M8 13.5 V15.5 M0.5 8 H2.5 M13.5 8 H15.5" stroke-linecap="round"/>' +
    "</svg><span>Flash</span>";
  flash.addEventListener("click", (e) => {
    e.stopPropagation();
    onHighlightMap(index);
  });
  optionsSlot.appendChild(flash);
  row.appendChild(optionsSlot);

  const name = makeEditableName(nm.config.name, (n) => {
    const prev = nm.config.name;
    manager.setNeighborsMapName(index, n);
    onCommit(`Rename ${prev} → ${n}`);
  });
  name.classList.add("layer-name");
  row.appendChild(name);

  const x = document.createElement("button");
  x.type = "button";
  x.className = "sublayer-remove-btn";
  x.textContent = "×";
  const remaining = manager.allNeighborsMaps.length;
  x.disabled = remaining <= 1;
  x.title =
    remaining > 1 ? "Remove" : "At least one neighbors map required";
  x.addEventListener("click", () => {
    const prev = nm.config.name;
    if (manager.removeNeighborsMap(index)) onCommit(`Remove ${prev}`);
  });
  row.appendChild(x);

  return row;
}

function makeDotPreview(
  size: CanvasSize,
  getPoints: () => { x: number; y: number }[],
  getBgColor: () => string,
  getDotColor: () => string,
): {
  thumb: HTMLCanvasElement;
  refresh: () => void;
  pokeDot: (x: number, y: number) => void;
} {
  const ratio = size.width > 0 ? size.height / size.width : 1;
  const cssH = Math.max(8, Math.round(PREVIEW_CSS_W * ratio));
  const dpr = window.devicePixelRatio || 1;

  const thumb = document.createElement("canvas");
  thumb.className = "layer-preview";
  thumb.width = Math.round(PREVIEW_CSS_W * dpr);
  thumb.height = Math.round(cssH * dpr);
  thumb.style.width = `${PREVIEW_CSS_W}px`;
  thumb.style.height = `${cssH}px`;

  const ctx = thumb.getContext("2d");
  const sx = size.width > 0 ? thumb.width / size.width : 1;
  const sy = size.height > 0 ? thumb.height / size.height : 1;

  const drawDot = (x: number, y: number) => {
    if (!ctx) return;
    ctx.fillStyle = getDotColor();
    ctx.fillRect(Math.floor(x * sx), Math.floor(y * sy), 1, 1);
  };

  const refresh = () => {
    if (!ctx) return;
    ctx.fillStyle = getBgColor();
    ctx.fillRect(0, 0, thumb.width, thumb.height);
    for (const p of getPoints()) drawDot(p.x, p.y);
  };
  refresh();
  return { thumb, refresh, pokeDot: drawDot };
}

function makeEditableName(
  initial: string,
  onCommit: (name: string) => void,
): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "editable-name";
  el.textContent = initial;
  el.title = "Double-click to rename";

  el.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    el.contentEditable = "true";
    el.focus();
    document.getSelection()?.selectAllChildren(el);
  });

  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      el.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      el.textContent = initial;
      el.blur();
    }
  });

  el.addEventListener("blur", () => {
    el.contentEditable = "false";
    const next = (el.textContent ?? "").trim();
    if (!next) {
      el.textContent = initial;
      return;
    }
    if (next !== initial) onCommit(next);
  });

  return el;
}

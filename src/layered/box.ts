import { makeCloseButton } from "../settings-panel";
import { makeDraggable } from "../drag";
import { makeToggle } from "../toggle";
import { CONNECTION_LAYER_ICON } from "../connecting-types";
import type { LayerManager } from "./manager";

export type LayersBox = {
  el: HTMLElement;
  toggle: () => void;
  render: () => void;
  refreshPreviews: () => void;
};

const PREVIEW_CSS_W = 36;

// CSS checkerboard for the background swatch when transparency is on.
const CHECKER_CSS =
  "repeating-conic-gradient(#c8c8c8 0% 25%, #fff 0% 50%) 0 0 / 8px 8px";

// Paint a checkerboard onto a preview canvas to signal "no background".
function drawChecker(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const s = Math.max(3, Math.round(6 * (window.devicePixelRatio || 1)));
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#c8c8c8";
  for (let y = 0, ry = 0; y < h; y += s, ry++)
    for (let x = 0, rx = 0; x < w; x += s, rx++)
      if ((rx + ry) % 2 === 0) ctx.fillRect(x, y, s, s);
}

export function createLayersBox(
  manager: LayerManager,
  getBackgroundColor: () => string = () => "transparent",
  onCommit: (description: string) => void = () => {},
  onBackgroundApply: () => void = () => {},
): LayersBox {
  const panel = document.createElement("div");
  panel.className = "layers-box";
  panel.style.display = "none";

  const header = document.createElement("div");
  header.className = "panel-header";
  const title = document.createElement("h3");
  title.textContent = "Layers";
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
  addBtn.textContent = "+ Add layer";
  addBtn.addEventListener("click", () => {
    const layer = manager.addLayer();
    if (layer) onCommit(`Add ${layer.config.name}`);
  });
  panel.appendChild(addBtn);

  let refreshers: Array<() => void> = [];

  const render = () => {
    list.replaceChildren();
    refreshers = [];
    // Render top layer first so the visual order matches z-order.
    const ordered = [...manager.all].sort((a, b) => b.config.index - a.config.index);
    for (const layer of ordered) {
      list.appendChild(
        makeRow(
          manager,
          layer.config.index,
          refreshers,
          getBackgroundColor,
          onCommit,
        ),
      );
    }
    list.appendChild(makeBackgroundRow(manager, onCommit, onBackgroundApply));
    addBtn.disabled = !manager.canAddMore();
  };

  const refreshPreviews = () => {
    for (const fn of refreshers) fn();
  };

  // ---- drag to reorder ------------------------------------------------------
  // Pointer-based, started only from a row's grip. We reorder the .layer-block
  // elements live for feedback, then on drop read the resulting order and hand
  // it to the manager (which renumbers indices/z-index + keeps the markers on
  // their layers). The panel renders top → bottom in descending z-order, so the
  // array order (bottom → top) is the reversed DOM order.
  let dragging: HTMLElement | null = null;

  const onDragMove = (e: PointerEvent) => {
    if (!dragging) return;
    const after = getDragAfterElement(list, e.clientY);
    const bg = list.querySelector(".layer-row-background");
    if (after) list.insertBefore(dragging, after);
    else if (bg) list.insertBefore(dragging, bg);
    else list.appendChild(dragging);
  };

  const onDragEnd = () => {
    window.removeEventListener("pointermove", onDragMove);
    if (!dragging) return;
    dragging.classList.remove("dragging");
    dragging = null;
    const ids = [...list.querySelectorAll<HTMLElement>(".layer-block")]
      .map((b) => b.dataset.layerId)
      .filter((id): id is string => !!id)
      .reverse(); // DOM top→bottom (desc z) → array bottom→top (asc index)
    // reorderByIds emits → render() rebuilds; on a no-op restore the clean DOM.
    if (manager.reorderByIds(ids)) onCommit("Reorder layers");
    else render();
  };

  list.addEventListener("pointerdown", (e) => {
    const grip = (e.target as HTMLElement).closest(".layer-grip");
    if (!grip || grip.classList.contains("disabled")) return;
    const block = grip.closest<HTMLElement>(".layer-block");
    if (!block || manager.all.length <= 1) return;
    e.preventDefault();
    dragging = block;
    block.classList.add("dragging");
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd, { once: true });
  });

  manager.subscribe(render);
  render();

  const toggle = () => {
    panel.style.display = panel.style.display === "none" ? "" : "none";
  };

  return { el: panel, toggle, render, refreshPreviews };
}

// The .layer-block the dragged row should be inserted before, given the pointer
// Y — the first row whose vertical midpoint is below the pointer (null = past the
// last, i.e. drop at the bottom).
function getDragAfterElement(
  list: HTMLElement,
  y: number,
): HTMLElement | null {
  const blocks = [
    ...list.querySelectorAll<HTMLElement>(".layer-block:not(.dragging)"),
  ];
  let closest: { offset: number; el: HTMLElement | null } = {
    offset: -Infinity,
    el: null,
  };
  for (const el of blocks) {
    const box = el.getBoundingClientRect();
    const offset = y - (box.top + box.height / 2);
    if (offset < 0 && offset > closest.offset) closest = { offset, el };
  }
  return closest.el;
}

function makeRow(
  manager: LayerManager,
  index: number,
  refreshers: Array<() => void>,
  getBgColor: () => string,
  onCommit: (description: string) => void,
): HTMLElement {
  const layer = manager.all[index];

  const wrap = document.createElement("div");
  wrap.className = "layer-block";
  wrap.dataset.layerId = layer.config.id; // stable id for drag-reorder

  const row = document.createElement("div");
  row.className = "layer-row";
  if (index === manager.activeIdx) row.classList.add("active");
  row.addEventListener("click", (e) => {
    if (
      (e.target as HTMLElement).closest(
        "input, button, [contenteditable='true'], .layer-grip",
      )
    )
      return;
    manager.setActive(index);
  });

  // Drag handle — only this starts a reorder (see createLayersBox), so the
  // slider/buttons/rename keep working. Disabled when there's nothing to reorder.
  const grip = document.createElement("span");
  grip.className = "layer-grip";
  grip.title = "Drag to reorder";
  grip.setAttribute("aria-label", "Drag to reorder layer");
  if (manager.all.length <= 1) grip.classList.add("disabled");
  grip.innerHTML =
    '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">' +
    '<circle cx="6" cy="4" r="1.2"/><circle cx="10" cy="4" r="1.2"/>' +
    '<circle cx="6" cy="8" r="1.2"/><circle cx="10" cy="8" r="1.2"/>' +
    '<circle cx="6" cy="12" r="1.2"/><circle cx="10" cy="12" r="1.2"/>' +
    "</svg>";
  row.appendChild(grip);

  const { thumb: layerThumb, refresh: refreshLayerThumb } = makePreview(
    layer.canvas,
    getBgColor,
  );
  refreshers.push(refreshLayerThumb);
  row.appendChild(layerThumb);

  const name = makeEditableName(layer.config.name, (n) => {
    const prev = layer.config.name;
    manager.setName(index, n);
    onCommit(`Rename ${prev} → ${n}`);
  });
  name.classList.add("layer-name");
  row.appendChild(name);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "100";
  slider.step = "1";
  slider.value = String(layer.config.opacity);
  slider.className = "layer-opacity";
  slider.addEventListener("input", () => {
    manager.setOpacity(index, Number(slider.value));
    pct.textContent = `${slider.value}%`;
  });
  slider.addEventListener("change", () =>
    onCommit(`Opacity change on ${layer.config.name}`),
  );
  row.appendChild(slider);

  const pct = document.createElement("span");
  pct.className = "layer-opacity-value";
  pct.textContent = `${layer.config.opacity}%`;
  row.appendChild(pct);

  // Connection-layer marker: exactly one layer carries the connecting-line
  // visual. Accent when active; click a dim one to move it here.
  const isConnection = index === manager.activeConnectionIdx;
  const conn = document.createElement("button");
  conn.type = "button";
  conn.className = "layer-action-btn layer-conn-btn";
  if (isConnection) conn.classList.add("active");
  conn.setAttribute("aria-pressed", String(isConnection));
  conn.title = isConnection
    ? "Connection layer (baked connections land here)"
    : "Make this the connection layer";
  conn.innerHTML = CONNECTION_LAYER_ICON;
  conn.addEventListener("click", (e) => {
    e.stopPropagation();
    manager.setActiveConnection(index);
  });
  row.appendChild(conn);

  const dup = document.createElement("button");
  dup.type = "button";
  dup.className = "layer-action-btn";
  dup.title = manager.canAddMore() ? "Duplicate layer" : "Layer limit reached";
  dup.disabled = !manager.canAddMore();
  dup.innerHTML =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="8" y="8" width="12" height="12" rx="1"/>' +
    '<path d="M16 8 V4 H4 V16 H8"/>' +
    "</svg>";
  dup.addEventListener("click", (e) => {
    e.stopPropagation();
    const prevName = layer.config.name;
    if (manager.duplicateLayer(index)) onCommit(`Duplicate ${prevName}`);
  });
  row.appendChild(dup);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "layer-action-btn";
  const onlyOne = manager.all.length <= 1;
  del.disabled = onlyOne;
  del.title = onlyOne ? "At least one layer required" : "Delete layer";
  del.innerHTML =
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 6 h18"/>' +
    '<path d="M8 6 V4 a2 2 0 0 1 2 -2 h4 a2 2 0 0 1 2 2 v2"/>' +
    '<path d="M19 6 l-1 14 a2 2 0 0 1 -2 2 H8 a2 2 0 0 1 -2 -2 L5 6"/>' +
    "</svg>";
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    const prevName = layer.config.name;
    if (manager.removeLayer(index)) onCommit(`Delete ${prevName}`);
  });
  row.appendChild(del);

  wrap.appendChild(row);
  return wrap;
}

function makeBackgroundRow(
  manager: LayerManager,
  onCommit: (description: string) => void,
  onBackgroundApply: () => void,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "layer-row layer-row-background";

  const bg = manager.getBackground();

  const swatch = document.createElement("span");
  swatch.className = "bg-swatch";

  const colorInput = document.createElement("input");
  colorInput.type = "color";
  colorInput.value = bg.color;
  colorInput.className = "bg-color-input";
  swatch.appendChild(colorInput);

  // Reflect the live background on the swatch: checkerboard when transparent,
  // else the solid colour. The picker is disabled-feeling (but still usable —
  // choosing a colour turns transparency off).
  const syncSwatch = () => {
    const b = manager.getBackground();
    swatch.style.background = b.transparent ? CHECKER_CSS : b.color;
  };
  syncSwatch();

  swatch.addEventListener("click", (e) => {
    e.stopPropagation();
    colorInput.click();
  });

  colorInput.addEventListener("input", () => {
    // Picking a colour implies an opaque background.
    manager.setBackground({ color: colorInput.value, transparent: false }, { emit: false });
    bgToggle.set(false);
    syncSwatch();
    onBackgroundApply();
  });
  colorInput.addEventListener("change", () => {
    onCommit(`Background color → ${colorInput.value}`);
  });

  row.appendChild(swatch);

  const label = document.createElement("span");
  label.className = "layer-name";
  label.textContent = "Background";
  row.appendChild(label);

  // Transparent toggle: no background (exports to a transparent PNG).
  const toggle = document.createElement("span");
  toggle.className = "bg-transparent-toggle";
  toggle.title = "No background - export a transparent PNG";
  const bgToggle = makeToggle(bg.transparent, (checked) => {
    manager.setBackground({ transparent: checked }, { emit: false });
    syncSwatch();
    onBackgroundApply();
    onCommit(checked ? "Background → transparent" : "Background → solid");
  });
  const toggleText = document.createElement("span");
  toggleText.textContent = "Transparent";
  toggle.append(bgToggle.el, toggleText);
  toggle.addEventListener("click", (e) => e.stopPropagation());
  row.appendChild(toggle);

  return row;
}

function makePreview(
  source: HTMLCanvasElement,
  getBgColor: () => string,
): {
  thumb: HTMLCanvasElement;
  refresh: () => void;
} {
  // dpr cancels: source.width = cssW*dpr, source.height = cssH*dpr
  const ratio = source.width > 0 ? source.height / source.width : 1;
  const cssH = Math.max(8, Math.round(PREVIEW_CSS_W * ratio));
  const dpr = window.devicePixelRatio || 1;

  const thumb = document.createElement("canvas");
  thumb.className = "layer-preview";
  thumb.width = Math.round(PREVIEW_CSS_W * dpr);
  thumb.height = Math.round(cssH * dpr);
  thumb.style.width = `${PREVIEW_CSS_W}px`;
  thumb.style.height = `${cssH}px`;

  const ctx = thumb.getContext("2d");
  const refresh = () => {
    if (!ctx) return;
    const bg = getBgColor();
    if (bg === "transparent") {
      drawChecker(ctx, thumb.width, thumb.height);
    } else {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, thumb.width, thumb.height);
    }
    ctx.drawImage(source, 0, 0, thumb.width, thumb.height);
  };
  refresh();
  return { thumb, refresh };
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

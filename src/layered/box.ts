import { createPanel } from "../ui/panel";
import { makeToggle } from "../ui/toggle";
import { sizeCanvasForDpr } from "../canvas-size";
import { prettyLayerName } from "./schema";
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

// A colour-pick request handed to the palette panel (structurally matches
// PickRequest in colors/panel.ts). When wired, the background swatch opens the
// palette instead of the OS colour input.
type ColorPickRequest = {
  title: string;
  anchor: HTMLElement;
  getColor: () => string;
  onPick: (hex: string) => void;
  onPreview?: (hex: string) => void;
};
type OpenColorPicker = (req: ColorPickRequest) => void;

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
  openColorPicker?: OpenColorPicker,
): LayersBox {
  const { panel } = createPanel({ className: "layers-box", title: "Layers" });

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
    list.appendChild(
      makeBackgroundRow(manager, onCommit, onBackgroundApply, openColorPicker),
    );
    addBtn.disabled = !manager.canAddMore();
  };

  const refreshPreviews = () => {
    for (const fn of refreshers) fn();
  };

  // ---- drag to reorder (smooth, transform-based) ----------------------------
  // Started only from a row's grip. The grabbed block lifts and tracks the
  // pointer (transform); the other blocks slide to open a gap (CSS-transitioned
  // transform). The DOM isn't reordered mid-drag - on drop we compute the new
  // order once and hand it to the manager (which renumbers indices/z-index +
  // keeps the markers on their layers). The panel renders top→bottom in
  // descending z-order, so the array order (bottom→top) is the reversed order.
  type DragState = {
    block: HTMLElement;
    startY: number;
    listTop: number; // list's viewport top at grab, to stay correct if it scrolls mid-drag
    blocks: HTMLElement[]; // all .layer-block, original DOM order (top→bottom)
    centers: number[]; // each block's original viewport centre Y (aligned to blocks)
    src: number; // index of the grabbed block
    shift: number; // px the displaced rows move (grabbed block's outer height)
    ins: number; // current insertion index among the OTHER blocks
  };
  let drag: DragState | null = null;

  // Slide every other row up/down by `shift` to open the gap at the insertion
  // point: a row crosses the grabbed one exactly when it changes side of it.
  const applyShifts = () => {
    if (!drag) return;
    let j = 0;
    for (let i = 0; i < drag.blocks.length; i++) {
      if (i === drag.src) continue;
      const wasAbove = i < drag.src;
      const nowAbove = j < drag.ins;
      const t = wasAbove === nowAbove ? 0 : wasAbove ? drag.shift : -drag.shift;
      drag.blocks[i].style.transform = t ? `translateY(${t}px)` : "";
      j++;
    }
  };

  const onDragMove = (e: PointerEvent) => {
    if (!drag) return;
    // Correct for any scroll of the panel since the grab (rows + pointer both
    // measured against the list's current top), so the drop stays accurate.
    const scrolled = list.getBoundingClientRect().top - drag.listTop;
    const dy = e.clientY - drag.startY - scrolled;
    drag.block.style.transform = `translateY(${dy}px)`; // grabbed row follows the pointer
    const center = drag.centers[drag.src] + dy;
    let ins = 0;
    for (let i = 0; i < drag.blocks.length; i++) {
      if (i !== drag.src && drag.centers[i] < center) ins++;
    }
    if (ins !== drag.ins) {
      drag.ins = ins;
      applyShifts();
    }
  };

  // Tear down the drag. commit=false (pointercancel) aborts without reordering.
  const endDrag = (commit: boolean) => {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    if (!drag) return;
    const d = drag;
    drag = null;
    list.classList.remove("layers-reordering");
    d.block.classList.remove("dragging");
    for (const b of d.blocks) b.style.transform = "";
    // If the list was rebuilt mid-drag (a manager change re-rendered the rows),
    // our snapshot is stale - just resync to the live DOM.
    if (!commit || !d.block.isConnected) {
      render();
      return;
    }
    // New top→bottom order: the other blocks with the grabbed one inserted.
    const ids = d.blocks.filter((_, i) => i !== d.src).map((b) => b.dataset.layerId);
    ids.splice(d.ins, 0, d.block.dataset.layerId);
    const bottomToTop = ids.filter((id): id is string => !!id).reverse();
    // reorderByIds emits → render() rebuilds; on a no-op restore the clean DOM.
    if (manager.reorderByIds(bottomToTop)) onCommit("Reorder layers");
    else render();
  };
  const onPointerUp = () => endDrag(true);
  const onPointerCancel = () => endDrag(false);

  list.addEventListener("pointerdown", (e) => {
    const grip = (e.target as HTMLElement).closest(".layer-grip");
    if (!grip || grip.classList.contains("disabled")) return;
    const block = grip.closest<HTMLElement>(".layer-block");
    if (!block || drag || manager.all.length <= 1) return;
    e.preventDefault();
    const blocks = [...list.querySelectorAll<HTMLElement>(".layer-block")];
    const rects = blocks.map((b) => b.getBoundingClientRect());
    const src = blocks.indexOf(block);
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
    drag = {
      block,
      startY: e.clientY,
      listTop: list.getBoundingClientRect().top,
      blocks,
      centers: rects.map((r) => r.top + r.height / 2),
      src,
      shift: rects[src].height + gap,
      ins: src, // starts in place: there are exactly `src` rows above it
    };
    block.classList.add("dragging");
    list.classList.add("layers-reordering");
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  });

  manager.subscribe(render);
  render();

  const toggle = () => {
    panel.style.display = panel.style.display === "none" ? "" : "none";
  };

  return { el: panel, toggle, render, refreshPreviews };
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

  const name = makeEditableName(prettyLayerName(layer.config.name), (n) => {
    const prev = prettyLayerName(layer.config.name);
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
  openColorPicker?: OpenColorPicker,
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

  // Picking a colour implies an opaque background.
  const applyBackgroundColor = (color: string) => {
    manager.setBackground({ color, transparent: false }, { emit: false });
    bgToggle.set(false);
    syncSwatch();
    onBackgroundApply();
  };

  swatch.addEventListener("click", (e) => {
    e.stopPropagation();
    if (openColorPicker) {
      openColorPicker({
        title: "Background",
        anchor: swatch,
        getColor: () => manager.getBackground().color,
        // Live drag updates the canvas; only committing (Done / swatch click)
        // records an undo entry, so dragging the slider doesn't flood history.
        onPreview: (hex) => applyBackgroundColor(hex),
        onPick: (hex) => {
          applyBackgroundColor(hex);
          onCommit(`Background color → ${hex}`);
        },
      });
    } else {
      colorInput.click();
    }
  });

  // Fallback path (no palette wired): the native OS colour input.
  colorInput.addEventListener("input", () => applyBackgroundColor(colorInput.value));
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
  sizeCanvasForDpr(thumb, PREVIEW_CSS_W, cssH, dpr);

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
  el.tabIndex = 0;
  el.setAttribute("aria-label", `Rename ${initial}`);
  el.title = "Double-click or press Enter to rename";

  const startEdit = () => {
    el.contentEditable = "true";
    el.focus();
    document.getSelection()?.selectAllChildren(el);
  };

  el.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    startEdit();
  });

  el.addEventListener("keydown", (e) => {
    // Before editing, Enter/F2 begins a rename (keyboard parity with dblclick).
    if (el.contentEditable !== "true") {
      if (e.key === "Enter" || e.key === "F2") {
        e.preventDefault();
        e.stopPropagation();
        startEdit();
      }
      return;
    }
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

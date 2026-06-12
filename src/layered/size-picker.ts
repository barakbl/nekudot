import {
  clampSize,
  fullScreenSize,
  squareOfScreen,
  type CanvasSize,
} from "../canvas-size";

export type SizePickerOptions = {
  getScreenMax: () => CanvasSize;
  initialManual?: CanvasSize;
  onConfirm: (size: CanvasSize) => void;
  onUpload?: () => void;
};

type PresetKey = "full" | "square" | "manual";

const PREVIEW_BOX = { w: 120, h: 80 };

export function createSizePicker(opts: SizePickerOptions): {
  el: HTMLElement;
  open: () => void;
  close: () => void;
} {
  const overlay = document.createElement("div");
  overlay.className = "size-picker-modal";
  overlay.style.display = "none";

  const card = document.createElement("div");
  card.className = "size-picker-card";
  overlay.appendChild(card);

  const title = document.createElement("h3");
  title.textContent = "New art";
  card.appendChild(title);

  const grid = document.createElement("div");
  grid.className = "size-options";
  card.appendChild(grid);

  let screenMax = opts.getScreenMax();
  let manualSize: CanvasSize = clampSize(
    opts.initialManual ?? squareOfScreen(screenMax.width, screenMax.height),
    screenMax.width,
    screenMax.height,
  );
  let selected: PresetKey = "full";

  const fullBlock = makeOptionBlock("Full screen");
  const squareBlock = makeOptionBlock("1:1 Square");
  const manualBlock = makeOptionBlock("Manual");

  grid.appendChild(fullBlock.el);
  grid.appendChild(squareBlock.el);
  grid.appendChild(manualBlock.el);

  // Manual inputs
  const manualInputs = document.createElement("div");
  manualInputs.className = "size-manual-inputs";
  const wInput = numInput(manualSize.width);
  const sep = document.createElement("span");
  sep.textContent = "×";
  const hInput = numInput(manualSize.height);
  manualInputs.appendChild(wInput);
  manualInputs.appendChild(sep);
  manualInputs.appendChild(hInput);
  manualBlock.body.appendChild(manualInputs);

  const onManualInput = () => {
    const raw: CanvasSize = {
      width: Number(wInput.value) || 1,
      height: Number(hInput.value) || 1,
    };
    manualSize = clampSize(raw, screenMax.width, screenMax.height);
    wInput.value = String(manualSize.width);
    hInput.value = String(manualSize.height);
    renderPreviews();
  };
  wInput.addEventListener("input", onManualInput);
  hInput.addEventListener("input", onManualInput);

  const select = (key: PresetKey) => {
    selected = key;
    fullBlock.el.classList.toggle("selected", key === "full");
    squareBlock.el.classList.toggle("selected", key === "square");
    manualBlock.el.classList.toggle("selected", key === "manual");
  };

  fullBlock.el.addEventListener("click", () => select("full"));
  squareBlock.el.addEventListener("click", () => select("square"));
  manualBlock.el.addEventListener("click", () => select("manual"));
  manualInputs.addEventListener("click", (e) => {
    e.stopPropagation();
    select("manual");
  });

  // Actions
  const actions = document.createElement("div");
  actions.className = "size-picker-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "canvas-action";
  cancelBtn.textContent = "Cancel";
  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.className = "canvas-action primary";
  createBtn.textContent = "Create";
  actions.appendChild(cancelBtn);
  if (opts.onUpload) {
    const uploadBtn = document.createElement("button");
    uploadBtn.type = "button";
    uploadBtn.className = "canvas-action";
    uploadBtn.textContent = "Load artwork…";
    uploadBtn.addEventListener("click", () => {
      close();
      opts.onUpload?.();
    });
    actions.appendChild(uploadBtn);
  }
  actions.appendChild(createBtn);
  card.appendChild(actions);

  const close = () => {
    overlay.style.display = "none";
  };
  cancelBtn.addEventListener("click", close);

  createBtn.addEventListener("click", () => {
    const size = currentSelectedSize();
    close();
    opts.onConfirm(size);
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });

  const currentSelectedSize = (): CanvasSize => {
    if (selected === "full")
      return fullScreenSize(screenMax.width, screenMax.height);
    if (selected === "square")
      return squareOfScreen(screenMax.width, screenMax.height);
    return clampSize(manualSize, screenMax.width, screenMax.height);
  };

  const renderPreviews = () => {
    const full = fullScreenSize(screenMax.width, screenMax.height);
    const sq = squareOfScreen(screenMax.width, screenMax.height);
    fullBlock.setPreview(full);
    squareBlock.setPreview(sq);
    manualBlock.setPreview(manualSize);
  };

  const open = () => {
    screenMax = opts.getScreenMax();
    manualSize = clampSize(manualSize, screenMax.width, screenMax.height);
    wInput.max = String(screenMax.width);
    hInput.max = String(screenMax.height);
    wInput.value = String(manualSize.width);
    hInput.value = String(manualSize.height);
    select("full");
    renderPreviews();
    overlay.style.display = "flex";
  };

  return { el: overlay, open, close };
}

function makeOptionBlock(label: string): {
  el: HTMLElement;
  body: HTMLElement;
  setPreview: (size: CanvasSize) => void;
} {
  const el = document.createElement("div");
  el.className = "size-option";

  const previewArea = document.createElement("div");
  previewArea.className = "size-preview-area";
  const previewRect = document.createElement("div");
  previewRect.className = "size-preview-rect";
  previewArea.appendChild(previewRect);
  el.appendChild(previewArea);

  const labelEl = document.createElement("div");
  labelEl.className = "size-option-label";
  labelEl.textContent = label;
  el.appendChild(labelEl);

  const dimsEl = document.createElement("div");
  dimsEl.className = "size-option-dims";
  el.appendChild(dimsEl);

  const body = document.createElement("div");
  body.className = "size-option-body";
  el.appendChild(body);

  const setPreview = (size: CanvasSize) => {
    const r = Math.min(PREVIEW_BOX.w / size.width, PREVIEW_BOX.h / size.height);
    previewRect.style.width = `${Math.max(2, Math.round(size.width * r))}px`;
    previewRect.style.height = `${Math.max(2, Math.round(size.height * r))}px`;
    dimsEl.textContent = `${size.width} × ${size.height}`;
  };

  return { el, body, setPreview };
}

function numInput(value: number): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.step = "1";
  input.value = String(value);
  input.className = "size-num-input";
  return input;
}

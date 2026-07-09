import { triggerDownload, timestamp } from "../export";
import { EXPORTERS, resolveVideoExporter, type Exporter } from "./exporters";
import type { Clip } from "./recorder";
import {
  delayMsForSpeed,
  clampTrim,
  clipDurationMs,
  MIN_SPEED,
  MAX_SPEED,
} from "./timeline";

// The clip preview/edit modal: loops the captured frames, with a speed slider
// and a single two-handle trim slider (start + end). Speed sets the per-frame
// delay (preview + export); trim picks the frame range. Save encodes the
// trimmed range at the chosen speed via the active Exporter and downloads it.
// Nothing is encoded until Save, so editing is instant.
export function openClipPreview(rec: Clip): void {
  const count = rec.frames.length;
  // GIF is always present; the video exporter (WebCodecs) is appended async below.
  let formats: Exporter[] = [...EXPORTERS];
  let exporter = formats[0];

  let speed = 1;
  let trimStart = 0;
  let trimEnd = count - 1;
  let current = 0;
  let playing = true;
  let playTimer: number | null = null;
  let encoding = false;

  const backdrop = el("div", "clip-backdrop app-modal");
  const modal = el("div", "clip-modal");
  backdrop.appendChild(modal);

  // Header
  const header = el("div", "clip-modal-head");
  const title = el("span", "clip-modal-title");
  title.textContent = "Clip preview";
  const closeBtn = btn("clip-modal-close");
  closeBtn.textContent = "×";
  closeBtn.title = "Discard";
  header.append(title, closeBtn);

  // Preview canvas (sized to the frame; CSS scales it to fit the modal).
  const canvasWrap = el("div", "clip-canvas-wrap");
  const canvas = document.createElement("canvas");
  canvas.className = "clip-preview-canvas";
  canvas.width = rec.width;
  canvas.height = rec.height;
  const ctx = canvas.getContext("2d");
  canvasWrap.appendChild(canvas);

  const readout = el("div", "clip-readout");

  // Speed slider
  const speedRow = el("div", "clip-row");
  const speedLbl = el("span", "clip-row-label");
  speedLbl.textContent = "Speed";
  const speedInput = range(MIN_SPEED, MAX_SPEED, 0.05, speed, "clip-range");
  const speedVal = el("span", "clip-row-val");
  speedRow.append(speedLbl, speedInput, speedVal);

  // Trim: one slider, two handles (start + end).
  const trimRow = el("div", "clip-row");
  const trimLbl = el("span", "clip-row-label");
  trimLbl.textContent = "Trim";
  const trimVal = el("span", "clip-row-val");
  const dual = makeDualRange(count, (s, e) => {
    trimStart = s;
    trimEnd = e;
    if (current < trimStart || current > trimEnd) current = trimStart;
    draw(current);
    refreshReadout();
  });
  trimRow.append(trimLbl, dual.el, trimVal);

  // Format picker (segmented control), hidden until there's more than one format.
  const formatRow = el("div", "clip-row");
  const formatLbl = el("span", "clip-row-label");
  formatLbl.textContent = "Format";
  const formatGroup = el("div", "clip-format-group");
  formatRow.append(formatLbl, formatGroup);
  formatRow.style.display = "none";

  // Footer: play/pause + progress + cancel/save
  const footer = el("div", "clip-modal-foot");
  const playBtn = btn("clip-btn clip-play");
  playBtn.textContent = "Pause";
  const progress = el("div", "clip-progress");
  const progressBar = el("div", "clip-progress-bar");
  progress.appendChild(progressBar);
  progress.style.display = "none";
  const spacer = el("div", "clip-foot-spacer");
  const cancelBtn = btn("clip-btn");
  cancelBtn.textContent = "Cancel";
  const saveBtn = btn("clip-btn clip-save");
  saveBtn.textContent = `Save ${exporter.label}`;
  footer.append(playBtn, progress, spacer, cancelBtn, saveBtn);

  modal.append(header, canvasWrap, readout, speedRow, trimRow, formatRow, footer);
  document.body.appendChild(backdrop);

  // ---- behaviour ----------------------------------------------------------

  // Paint the format control + sync the Save button; shown only when >1 format.
  function renderFormats(): void {
    formatGroup.textContent = "";
    for (const f of formats) {
      const b = btn("clip-format-btn");
      b.textContent = f.label;
      if (f.id === exporter.id) b.classList.add("active");
      b.addEventListener("click", () => {
        if (encoding || f.id === exporter.id) return;
        exporter = f;
        saveBtn.textContent = `Save ${exporter.label}`;
        renderFormats();
      });
      formatGroup.appendChild(b);
    }
    formatRow.style.display = formats.length > 1 ? "" : "none";
  }
  renderFormats();

  // Reveal the video option once the async capability probe resolves.
  resolveVideoExporter()
    .then((video) => {
      if (video && !formats.some((f) => f.id === video.id)) {
        formats = [...formats, video];
        renderFormats();
      }
    })
    .catch(() => {});

  function draw(i: number): void {
    if (ctx) ctx.putImageData(rec.frames[i], 0, 0);
  }

  function refreshReadout(): void {
    const delay = delayMsForSpeed(speed, rec.captureFps);
    const n = trimEnd - trimStart + 1;
    const secs = clipDurationMs(n, delay) / 1000;
    speedVal.textContent = `${speed.toFixed(2)}x`;
    trimVal.textContent = `${fmtTime(trimStart, rec.captureFps)}-${fmtTime(trimEnd, rec.captureFps)}`;
    readout.textContent = `${n} frames · ${secs.toFixed(1)}s · ${Math.round(1000 / delay)} fps`;
  }

  const stopPlay = () => {
    if (playTimer !== null) {
      clearTimeout(playTimer);
      playTimer = null;
    }
  };
  const tick = () => {
    if (!playing) return;
    draw(current);
    current = current >= trimEnd ? trimStart : current + 1;
    playTimer = window.setTimeout(tick, delayMsForSpeed(speed, rec.captureFps));
  };
  const startPlay = () => {
    stopPlay();
    playing = true;
    playBtn.textContent = "Pause";
    tick();
  };

  playBtn.addEventListener("click", () => {
    if (playing) {
      playing = false;
      stopPlay();
      playBtn.textContent = "Play";
    } else {
      startPlay();
    }
  });

  speedInput.addEventListener("input", () => {
    speed = Number(speedInput.value);
    refreshReadout();
  });

  const close = () => {
    stopPlay();
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !encoding) close();
  };
  document.addEventListener("keydown", onKey);
  closeBtn.addEventListener("click", () => !encoding && close());
  cancelBtn.addEventListener("click", () => !encoding && close());
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop && !encoding) close();
  });

  saveBtn.addEventListener("click", async () => {
    if (encoding) return;
    encoding = true;
    playing = false;
    stopPlay();
    saveBtn.disabled = true;
    cancelBtn.disabled = true;
    progress.style.display = "";
    const frames = rec.frames.slice(trimStart, trimEnd + 1);
    const delay = delayMsForSpeed(speed, rec.captureFps);
    try {
      const blob = await exporter.encode(frames, delay, (done, total) => {
        progressBar.style.width = `${Math.round((done / total) * 100)}%`;
      });
      triggerDownload(blob, `nekudot_${timestamp()}.${exporter.ext}`);
      close();
    } catch (err) {
      console.error("clip export failed", err);
      readout.textContent = "Export failed - see console.";
      encoding = false;
      saveBtn.disabled = false;
      cancelBtn.disabled = false;
      progress.style.display = "none";
    }
  });

  refreshReadout();
  draw(0);
  startPlay();
}

// A single slider with two handles (start + end): two overlaid range inputs that
// only catch pointer events on their thumbs, plus a rail and a filled span
// showing the selection. clampTrim keeps them ordered and >= 2 frames apart.
function makeDualRange(
  count: number,
  onChange: (start: number, end: number) => void,
): { el: HTMLElement } {
  const max = count - 1;
  const wrap = el("div", "clip-dual");
  const rail = el("div", "clip-dual-rail");
  const fill = el("div", "clip-dual-fill");
  const startI = range(0, max, 1, 0, "clip-dual-input");
  const endI = range(0, max, 1, max, "clip-dual-input");
  wrap.append(rail, fill, startI, endI);

  const paint = (s: number, e: number) => {
    fill.style.left = `${(s / max) * 100}%`;
    fill.style.right = `${((max - e) / max) * 100}%`;
  };
  const apply = () => {
    const t = clampTrim(Number(startI.value), Number(endI.value), count);
    startI.value = String(t.start);
    endI.value = String(t.end);
    // Raise whichever handle the user is nearest so a thumb is never trapped
    // under the other when they bunch up.
    startI.style.zIndex = t.start > max - t.end ? "4" : "3";
    paint(t.start, t.end);
    onChange(t.start, t.end);
  };
  startI.addEventListener("input", apply);
  endI.addEventListener("input", apply);
  paint(0, max);
  return { el: wrap };
}

function el(tag: string, className: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}

function btn(className: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  return b;
}

function range(
  min: number,
  max: number,
  step: number,
  value: number,
  className: string,
): HTMLInputElement {
  const i = document.createElement("input");
  i.type = "range";
  i.min = String(min);
  i.max = String(max);
  i.step = String(step);
  i.value = String(value);
  i.className = className;
  return i;
}

function fmtTime(frameIndex: number, fps: number): string {
  return `${(frameIndex / fps).toFixed(2)}s`;
}

import { ClipRecorder, maxSeconds } from "./recorder";
import { openClipPreview } from "./preview-box";
import type { LayerManager } from "../layered/manager";

let active = false;
// Set while a recording is armed (Record clicked, waiting for the first stroke).
let pendingStart: (() => void) | null = null;

// Called by the drawing input when a stroke begins. If a recording is armed,
// the first stroke kicks off capture — so we never record the idle time between
// clicking Record and actually drawing. No-op otherwise.
export function notifyClipStrokeStart(): void {
  const start = pendingStart;
  if (!start) return;
  pendingStart = null;
  start();
}

// Arm a GIF recording: show a floating pill over the stage ("Draw to start"),
// then begin capturing on the first stroke. Stops on the Stop button or the
// duration cap, and opens the preview/edit modal with the captured frames. One
// recording at a time.
export function startClipRecording(opts: {
  manager: LayerManager;
  getBackgroundColor: () => string;
  stage: HTMLElement;
}): void {
  if (active) return;
  active = true;

  const pill = document.createElement("div");
  pill.className = "clip-rec-pill armed";
  // The pill lives inside the stage, whose pointerdown starts a stroke and
  // setPointerCapture()s the pointer. Keep the pill's pointer events off the
  // drawing handler, AND make the pill draggable so you can move it clear of
  // your work - drag the body to reposition; the Stop button still clicks.
  let dragOffX = 0;
  let dragOffY = 0;
  let dragging = false;
  pill.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    if (e.target instanceof HTMLElement && e.target.closest("button")) return;
    pill.setPointerCapture(e.pointerId);
    const pr = pill.getBoundingClientRect();
    const sr = opts.stage.getBoundingClientRect();
    dragOffX = e.clientX - pr.left;
    dragOffY = e.clientY - pr.top;
    // switch from the bottom/centre anchor to absolute left/top within the stage
    pill.style.transform = "none";
    pill.style.bottom = "auto";
    pill.style.left = `${pr.left - sr.left}px`;
    pill.style.top = `${pr.top - sr.top}px`;
    dragging = true;
    pill.classList.add("dragging");
  });
  pill.addEventListener("pointermove", (e) => {
    e.stopPropagation();
    if (!dragging) return;
    const sr = opts.stage.getBoundingClientRect();
    const x = Math.min(Math.max(0, e.clientX - sr.left - dragOffX), Math.max(0, sr.width - pill.offsetWidth));
    const y = Math.min(Math.max(0, e.clientY - sr.top - dragOffY), Math.max(0, sr.height - pill.offsetHeight));
    pill.style.left = `${x}px`;
    pill.style.top = `${y}px`;
  });
  const endDrag = (e: PointerEvent) => {
    e.stopPropagation();
    if (!dragging) return;
    dragging = false;
    pill.releasePointerCapture(e.pointerId);
    pill.classList.remove("dragging");
  };
  pill.addEventListener("pointerup", endDrag);
  pill.addEventListener("pointercancel", endDrag);
  const dot = document.createElement("span");
  dot.className = "clip-rec-dot";
  const label = document.createElement("span");
  label.className = "clip-rec-time";
  label.textContent = "Draw to start";
  const stop = document.createElement("button");
  stop.type = "button";
  stop.className = "clip-rec-stop";
  stop.textContent = "Cancel";
  pill.append(dot, label, stop);
  opts.stage.appendChild(pill);

  let recorder: ClipRecorder | null = null;
  let timeTimer: number | null = null;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    pendingStart = null;
    if (timeTimer !== null) clearInterval(timeTimer);
    const recording = recorder?.stop() ?? null;
    pill.remove();
    active = false;
    if (recording) openClipPreview(recording);
  };

  const begin = () => {
    pill.classList.remove("armed");
    stop.textContent = "Stop";
    const cap = maxSeconds();
    const t0 = performance.now();
    label.textContent = `0.0 / ${cap}s`;
    timeTimer = window.setInterval(() => {
      const s = Math.min(cap, (performance.now() - t0) / 1000);
      label.textContent = `${s.toFixed(1)} / ${cap}s`;
    }, 100);
    recorder = new ClipRecorder(opts.manager, opts.getBackgroundColor, finish);
    recorder.start();
  };

  stop.addEventListener("click", finish);
  pendingStart = begin;
}

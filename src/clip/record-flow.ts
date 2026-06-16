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
  // setPointerCapture()s the pointer — keep the pill's own pointer events from
  // reaching the drawing handler (so its clicks don't draw or count as a stroke).
  for (const t of ["pointerdown", "pointerup", "pointermove"])
    pill.addEventListener(t, (e) => e.stopPropagation());
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

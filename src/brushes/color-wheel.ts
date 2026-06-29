import type { Store } from "../store/base";
import { connectionLineColor, headingToT } from "./color-source";

// The direction -> colour wheel shared by the Color Pen and the connecting web:
// a conic disc of the active colour source plus two sliders - Rotate (offset the
// whole map) and Range (how much of the palette a full turn covers; < 1 keeps a
// curving/reversing stroke inside an arc instead of snapping to the complement).
// The owner supplies live accessors and is told when a slider moves; it calls
// repaint() when the source or the Primary/Secondary colours change. The
// direction -> colour maths (headingToT) lives in color-source so this file
// stays DOM-only.
export interface ColorWheel {
  el: HTMLElement;
  repaint(): void;
}

function labeledSlider(
  label: string,
  min: string,
  max: string,
  step: string,
  value: string,
  onInput: (v: number) => void,
): HTMLElement {
  const row = document.createElement("label");
  row.className = "colorpen-wheel-slider-row";
  const cap = document.createElement("span");
  cap.className = "colorpen-wheel-slider-label";
  cap.textContent = label;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = min;
  slider.max = max;
  slider.step = step;
  slider.value = value;
  slider.className = "colorpen-wheel-slider";
  slider.setAttribute("aria-label", label);
  slider.addEventListener("input", () => onInput(Number(slider.value)));
  row.append(cap, slider);
  return row;
}

export function createColorWheel(opts: {
  store?: Store;
  getSource: () => string;
  getAngle: () => number;
  onAngle: (deg: number) => void;
  getRange: () => number;
  onRange: (range: number) => void;
}): ColorWheel {
  const { store, getSource, getAngle, onAngle, getRange, onRange } = opts;
  const wrap = document.createElement("div");
  wrap.className = "colorpen-wheel";
  const disc = document.createElement("div");
  disc.className = "colorpen-wheel-disc";

  const repaint = () => {
    const primary = store?.get<string>("app.color.main") ?? "#000000";
    const secondary = store?.get<string>("app.color.secondary") ?? "#888888";
    // Sample each heading through the SAME Range + Rotate mapping the stroke uses
    // (headingToT), so the disc is an exact preview of what gets drawn. -90 lines
    // the conic's 0deg (top) up with "up"; both Range and Rotate live in the stop
    // colours, never in a separate conic rotation (mixing the two made the disc
    // disagree with the draw once Range left 1).
    const range = getRange();
    const angle = getAngle();
    const stops: string[] = [];
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const t = headingToT((i % N) / N, range, angle);
      stops.push(connectionLineColor(getSource(), t, primary, secondary) ?? primary);
    }
    disc.style.background = `conic-gradient(from -90deg, ${stops.join(", ")})`;
  };

  const rotate = labeledSlider("Rotate", "0", "359", "1", String(getAngle()), (v) => {
    onAngle(v);
    repaint();
  });
  const range = labeledSlider("Range", "0.05", "1", "0.05", String(getRange()), (v) => {
    onRange(v);
    repaint();
  });

  wrap.append(disc, rotate, range);
  repaint();
  return { el: wrap, repaint };
}

import { BrushBase, type BrushSetting } from "../base";
import type { Pixel } from "../neighbor-finder";
import type { PaintHost } from "../paint-host";
import type { PenSample } from "../pen";
import type { Store } from "../store/base";
import type { BrushContext } from "./registry";
import {
  colorSourceIcons,
  connectionColorLabels,
  connectionColorOptions,
  connectionLineColor,
  createTravelHeading,
  headingToT,
  isDirectionalSource,
  normalizeColorSource,
} from "./color-source";
import { createColorWheel } from "./color-wheel";

// Menu glyph: a colourful stroke with a few colour dabs along it.
export const icon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M3 17 Q8 8 12 12 T21 7"/>' +
  '<circle cx="3" cy="17" r="1.3" fill="currentColor" stroke="none"/>' +
  '<circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/>' +
  '<circle cx="21" cy="7" r="1.3" fill="currentColor" stroke="none"/>' +
  "</svg>";

export function create(c: BrushContext): ColorPenBrush {
  return new ColorPenBrush(c.host, undefined, c.store);
}

const ANGLE_KEY = "brush.Color Pen.angle";
const RANGE_KEY = "brush.Color Pen.range";
const RELATIVE_KEY = "brush.Color Pen.relative";

// The Color Pen: a round line that lays down NO connecting web. Each segment's
// colour is sampled from the chosen palette / gradient by the pen's direction of
// travel (offset by the Direction wheel), so a curving stroke walks the palette
// - direction + colour together, for fully intentional, expressive marks.
export class ColorPenBrush extends BrushBase {
  private lastX = 0;
  private lastY = 0;
  // Direction of travel, normalised to 0..1, with the relative-anchor logic
  // shared with the connecting web (so the pen and web map identically).
  private travel = createTravelHeading();
  // Which palette / gradient the direction samples into (see color-source).
  private source = "rainbow";
  // Rotation offset (deg) of the direction -> colour map, set by the wheel slider.
  private angle = 0;
  // How much of the palette a full turn covers (0..1); < 1 keeps a curving stroke
  // inside an arc instead of snapping to the complement on every reversal.
  private range = 1;
  // Measure heading relative to the stroke's start, not the absolute compass, so
  // the same gesture gives the same colour run whichever way you face the page.
  private relative = false;
  // Repaint the settings wheel when the source changes (set when it builds).
  private redrawWheel: () => void = () => {};

  constructor(host: PaintHost, seed?: number, store?: Store) {
    super(host, seed, store);
    // Grace for mouse/touch: taper the line by stroke speed by default. The
    // Color Pen is all line, so it reads on every stroke - direction moves
    // colour, speed moves weight. A pen ignores it. Toggle + tune in settings.
    this.speedTaper = true;
    const a = store?.get<number>(ANGLE_KEY);
    if (typeof a === "number") this.angle = a;
    const r = store?.get<number>(RANGE_KEY);
    if (typeof r === "number") this.range = r;
    const rel = store?.get<boolean>(RELATIVE_KEY);
    if (typeof rel === "boolean") this.relative = rel;
  }

  name(): string {
    return "Color Pen";
  }

  // Like Round, the Color Pen draws one continuous line per stroke (just
  // multi-coloured), so buffer it into one uniform-alpha stroke - otherwise a
  // wide, low-opacity stroke shows darker dots where each segment's round caps
  // overlap. A pen with an opacity binding draws unbuffered (the buffer would
  // flatten exactly the per-sample alpha the binding varies).
  bufferedStroke(pen?: PenSample): boolean {
    if (pen?.isPen && (this.penPressureAlpha || this.penTiltAlpha)) return false;
    return true;
  }

  strokeStart(x: number, y: number): void {
    this.lastX = x;
    this.lastY = y;
    this.travel.reset(); // re-anchor relative heading at each stroke
    this.travel.push(x, y);
  }

  protected onStroke(x: number, y: number, current: Pixel): void {
    this.travel.push(x, y);
    const heading = this.relative ? this.travel.relative() : this.travel.absolute();
    const t = headingToT(heading, this.range, this.angle);
    const primary = this.frozenPrimary();
    const secondary = this.frozenSecondary();
    const color = connectionLineColor(this.source, t, primary, secondary) ?? primary;
    // Tag the deposited cloud point with the hue we just drew, so a connecting
    // brush that later weaves toward it can inherit the colour (its "From mark"
    // source). `current` is the real stored Pixel on a sampled point; on a
    // coalesced sub-frame it's a throwaway literal, so this is a harmless no-op.
    current.color = color;
    this.renderer.drawLine(
      { id: 0, x: this.lastX, y: this.lastY },
      { id: 0, x, y },
      { color, cap: "round", ...this.penStyle() },
    );
    this.lastX = x;
    this.lastY = y;
  }

  // A direction -> colour wheel: a conic disc of the active source (a mark drawn
  // in a direction comes out the colour shown there) plus Rotate/Range sliders
  // and a "Relative direction" toggle. Built on the shared widget (also the web).
  private buildWheel(): HTMLElement {
    const box = document.createElement("div");
    box.className = "colorpen-wheel-group";

    const wheel = createColorWheel({
      store: this.store,
      getSource: () => this.source,
      getAngle: () => this.angle,
      onAngle: (deg) => {
        this.angle = deg;
        this.store?.set(ANGLE_KEY, this.angle);
      },
      getRange: () => this.range,
      onRange: (r) => {
        this.range = r;
        this.store?.set(RANGE_KEY, this.range);
      },
    });

    // Relative: anchor the hue to the stroke's start heading, so the same gesture
    // gives the same colour run regardless of which way you draw it.
    const label = document.createElement("label");
    label.className = "colorpen-wheel-check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = this.relative;
    const span = document.createElement("span");
    span.textContent = "Relative direction";
    label.append(cb, span);
    cb.addEventListener("change", () => {
      this.relative = cb.checked;
      this.store?.set(RELATIVE_KEY, this.relative);
    });

    // Only a directional source has colours to map by direction; a solid
    // Primary/Secondary hides the wheel.
    const sync = () => {
      const directional = isDirectionalSource(this.source);
      const row = box.parentElement as HTMLElement | null;
      if (row) row.style.display = directional ? "" : "none";
      if (directional) wheel.repaint();
    };
    this.redrawWheel = sync;
    queueMicrotask(sync); // hide the row up front if the current source is solid

    box.append(label, wheel.el);
    return box;
  }

  getSettings(): BrushSetting[] {
    return [
      {
        kind: "select",
        key: "colorSource",
        label: "Colour",
        options: connectionColorOptions(),
        optionLabels: connectionColorLabels(),
        icons: colorSourceIcons(this.store),
        value: this.source,
        onChange: (v) => {
          this.source = normalizeColorSource(v);
          this.redrawWheel();
        },
      },
      ...this.speedTaperSettings(),
      ...this.wheelSetting(),
      ...this.penSettings(),
    ];
  }

  // The Direction wheel row, built only in a DOM context - headless callers
  // (tests, render harnesses) read the dials but never the widget, so we skip the
  // element rather than touch `document` (mirrors ConnectionBase).
  private wheelSetting(): BrushSetting[] {
    if (typeof document === "undefined") return [];
    return [{ kind: "custom", key: "colorWheel", label: "Direction", value: "", el: this.buildWheel() }];
  }
}

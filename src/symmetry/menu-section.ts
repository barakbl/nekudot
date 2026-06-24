import type { SymmetryController } from "./controller";
import type { SymSetting } from "./tool";
import { SYMMETRY_TOOL_DEFS } from "./registry";
import { attachHelp } from "../help";
import { makeToggle } from "../toggle";

// None = a single freehand wave (one free stroke - positive, not a crossed-out
// "off" badge, since None is the resting state shown in the navbar). The mode
// glyphs for the actual tools come from each tool module (registry).
const NONE_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M2.5 8 C4.3 4.4 6.2 4.4 8 8 C9.8 11.6 11.7 11.6 13.5 8"/></svg>';

// The selectable modes (None + every registered tool, in registry order) -
// shared by the panel's picker and the navbar Symmetry combo.
export const SYMMETRY_MODES: { id: string; label: string; icon: string }[] = [
  { id: "none", label: "None", icon: NONE_ICON },
  ...SYMMETRY_TOOL_DEFS.map((d) => ({ id: d.name, label: d.label, icon: d.icon })),
];

// The Symmetry controls: a mode picker (None + the plugin tools) plus the active
// tool's declared params, the shared movable Centre (for centred tools) and the
// guide-line styling. The per-mode params are rendered generically from the
// tool's settings() - adding a tool needs no change here.
export function makeSymmetrySection(c: SymmetryController): HTMLElement {
  const root = document.createElement("div");
  root.className = "sym-section";

  const seg = document.createElement("div");
  seg.className = "sym-seg";
  const segBtns = new Map<string, HTMLButtonElement>();
  for (const m of SYMMETRY_MODES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sym-seg-btn sym-mode-btn";
    btn.innerHTML = m.icon + `<span class="sym-seg-lbl">${m.label}</span>`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      c.setMode(m.id);
      syncMode();
      renderParams();
    });
    segBtns.set(m.id, btn);
    seg.appendChild(btn);
  }
  root.appendChild(seg);

  const params = document.createElement("div");
  params.className = "sym-params";
  root.appendChild(params);

  const syncMode = () => {
    for (const [id, btn] of segBtns) btn.classList.toggle("active", id === c.mode);
  };

  // ---- generic control rows --------------------------------------------------

  const sliderRow = (
    text: string,
    min: number,
    max: number,
    value: number,
    onInput: (v: number) => void,
    help?: string,
    step?: number,
    disabled?: boolean,
  ): HTMLElement => {
    const row = document.createElement("div");
    row.className = "sym-row" + (disabled ? " disabled" : "");
    const l = document.createElement("span");
    l.className = "sym-rowlabel";
    l.textContent = text;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    if (step) input.step = String(step);
    input.value = String(value);
    input.disabled = !!disabled;
    const val = document.createElement("span");
    val.className = "sym-rowval";
    val.textContent = String(value);
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("input", (e) => {
      e.stopPropagation();
      val.textContent = input.value;
      onInput(Number(input.value));
    });
    row.append(l, input, val);
    if (help) attachHelp(l, help);
    return row;
  };

  const toggleRow = (
    text: string,
    value: boolean,
    onChange: (v: boolean) => void,
    help?: string,
  ): HTMLElement => {
    const row = document.createElement("div");
    row.className = "sym-row";
    const l = document.createElement("span");
    l.className = "sym-rowlabel";
    l.textContent = text;
    const { el } = makeToggle(value, onChange);
    row.append(l, el);
    if (help) attachHelp(l, help);
    return row;
  };

  const segmentRow = (
    options: { value: string; label: string; icon?: string }[],
    value: string,
    onChange: (v: string) => void,
  ): HTMLElement => {
    const wrap = document.createElement("div");
    wrap.className = "sym-seg";
    for (const opt of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sym-seg-btn sym-axis-btn" + (opt.value === value ? " active" : "");
      btn.innerHTML = (opt.icon ?? "") + `<span class="sym-seg-lbl">${opt.label}</span>`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onChange(opt.value);
      });
      wrap.appendChild(btn);
    }
    return wrap;
  };

  const colorRow = (text: string, value: string, onInput: (v: string) => void): HTMLElement => {
    const row = document.createElement("div");
    row.className = "sym-row";
    const l = document.createElement("span");
    l.className = "sym-rowlabel";
    l.textContent = text;
    const input = document.createElement("input");
    input.type = "color";
    input.className = "sym-color";
    input.value = value;
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("input", (e) => {
      e.stopPropagation();
      onInput(input.value);
    });
    row.append(l, input);
    return row;
  };

  // Render one declared tool setting. Sliders apply live (no re-render, so a drag
  // keeps going); toggles/segments re-render the params so disabled states and
  // active highlights refresh.
  const settingRow = (s: SymSetting): HTMLElement => {
    if (s.kind === "slider")
      return sliderRow(
        s.label,
        s.min,
        s.max,
        s.value,
        (v) => c.setToolSetting(s, v),
        s.help,
        s.step,
        s.disabled,
      );
    if (s.kind === "toggle")
      return toggleRow(
        s.label,
        s.value,
        (v) => {
          c.setToolSetting(s, v);
          renderParams();
        },
        s.help,
      );
    return segmentRow(s.options, s.value, (v) => {
      c.setToolSetting(s, v);
      renderParams();
    });
  };

  // Shared movable Centre (Radial / Mirror / Concentric / Spiral) + Recentre.
  const centerRows = (): HTMLElement[] => {
    const head = document.createElement("div");
    head.className = "sym-subhead sym-subhead-row";
    const label = document.createElement("span");
    label.textContent = "Centre";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "sym-center-reset";
    reset.title = "Recentre on the canvas";
    reset.textContent = "Recentre";
    head.append(label, reset);

    const xRow = sliderRow(
      "X",
      0,
      100,
      Math.round(c.centerX * 100),
      (v) => c.setCenter({ x: v / 100 }),
      "Horizontal position of the symmetry centre, as a percent of the canvas width.",
    );
    const yRow = sliderRow(
      "Y",
      0,
      100,
      Math.round(c.centerY * 100),
      (v) => c.setCenter({ y: v / 100 }),
      "Vertical position of the symmetry centre, as a percent of the canvas height.",
    );

    reset.addEventListener("click", (e) => {
      e.stopPropagation();
      c.setCenter({ x: 0.5, y: 0.5 });
      for (const row of [xRow, yRow]) {
        const input = row.querySelector<HTMLInputElement>("input");
        const val = row.querySelector(".sym-rowval");
        if (input) input.value = "50";
        if (val) val.textContent = "50";
      }
    });
    return [head, xRow, yRow];
  };

  // Guide-line appearance (opacity / width / color), shown for any active mode.
  const appearanceRows = (): HTMLElement[] => {
    const head = document.createElement("div");
    head.className = "sym-subhead";
    head.textContent = "Guides";
    return [
      head,
      sliderRow("Opacity", 0, 100, Math.round(c.guide.alpha * 100), (v) =>
        c.setGuide({ alpha: v / 100 }),
      ),
      sliderRow("Width", 1, 3, c.guide.width, (v) => c.setGuide({ width: v })),
      colorRow("Color", c.guide.color, (v) => c.setGuide({ color: v })),
    ];
  };

  const renderParams = () => {
    params.replaceChildren();
    if (c.mode === "none") return;
    for (const s of c.activeSettings()) params.appendChild(settingRow(s));
    if (c.usesCentre()) params.append(...centerRows());
    params.append(...appearanceRows());
  };

  syncMode();
  renderParams();

  // Keep the picker + params in sync when the mode is changed elsewhere (the
  // navbar Symmetry combo). Only react to MODE changes - a param tweak (same
  // mode) must not rebuild the params mid-slider-drag.
  let lastMode = c.mode;
  c.subscribe(() => {
    if (c.mode === lastMode) return;
    lastMode = c.mode;
    syncMode();
    renderParams();
  });

  return root;
}

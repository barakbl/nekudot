import { SymmetryController, type SymmetryMode } from "./controller";
import { attachHelp } from "../help";

// Mode glyphs: None = a single freehand wave (one free stroke — positive, not a
// crossed-out "off" badge, since None is the resting state shown in the navbar);
// Radial = spoked circle; Mirror = dashed axis with two mirrored arrows; Tile =
// a 2×2 lattice. Exported so the navbar Symmetry combo shows the same icons.
export const SYMMETRY_MODE_ICONS: Record<SymmetryMode, string> = {
  none:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M2.5 8 C4.3 4.4 6.2 4.4 8 8 C9.8 11.6 11.7 11.6 13.5 8"/></svg>',
  radial:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.8"/><path d="M8 2.2 V13.8 M2.2 8 H13.8 M3.9 3.9 L12.1 12.1 M12.1 3.9 L3.9 12.1"/></svg>',
  mirror:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="2" x2="8" y2="14" stroke-dasharray="2 2"/><path d="M6 5 L3 8 L6 11 Z"/><path d="M10 5 L13 8 L10 11 Z"/></svg>',
  tile:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2.4" y="2.4" width="4.6" height="4.6" rx="0.8"/><rect x="9" y="2.4" width="4.6" height="4.6" rx="0.8"/><rect x="2.4" y="9" width="4.6" height="4.6" rx="0.8"/><rect x="9" y="9" width="4.6" height="4.6" rx="0.8"/></svg>',
  concentric:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true"><circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="3.4"/><circle cx="8" cy="8" r="1"/></svg>',
  spiral:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><path d="M8 8 a1 1 0 1 1 1.4 0.9 a2.6 2.6 0 1 1 -3.8 -1.2 a4.4 4.4 0 1 1 6.4 2.8"/></svg>',
};

// Mirror-axis glyphs: the dashed reflection line with arrows mirroring across
// it. A vertical line flips left/right — the Mirror mode glyph already draws
// exactly that, so reuse it; horizontal is the same picture rotated 90°.
const AXIS_ICON: Record<"vertical" | "horizontal", string> = {
  vertical: SYMMETRY_MODE_ICONS.mirror,
  horizontal:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="8" x2="14" y2="8" stroke-dasharray="2 2"/><path d="M5 6 L8 3 L11 6 Z"/><path d="M5 10 L8 13 L11 10 Z"/></svg>',
};

// The selectable symmetry modes, in display order — shared by the panel's
// segmented control and the navbar Symmetry combo.
export const SYMMETRY_MODES: { id: SymmetryMode; label: string }[] = [
  { id: "none", label: "None" },
  { id: "radial", label: "Radial" },
  { id: "mirror", label: "Mirror" },
  { id: "concentric", label: "Concentric" },
  { id: "spiral", label: "Spiral" },
  { id: "tile", label: "Tile" },
];

// The Symmetry controls: a None / Tile / Radial / Mirror segmented control plus the
// params for the chosen mode. Reads/writes the controller and rebuilds the
// params when the mode changes. Hosted in the Symmetry box (its own panel).
export function makeSymmetrySection(c: SymmetryController): HTMLElement {
  const root = document.createElement("div");
  root.className = "sym-section";

  const modes = SYMMETRY_MODES;
  const seg = document.createElement("div");
  seg.className = "sym-seg";
  const segBtns = new Map<SymmetryMode, HTMLButtonElement>();
  for (const m of modes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sym-seg-btn sym-mode-btn";
    btn.innerHTML =
      SYMMETRY_MODE_ICONS[m.id] + `<span class="sym-seg-lbl">${m.label}</span>`;
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

  const slider = (
    text: string,
    min: number,
    max: number,
    value: number,
    onInput: (v: number) => void,
    help?: string,
  ): HTMLElement => {
    const row = document.createElement("div");
    row.className = "sym-row";
    const l = document.createElement("span");
    l.className = "sym-rowlabel";
    l.textContent = text;
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
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

  const colorRow = (
    text: string,
    value: string,
    onInput: (v: string) => void,
  ): HTMLElement => {
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

  // Guide-line appearance (opacity / width / color), shared by Tile, Radial and
  // Mirror. Shown below the mode-specific params whenever a mode is active.
  const appearanceRows = (): HTMLElement[] => {
    const head = document.createElement("div");
    head.className = "sym-subhead";
    head.textContent = "Guides";
    return [
      head,
      slider("Opacity", 0, 100, Math.round(c.guide.alpha * 100), (v) =>
        c.setGuide({ alpha: v / 100 }),
      ),
      slider("Width", 1, 3, c.guide.width, (v) => c.setGuide({ width: v })),
      colorRow("Color", c.guide.color, (v) => c.setGuide({ color: v })),
    ];
  };

  // Movable symmetry centre (Radial / Mirror / Concentric), as a percent of the
  // canvas. Shown below the mode-specific params for any centred mode.
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

    const xRow = slider(
      "X",
      0,
      100,
      Math.round(c.centerX * 100),
      (v) => c.setCenter({ x: v / 100 }),
      "Horizontal position of the symmetry centre, as a percent of the canvas width.",
    );
    const yRow = slider(
      "Y",
      0,
      100,
      Math.round(c.centerY * 100),
      (v) => c.setCenter({ y: v / 100 }),
      "Vertical position of the symmetry centre, as a percent of the canvas height.",
    );

    // Snap the centre back to the middle of the canvas and sync the two sliders.
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

  const renderParams = () => {
    params.replaceChildren();
    if (c.mode === "tile") {
      // Reach + Falloff only shape the faded patch around the stroke; "Fill
      // canvas" tiles the whole canvas at full strength, so they do nothing
      // then — gray them out while it's on.
      const reachRow = slider(
        "Reach",
        20,
        800,
        c.tile.reach,
        (v) => c.setTile({ reach: v }),
        "How far the tiling spreads out from where you started, in pixels.",
      );
      const falloffRow = slider(
        "Falloff",
        0,
        100,
        c.tile.falloffPct,
        (v) => c.setTile({ falloffPct: v }),
        "How sharply copies fade toward the reach edge. 0 = even; higher = a soft vignette.",
      );
      const setFillDisabled = (on: boolean) => {
        for (const row of [reachRow, falloffRow]) {
          row.classList.toggle("disabled", on);
          const input = row.querySelector("input");
          if (input) input.disabled = on;
        }
      };

      const fillRow = document.createElement("div");
      fillRow.className = "sym-row";
      const fl = document.createElement("span");
      fl.className = "sym-rowlabel";
      fl.textContent = "Fill canvas";
      const fcb = document.createElement("input");
      fcb.type = "checkbox";
      fcb.className = "sym-check";
      fcb.checked = c.tile.fillCanvas;
      fcb.addEventListener("click", (e) => e.stopPropagation());
      fcb.addEventListener("change", (e) => {
        e.stopPropagation();
        c.setTile({ fillCanvas: fcb.checked });
        setFillDisabled(fcb.checked);
      });
      fillRow.append(fl, fcb);
      attachHelp(
        fl,
        "Tile the motif across the whole canvas at full strength instead of a faded patch - Reach and Falloff then don't apply. Best with a small motif.",
      );

      params.append(
        slider("X spacing", 10, 200, c.tile.xSpacing, (v) => c.setTile({ xSpacing: v })),
        slider("Y spacing", 10, 200, c.tile.ySpacing, (v) => c.setTile({ ySpacing: v })),
        fillRow,
        reachRow,
        falloffRow,
      );
      setFillDisabled(c.tile.fillCanvas);
    } else if (c.mode === "radial") {
      params.appendChild(
        slider(
          "Segments",
          2,
          24,
          c.radial.segments,
          (v) => c.setRadial({ segments: v }),
          "How many wedges the kaleidoscope splits into around the canvas centre.",
        ),
      );
      const row = document.createElement("div");
      row.className = "sym-row";
      const l = document.createElement("span");
      l.className = "sym-rowlabel";
      l.textContent = "Mirror";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "sym-check";
      cb.checked = c.radial.mirror;
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", (e) => {
        e.stopPropagation();
        c.setRadial({ mirror: cb.checked });
      });
      row.append(l, cb);
      attachHelp(
        l,
        "Also reflect each wedge, so the pattern is symmetric within every slice (a true kaleidoscope).",
      );
      params.appendChild(row);
      params.append(...centerRows());
    } else if (c.mode === "mirror") {
      // Quick axis buttons set the angle (vertical line = 90, horizontal = 0);
      // the Angle slider tilts it to any diagonal.
      const seg = document.createElement("div");
      seg.className = "sym-seg";
      const axes: { id: "vertical" | "horizontal"; label: string; angle: number }[] = [
        { id: "vertical", label: "Vertical", angle: 90 },
        { id: "horizontal", label: "Horizontal", angle: 0 },
      ];
      for (const ax of axes) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "sym-seg-btn sym-axis-btn" + (c.mirror.angle === ax.angle ? " active" : "");
        btn.innerHTML = AXIS_ICON[ax.id] + `<span class="sym-seg-lbl">${ax.label}</span>`;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          c.setMirror({ angle: ax.angle });
          renderParams();
        });
        seg.appendChild(btn);
      }
      params.appendChild(seg);
      params.appendChild(
        slider(
          "Angle",
          0,
          180,
          Math.round(c.mirror.angle),
          (v) => c.setMirror({ angle: v }),
          "Tilt the mirror line. 90 = vertical, 0 = horizontal, in between = a diagonal mirror.",
        ),
      );
      params.append(...centerRows());
    } else if (c.mode === "concentric") {
      params.append(
        slider(
          "Rings",
          2,
          12,
          c.concentric.rings,
          (v) => c.setConcentric({ rings: v }),
          "How many scaled copies radiate from the centre (including the original).",
        ),
        slider(
          "Scale %",
          50,
          150,
          c.concentric.scalePct,
          (v) => c.setConcentric({ scalePct: v }),
          "Size of each ring vs the previous. Under 100 shrinks inward; over 100 grows outward.",
        ),
        slider(
          "Twist",
          -90,
          90,
          c.concentric.twist,
          (v) => c.setConcentric({ twist: v }),
          "Rotate each ring a little for a spiral mandala. 0 = pure concentric rings.",
        ),
        ...centerRows(),
      );
    } else if (c.mode === "spiral") {
      params.append(
        slider(
          "Copies",
          3,
          40,
          c.spiral.copies,
          (v) => c.setSpiral({ copies: v }),
          "How many copies march around the spiral (per arm).",
        ),
        slider(
          "Arms",
          1,
          6,
          c.spiral.arms,
          (v) => c.setSpiral({ arms: v }),
          "Repeat the whole spiral this many times, spread evenly around the centre.",
        ),
        slider(
          "Angle step",
          5,
          120,
          c.spiral.angleStep,
          (v) => c.setSpiral({ angleStep: v }),
          "Degrees of rotation between successive copies. Copies × Angle step = total sweep.",
        ),
        slider(
          "Scale %",
          70,
          100,
          c.spiral.scalePct,
          (v) => c.setSpiral({ scalePct: v }),
          "Size of each copy vs the previous. Under 100 spirals inward; 100 = a flat rotational fan.",
        ),
        ...centerRows(),
      );
    }

    // The shared guide-appearance controls follow the per-mode params (any mode
    // but None, which draws no guides).
    if (c.mode !== "none") params.append(...appearanceRows());
  };

  syncMode();
  renderParams();

  // Keep the panel's mode picker + params in sync when the mode is changed
  // elsewhere (the navbar Symmetry combo). Only react to MODE changes — a
  // param tweak (same mode) must not rebuild the params mid-slider-drag.
  let lastMode = c.mode;
  c.subscribe(() => {
    if (c.mode === lastMode) return;
    lastMode = c.mode;
    syncMode();
    renderParams();
  });

  return root;
}

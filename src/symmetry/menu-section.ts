import { SymmetryController, type SymmetryMode } from "./controller";

// Mode glyphs: None = crossed circle (off); Radial = spoked circle; Mirror =
// dashed axis with two mirrored arrows; Tile = a 2×2 lattice.
const ICON: Record<SymmetryMode, string> = {
  none:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.8"/><line x1="4" y1="4" x2="12" y2="12"/></svg>',
  radial:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="8" r="5.8"/><path d="M8 2.2 V13.8 M2.2 8 H13.8 M3.9 3.9 L12.1 12.1 M12.1 3.9 L3.9 12.1"/></svg>',
  mirror:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="2" x2="8" y2="14" stroke-dasharray="2 2"/><path d="M6 5 L3 8 L6 11 Z"/><path d="M10 5 L13 8 L10 11 Z"/></svg>',
  tile:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2.4" y="2.4" width="4.6" height="4.6" rx="0.8"/><rect x="9" y="2.4" width="4.6" height="4.6" rx="0.8"/><rect x="2.4" y="9" width="4.6" height="4.6" rx="0.8"/><rect x="9" y="9" width="4.6" height="4.6" rx="0.8"/></svg>',
};

// Mirror-axis glyphs: the dashed reflection line with arrows mirroring across
// it. A vertical line flips left/right — the Mirror mode glyph already draws
// exactly that, so reuse it; horizontal is the same picture rotated 90°.
const AXIS_ICON: Record<"vertical" | "horizontal", string> = {
  vertical: ICON.mirror,
  horizontal:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="8" x2="14" y2="8" stroke-dasharray="2 2"/><path d="M5 6 L8 3 L11 6 Z"/><path d="M5 10 L8 13 L11 10 Z"/></svg>',
};

// The Symmetry controls: a None / Tile / Radial / Mirror segmented control plus the
// params for the chosen mode. Reads/writes the controller and rebuilds the
// params when the mode changes. Hosted in the Symmetry box (its own panel).
export function makeSymmetrySection(c: SymmetryController): HTMLElement {
  const root = document.createElement("div");
  root.className = "sym-section";

  const modes: { id: SymmetryMode; label: string }[] = [
    { id: "none", label: "None" },
    { id: "radial", label: "Radial" },
    { id: "mirror", label: "Mirror" },
    { id: "tile", label: "Tile" },
  ];
  const seg = document.createElement("div");
  seg.className = "sym-seg";
  const segBtns = new Map<SymmetryMode, HTMLButtonElement>();
  for (const m of modes) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sym-seg-btn sym-mode-btn";
    btn.innerHTML = ICON[m.id] + `<span class="sym-seg-lbl">${m.label}</span>`;
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

  const renderParams = () => {
    params.replaceChildren();
    if (c.mode === "tile") {
      params.append(
        slider("X spacing", 10, 200, c.tile.xSpacing, (v) => c.setTile({ xSpacing: v })),
        slider("Y spacing", 10, 200, c.tile.ySpacing, (v) => c.setTile({ ySpacing: v })),
        slider("Reach", 20, 800, c.tile.reach, (v) => c.setTile({ reach: v })),
        slider("Falloff", 0, 100, c.tile.falloffPct, (v) => c.setTile({ falloffPct: v })),
      );
    } else if (c.mode === "radial") {
      params.appendChild(
        slider("Segments", 2, 24, c.radial.segments, (v) => c.setRadial({ segments: v })),
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
      params.appendChild(row);
    } else if (c.mode === "mirror") {
      // A single reflection line: pick which axis (its own segmented control).
      const seg = document.createElement("div");
      seg.className = "sym-seg";
      const axes: { id: "vertical" | "horizontal"; label: string }[] = [
        { id: "vertical", label: "Vertical" },
        { id: "horizontal", label: "Horizontal" },
      ];
      for (const ax of axes) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "sym-seg-btn sym-axis-btn" + (c.mirror.axis === ax.id ? " active" : "");
        btn.innerHTML = AXIS_ICON[ax.id] + `<span class="sym-seg-lbl">${ax.label}</span>`;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          c.setMirror({ axis: ax.id });
          renderParams();
        });
        seg.appendChild(btn);
      }
      params.appendChild(seg);
    }

    // The shared guide-appearance controls follow the per-mode params (any mode
    // but None, which draws no guides).
    if (c.mode !== "none") params.append(...appearanceRows());
  };

  syncMode();
  renderParams();
  return root;
}

// "Comb" control: a compact inline nub. Drag sets grain strength (distance from
// centre) and angle (direction); a Crosshatch toggle sits beside it. One control
// for the old Grain / Grain angle / Crosshatch sliders.
export interface CombPad {
  el: HTMLElement;
}

const NS = "http://www.w3.org/2000/svg";
const CX = 50;
const CY = 50;
const R = 40; // pad radius in the 100x100 viewBox

export function createCombPad(opts: {
  getAngle: () => number; // grain angle in degrees, 0..180 (an axis - wraps at 180)
  onAngle: (deg: number) => void;
  getStrength: () => number; // 0..1
  onStrength: (v: number) => void;
  getCross: () => boolean;
  onCross: (v: boolean) => void;
  commit: () => void; // persist after any change
}): CombPad {
  const { getAngle, onAngle, getStrength, onStrength, getCross, onCross, commit } = opts;

  const wrap = document.createElement("div");
  wrap.className = "comb-row-control";

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.classList.add("comb-nub");

  const ring = document.createElementNS(NS, "circle");
  ring.setAttribute("cx", String(CX));
  ring.setAttribute("cy", String(CY));
  ring.setAttribute("r", String(R));
  ring.setAttribute("class", "comb-pad-ring");
  svg.appendChild(ring);

  const teeth = document.createElementNS(NS, "g");
  teeth.setAttribute("class", "comb-pad-teeth");
  svg.appendChild(teeth);

  const handle = document.createElementNS(NS, "circle");
  handle.setAttribute("r", "9");
  handle.setAttribute("class", "comb-pad-handle");
  svg.appendChild(handle);

  wrap.appendChild(svg);

  // Crosshatch: a small icon toggle (woven diagonal glyph) on the same row.
  const xbtn = document.createElement("button");
  xbtn.type = "button";
  xbtn.className = "comb-cross-toggle";
  xbtn.title = "Crosshatch - comb two ways at once";
  xbtn.setAttribute("aria-label", "Crosshatch");
  xbtn.innerHTML =
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">' +
    '<path d="M2 6 L10 14 M6 2 L14 10 M14 6 L6 14 M10 2 L2 10"/></svg>';
  wrap.appendChild(xbtn);

  // One chord across the disc, perpendicular-offset from centre, clipped to R.
  function chord(offset: number, ux: number, uy: number, cls: string): void {
    const px = -uy;
    const py = ux;
    const ox = CX + px * offset;
    const oy = CY + py * offset;
    const half = Math.sqrt(Math.max(0, R * R - offset * offset));
    const l = document.createElementNS(NS, "line");
    l.setAttribute("x1", String(ox - ux * half));
    l.setAttribute("y1", String(oy - uy * half));
    l.setAttribute("x2", String(ox + ux * half));
    l.setAttribute("y2", String(oy + uy * half));
    l.setAttribute("class", cls);
    teeth.appendChild(l);
  }

  // Display angle is full-circle so the handle follows the pointer; the engine
  // angle folds to a 0..180 axis (else dragging up mirrors the handle back down).
  let dispRad = (getAngle() * Math.PI) / 180;

  function render(): void {
    const s = Math.max(0, Math.min(1, getStrength()));
    const ux = Math.cos(dispRad);
    const uy = Math.sin(dispRad);

    handle.setAttribute("cx", String(CX + ux * s * R));
    handle.setAttribute("cy", String(CY + uy * s * R));

    teeth.replaceChildren();
    if (s < 0.06) {
      // Even-mesh hint: faint lines every 45deg, so an idle nub reads as "no comb".
      for (let k = 0; k < 4; k++) {
        const tk = (k * Math.PI) / 4;
        chord(0, Math.cos(tk), Math.sin(tk), "comb-pad-line comb-pad-mesh");
      }
      xbtn.classList.toggle("on", getCross());
      return;
    }
    const count = 1 + Math.round(s * 2); // 1..3 teeth per side (legible at ~34px)
    const spread = R * 0.62 * s;
    for (let i = 0; i < count; i++) {
      const off = count === 1 ? 0 : (i / (count - 1) - 0.5) * 2 * spread;
      chord(off, ux, uy, "comb-pad-line");
      if (getCross()) chord(off, -uy, ux, "comb-pad-line comb-pad-line-cross");
    }
    xbtn.classList.toggle("on", getCross());
  }

  function fromEvent(e: PointerEvent): void {
    const rect = svg.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * 100;
    const vy = ((e.clientY - rect.top) / rect.height) * 100;
    const dx = vx - CX;
    const dy = vy - CY;
    const dist = Math.hypot(dx, dy);
    onStrength(Number(Math.max(0, Math.min(1, dist / R)).toFixed(2)));
    if (dist > 1) {
      dispRad = Math.atan2(dy, dx); // handle follows the pointer, full circle
      let deg = (dispRad * 180) / Math.PI;
      deg = ((deg % 180) + 180) % 180; // engine uses the 0..180 axis (symmetric)
      onAngle(Math.round(deg));
    }
    render();
    commit();
  }

  let dragging = false;
  svg.addEventListener("pointerdown", (e) => {
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    fromEvent(e);
    e.preventDefault();
  });
  svg.addEventListener("pointermove", (e) => {
    if (dragging) fromEvent(e);
  });
  const end = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    try {
      svg.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);

  xbtn.addEventListener("click", () => {
    onCross(!getCross());
    render();
    commit();
  });

  render();
  return { el: wrap };
}

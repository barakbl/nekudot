import { makeCloseButton } from "../settings-panel";
import { makeToggle } from "../ui/toggle";

// The navbar Maps icon opens this subpanel (card #88): a navbar-anchored popover
// (like the colour picker), NOT a draggable window. It pins an explainer + a "Live
// view" toggle, then lists the memory maps (live dot counts, active bold) - each
// row can flash / select / rename / delete its map.
export type MapsControl = {
  // Read live each render (counts change as you draw). Lists every map with its
  // dot count; the active map is flagged (shown bold).
  getInfo: () => { maps: { name: string; dots: number; active: boolean }[] };
  onFlashActive: () => void; // flash the active map's dots
  onFlashMap: (index: number) => void; // flash a specific map (per-row icon)
  onAddMap: () => void; // create a new map (made active)
  onRenameMap: (index: number, name: string) => void; // inline rename in the list
  onSelectMap: (index: number) => void; // make a listed map the active one
  onDeleteMap: (index: number) => void; // delete a map (the app confirms first)
  // "Live view" (the persistent hot-map highlight): keep the active map's dots
  // visible on the canvas while drawing. The top-of-panel toggle drives it and
  // the navbar icon lights up while it's on.
  isLiveView: () => boolean;
  setLiveView: (on: boolean) => void;
  // Highlight dot colour (shared by flash + the live-view highlight). The swatch
  // shows getHighlightColor; clicking it opens the colour picker by the anchor.
  getHighlightColor: () => string;
  onPickHighlightColor: (anchor: HTMLElement) => void;
  // Re-render the list when maps change (add/select/rename/delete, undo/redo).
  subscribe: (fn: () => void) => () => void;
};

export type MapsBox = {
  el: HTMLElement;
  open: (anchor: HTMLElement) => void; // reveal the popover next to `anchor`
  close: () => void;
  isOpen: () => boolean;
  render: () => void;
};

// The target glyph (matches the navbar cloud icon's "live" feel), reused for the
// Live-view row and each per-map flash icon.
const FLASH_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">' +
  '<circle cx="8" cy="8" r="5.2"/>' +
  '<circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/>' +
  '<path d="M8 0.5 V2.5 M8 13.5 V15.5 M0.5 8 H2.5 M13.5 8 H15.5" stroke-linecap="round"/>' +
  "</svg>";

const DELETE_ICON =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M7 7l1 13h8l1-13"/></svg>';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function createMapsBox(
  control: MapsControl,
  // Builds the routing "Connection" group for the active brush (moved here from
  // the Connecting tab). Re-run on every render; `rerender` refreshes the box.
  renderRouting?: (rerender: () => void) => HTMLElement | null,
): MapsBox {
  const panel = document.createElement("div");
  panel.className = "maps-popover";
  panel.style.display = "none";

  // Header (title + close). The whole popover scrolls if it gets tall.
  const header = document.createElement("div");
  header.className = "panel-header";
  const title = document.createElement("h3");
  title.textContent = "Memory Maps";
  header.appendChild(title);
  header.appendChild(makeCloseButton(() => close()));
  panel.appendChild(header);

  // Always-visible explainer of the memory-map idea (no help mode needed). Kept a
  // direct child of the panel root (see maps-box.test.ts).
  const intro = document.createElement("p");
  intro.className = "maps-intro";
  intro.textContent =
    "Every dot your brush drops is remembered here - connecting brushes weave lines between nearby dots.";
  panel.appendChild(intro);

  // Live-view toggle (top of the panel): keeps the active map's dots quietly
  // visible on the canvas while drawing (the old navbar flash button's job). The
  // switch reads control.isLiveView(); flipping it also lights the navbar icon.
  const liveRow = document.createElement("div");
  liveRow.className = "maps-live-row";
  const liveIcon = document.createElement("span");
  liveIcon.className = "maps-live-icon";
  liveIcon.innerHTML = FLASH_ICON;
  const liveText = document.createElement("div");
  liveText.className = "maps-live-text";
  const liveLabel = document.createElement("span");
  liveLabel.className = "maps-live-label";
  liveLabel.textContent = "Live view";
  const liveSub = document.createElement("span");
  liveSub.className = "maps-live-sub";
  liveSub.textContent = "Show this map's dots on the canvas while you draw";
  liveText.append(liveLabel, liveSub);
  const liveToggle = makeToggle(control.isLiveView(), (v) => {
    control.setLiveView(v);
    render(); // reflect the new state (row glow; navbar icon done by setLiveView)
  });
  liveRow.append(liveIcon, liveText, liveToggle.el);
  panel.appendChild(liveRow);

  // "New map" creates a map (made active by the manager) and re-renders so the
  // fresh map shows immediately, ready to rename.
  const addBtn = document.createElement("button");
  addBtn.className = "layers-add-btn";
  addBtn.type = "button";
  addBtn.textContent = "+ New map";
  addBtn.addEventListener("click", () => {
    control.onAddMap();
    render();
  });
  panel.appendChild(addBtn);

  const info = document.createElement("div");
  info.className = "maps-menu-info";
  panel.appendChild(info);
  const countEl = document.createElement("div");
  countEl.className = "maps-menu-count";
  const listEl = document.createElement("div");
  listEl.className = "maps-menu-list";
  info.append(countEl, listEl);

  // The routing "Connection" group (which map the web reads from / writes to).
  const routingSlot = document.createElement("div");
  routingSlot.className = "maps-routing";
  panel.appendChild(routingSlot);

  // Highlight colour: a swatch that opens the colour picker; recolours both the
  // flash and the live-view dots. Its fill is refreshed in render().
  const colorRow = document.createElement("div");
  colorRow.className = "maps-color-row";
  const colorLabel = document.createElement("span");
  colorLabel.className = "maps-color-label";
  colorLabel.textContent = "Highlight color";
  const colorSwatch = document.createElement("button");
  colorSwatch.type = "button";
  colorSwatch.className = "maps-color-swatch";
  colorSwatch.title = "Choose the colour for flashed + live map dots";
  colorSwatch.addEventListener("click", (e) => {
    e.stopPropagation();
    control.onPickHighlightColor(colorSwatch);
  });
  colorRow.append(colorLabel, colorSwatch);
  panel.appendChild(colorRow);

  const render = () => {
    liveToggle.set(control.isLiveView());
    liveRow.classList.toggle("is-on", control.isLiveView());
    routingSlot.replaceChildren();
    const routing = renderRouting?.(render);
    if (routing) routingSlot.appendChild(routing);
    colorSwatch.style.background = control.getHighlightColor();
    const { maps } = control.getInfo();
    countEl.textContent = plural(maps.length, "map");
    listEl.replaceChildren();
    maps.forEach((m, i) => {
      const row = document.createElement("div");
      row.className = "maps-menu-row" + (m.active ? " active" : "");

      const flash = document.createElement("button");
      flash.type = "button";
      flash.className = "maps-menu-flash";
      flash.title = `Flash ${m.name} on canvas`;
      flash.innerHTML = FLASH_ICON;
      flash.addEventListener("click", (e) => {
        e.stopPropagation();
        control.onFlashMap(i);
      });

      const name = document.createElement("span");
      name.className = "maps-menu-name";
      name.title = "Rename map";
      name.textContent = m.name;
      name.tabIndex = 0;
      name.setAttribute("role", "button");
      name.setAttribute("aria-label", `Rename map ${m.name}`);
      // Swap the label for an inline input; Enter/blur commits, Escape cancels.
      // stopPropagation on keys so brush shortcuts don't fire.
      const startRename = () => {
        const input = document.createElement("input");
        input.className = "maps-menu-name-input";
        input.value = m.name;
        row.replaceChild(input, name);
        input.focus();
        input.select();
        let done = false;
        const commit = (save: boolean) => {
          if (done) return;
          done = true;
          if (save) control.onRenameMap(i, input.value.trim());
          render();
        };
        input.addEventListener("click", (ev) => ev.stopPropagation());
        input.addEventListener("keydown", (ev) => {
          ev.stopPropagation();
          if (ev.key === "Enter") commit(true);
          else if (ev.key === "Escape") commit(false);
        });
        input.addEventListener("blur", () => commit(true));
      };
      name.addEventListener("click", (e) => {
        e.stopPropagation();
        startRename();
      });
      name.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== "F2") return;
        e.preventDefault();
        e.stopPropagation();
        startRename();
      });

      // Active map gets an "(Active)" tag; the others get a Select button that
      // makes them active.
      let middle: HTMLElement;
      if (m.active) {
        const tag = document.createElement("span");
        tag.className = "maps-menu-tag";
        tag.textContent = "(Active)";
        middle = tag;
      } else {
        const sel = document.createElement("button");
        sel.type = "button";
        sel.className = "maps-menu-select";
        sel.textContent = "Select";
        sel.title = `Make ${m.name} the active map`;
        sel.addEventListener("click", (e) => {
          e.stopPropagation();
          control.onSelectMap(i);
        });
        middle = sel;
      }

      const dots = document.createElement("span");
      dots.className = "maps-menu-dots";
      const dotsN = document.createElement("span");
      dotsN.textContent = String(m.dots);
      const dotsU = document.createElement("span");
      dotsU.className = "maps-menu-dots-unit";
      dotsU.textContent = m.dots === 1 ? " dot" : " dots";
      dots.append(dotsN, dotsU);

      // Delete (offered only when >1 map, since one must remain) sits on the far
      // left; clicking lets the app confirm before removing.
      let del: HTMLButtonElement | null = null;
      if (maps.length > 1) {
        del = document.createElement("button");
        del.type = "button";
        del.className = "maps-menu-delete";
        del.title = `Delete ${m.name}`;
        del.innerHTML = DELETE_ICON;
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          control.onDeleteMap(i);
        });
      }
      if (del) row.append(del);
      row.append(middle, flash, name, dots);
      listEl.appendChild(row);
    });
  };

  control.subscribe(render);
  render();

  // --- open / close / positioning (mirrors the colour picker popover) --------
  let onDocPointerDown: ((e: PointerEvent) => void) | null = null;
  let onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  let lastAnchor: HTMLElement | null = null;

  const isOpen = () => panel.style.display !== "none";

  const open = (anchor: HTMLElement) => {
    if (isOpen() && lastAnchor === anchor) {
      close(); // clicking the same anchor again toggles the panel shut
      return;
    }
    lastAnchor = anchor;
    render(); // fresh dot counts + live-view state each time it opens
    panel.style.display = "";
    positionNear(anchor);
    // Attach the outside-click dismiss on the next tick so the click that opened
    // the popover doesn't immediately close it.
    setTimeout(() => attachDismiss(anchor), 0);
  };

  const close = () => {
    panel.style.display = "none";
    detachDismiss();
  };

  function attachDismiss(anchor: HTMLElement): void {
    detachDismiss();
    onDocPointerDown = (e) => {
      const t = e.target as Element | null;
      if (!t) return;
      // Keep open for clicks on ourselves, the anchor, or the popovers/modals we
      // spawn: the highlight colour picker and the delete confirm dialog.
      if (
        panel.contains(t) ||
        anchor.contains(t) ||
        t.closest(".color-palette-popover") ||
        t.closest(".app-modal")
      )
        return;
      close();
    };
    onKeyDown = (e) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
  }

  function detachDismiss(): void {
    if (onDocPointerDown)
      document.removeEventListener("pointerdown", onDocPointerDown, true);
    if (onKeyDown) document.removeEventListener("keydown", onKeyDown, true);
    onDocPointerDown = null;
    onKeyDown = null;
  }

  // Place the popover next to its anchor: below by default, flipped above when
  // there isn't room, and clamped to the viewport. On phones the CSS makes it a
  // bottom sheet, so clear any inline coords and let the stylesheet position it.
  function positionNear(anchor: HTMLElement): void {
    if (window.matchMedia("(max-width: 640px)").matches) {
      panel.style.left = panel.style.top = panel.style.right = panel.style.bottom = "";
      return;
    }
    const gap = 8;
    const margin = 8;
    const a = anchor.getBoundingClientRect();
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    let top = a.bottom + gap;
    if (top + ph > window.innerHeight - margin && a.top - gap - ph > margin)
      top = a.top - gap - ph;
    // Right-align to the anchor so the panel opens under the toolbar's right side.
    let left = a.right - pw;
    left = Math.min(left, window.innerWidth - pw - margin);
    left = Math.max(margin, left);
    top = Math.min(top, window.innerHeight - ph - margin);
    top = Math.max(margin, top);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  window.addEventListener("resize", () => {
    if (isOpen() && lastAnchor) positionNear(lastAnchor);
  });

  return { el: panel, open, close, isOpen, render };
}

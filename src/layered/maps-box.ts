import { makeCloseButton } from "../settings-panel";
import { makeDraggable } from "../drag";

// The navbar Maps pill opens this box. It lists the memory maps with live dot
// counts (the active map is bold), and each row can flash / select / rename /
// delete its map. Shares the panel chrome with the Layers/Symmetry boxes; the
// list rows reuse the .maps-menu-* styles that used to live in the popover.
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
  // Re-render the list when maps change (add/select/rename/delete, undo/redo).
  subscribe: (fn: () => void) => () => void;
};

export type MapsBox = {
  el: HTMLElement;
  toggle: () => void;
  render: () => void;
};

// The target glyph (matches the navbar Flash button), reused for each per-map
// flash icon.
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

export function createMapsBox(control: MapsControl): MapsBox {
  const panel = document.createElement("div");
  panel.className = "layers-box maps-box";
  panel.style.display = "none";

  const header = document.createElement("div");
  header.className = "panel-header";
  const title = document.createElement("h3");
  title.textContent = "Memory Maps";
  header.appendChild(title);
  header.appendChild(
    makeCloseButton(() => {
      panel.style.display = "none";
    }),
  );
  panel.appendChild(header);
  makeDraggable(panel, header);

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

  const render = () => {
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
      name.title = "Click to rename";
      name.textContent = m.name;
      // Click the name to rename inline: swap in an input; Enter/blur commits,
      // Escape cancels. stopPropagation on keys so brush shortcuts don't fire.
      name.addEventListener("click", (e) => {
        e.stopPropagation();
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

  const toggle = () => {
    const hidden = panel.style.display === "none";
    panel.style.display = hidden ? "" : "none";
    if (hidden) render(); // fresh dot counts each time it opens
  };

  return { el: panel, toggle, render };
}

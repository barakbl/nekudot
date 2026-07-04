export type VTab = { id: string; label: string; content: HTMLElement };

// A vertical tab strip: a left rail of tab buttons + a content area that shows
// one tab at a time. Used to fold floating windows into tabbed panels (App
// settings is the first). Accessible: role tablist/tab/tabpanel, roving
// tabindex, Up/Down + Home/End between tabs.
export function createVerticalTabs(tabs: VTab[]): {
  el: HTMLElement;
  show: (id: string) => void;
  active: () => string;
} {
  const el = document.createElement("div");
  el.className = "vtabs";
  const rail = document.createElement("div");
  rail.className = "vtabs-rail";
  rail.setAttribute("role", "tablist");
  rail.setAttribute("aria-orientation", "vertical");
  const panels = document.createElement("div");
  panels.className = "vtabs-panels";
  el.append(rail, panels);

  const btns = new Map<string, HTMLButtonElement>();
  const panelEls = new Map<string, HTMLElement>();
  const ids = tabs.map((t) => t.id);
  let current = ids[0] ?? "";

  const show = (id: string): void => {
    if (!btns.has(id)) return;
    current = id;
    for (const [tid, b] of btns) {
      const on = tid === id;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    }
    for (const [tid, p] of panelEls) p.style.display = tid === id ? "" : "none";
  };

  for (const tab of tabs) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "vtab";
    b.id = `vtab-${tab.id}`;
    b.setAttribute("role", "tab");
    b.textContent = tab.label;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      show(tab.id);
    });
    b.addEventListener("keydown", (e) => {
      const idx = ids.indexOf(current);
      let next = -1;
      if (e.key === "ArrowDown") next = (idx + 1) % ids.length;
      else if (e.key === "ArrowUp") next = (idx - 1 + ids.length) % ids.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = ids.length - 1;
      if (next < 0) return;
      e.preventDefault();
      show(ids[next]);
      btns.get(ids[next])?.focus();
    });

    const panel = document.createElement("div");
    panel.className = "vtab-panel";
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", b.id);
    panel.append(tab.content);

    btns.set(tab.id, b);
    panelEls.set(tab.id, panel);
    rail.append(b);
    panels.append(panel);
  }
  show(current);

  return { el, show, active: () => current };
}

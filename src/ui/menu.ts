// Layers WAI-ARIA menu-button semantics + keyboard nav onto an existing
// trigger + popover pair; visuals stay driven by the existing "open" class.

export type MenuController = {
  open: (focusFirst?: boolean) => void;
  close: (returnFocus?: boolean) => void;
  toggle: (focusFirst?: boolean) => void;
  isOpen: () => boolean;
};

export function attachMenu(opts: {
  trigger: HTMLElement; // the button that opens the menu
  menu: HTMLElement; // the popover (gets role="menu")
  container: HTMLElement; // wrapper holding both (outside-click scope)
  itemSelector?: string; // navigable rows (default '[role="menuitem"]')
}): MenuController {
  const { trigger, menu, container } = opts;
  // Matches menuitem, menuitemradio and menuitemcheckbox.
  const itemSelector = opts.itemSelector ?? '[role^="menuitem"]';

  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  if (trigger instanceof HTMLButtonElement && !trigger.getAttribute("type"))
    trigger.type = "button";
  menu.setAttribute("role", "menu");

  // Live query so dynamically rebuilt menus (the Connecting combo) just work.
  // Skip disabled rows (e.g. Export with no presets yet).
  const items = (): HTMLElement[] =>
    Array.from(menu.querySelectorAll<HTMLElement>(itemSelector)).filter(
      (el) =>
        !el.hasAttribute("disabled") &&
        el.getAttribute("aria-disabled") !== "true",
    );

  const isOpen = () => menu.classList.contains("open");

  const focusItem = (list: HTMLElement[], i: number) => {
    if (!list.length) return;
    const idx = ((i % list.length) + list.length) % list.length;
    for (const el of list) el.tabIndex = -1;
    list[idx].tabIndex = 0;
    list[idx].focus();
  };

  const open = (focusFirst = false) => {
    if (!isOpen()) {
      menu.classList.add("open");
      trigger.setAttribute("aria-expanded", "true");
    }
    if (focusFirst) focusItem(items(), 0);
  };

  const close = (returnFocus = false) => {
    if (!isOpen()) return;
    menu.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
    if (returnFocus) trigger.focus();
  };

  const toggle = (focusFirst = false) =>
    isOpen() ? close(focusFirst) : open(focusFirst);

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });

  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      open();
      const list = items();
      focusItem(list, list.length - 1);
    }
  });

  menu.addEventListener("keydown", (e) => {
    const list = items();
    const current = document.activeElement as HTMLElement | null;
    const idx = current ? list.indexOf(current) : -1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focusItem(list, idx + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusItem(list, idx - 1);
        break;
      case "Home":
        e.preventDefault();
        focusItem(list, 0);
        break;
      case "End":
        e.preventDefault();
        focusItem(list, list.length - 1);
        break;
      case "Enter":
      case " ":
        // Activate the focused row via its own click handler, then mirror the
        // mouse: if that closed the menu, hand focus back to the trigger.
        if (idx >= 0) {
          e.preventDefault();
          list[idx].click();
          if (!isOpen()) trigger.focus();
        }
        break;
      case "Escape":
        e.preventDefault();
        close(true);
        break;
      case "Tab":
        close();
        break;
    }
  });

  // Persistent outside-pointer dismissal (a no-op while closed) - matches the
  // navbar menus' app-lifetime singletons, so nothing to tear down.
  document.addEventListener("mousedown", (e) => {
    if (!isOpen()) return;
    if (container.contains(e.target as Node)) return;
    close();
  });

  return { open, close, toggle, isOpen };
}

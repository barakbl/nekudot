import { showChip } from "../chip";

// Hide / show all panels - shared by the H key, the 4-finger swipe, and the
// floating button so they stay in sync. Remembers which were open to restore.
export type ToggleSource = "key" | "touch" | "button";

export type UiVisibility = {
  toggle: (source?: ToggleSource) => void;
  isHidden: () => boolean;
  subscribe: (cb: () => void) => void;
};

export function createUiVisibility(panels: () => HTMLElement[]): UiVisibility {
  let savedPanelState: boolean[] | null = null;
  const subs: Array<() => void> = [];
  const isVisible = (el: HTMLElement) => el.style.display !== "none";

  const isHidden = (): boolean => {
    const p = panels();
    return p.length > 0 && !p.some(isVisible);
  };

  const toggle = (source: ToggleSource = "key"): void => {
    const p = panels();
    if (p.some(isVisible)) {
      savedPanelState = p.map(isVisible);
      for (const el of p) el.style.display = "none";
      showChip(
        source === "key"
          ? "Menus hidden · press H or tap the button to show"
          : "Menus hidden · tap the button to show",
      );
    } else {
      // Restore defaults to just the navbar (the panels list leads with it).
      const restore = savedPanelState ?? p.map((_, i) => i === 0);
      p.forEach((el, i) => {
        el.style.display = restore[i] ? "" : "none";
      });
      savedPanelState = null;
    }
    for (const cb of subs) cb();
  };

  return {
    toggle,
    isHidden,
    subscribe: (cb) => {
      subs.push(cb);
    },
  };
}

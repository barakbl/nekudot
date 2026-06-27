// Modal focus trap (ARIA APG): cycles Tab within `container` and, on release,
// restores focus to `restoreTo` (or the element focused before it opened).

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export type FocusTrap = { release: () => void };

export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export function trapFocus(
  container: HTMLElement,
  restoreTo?: HTMLElement | null,
): FocusTrap {
  const restore = restoreTo ?? (document.activeElement as HTMLElement | null);

  // The container must be focusable so it can hold focus when it has no
  // tabbable children of its own.
  if (!container.hasAttribute("tabindex")) container.tabIndex = -1;

  const onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== "Tab") return;
    const items = getFocusable(container);
    if (items.length === 0) {
      e.preventDefault();
      container.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = active !== null && container.contains(active);
    if (e.shiftKey) {
      if (active === first || !inside) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !inside) {
      e.preventDefault();
      first.focus();
    }
  };
  container.addEventListener("keydown", onKeydown);

  // Move focus in, but don't fight a caller that already placed it inside.
  if (!(document.activeElement && container.contains(document.activeElement))) {
    const items = getFocusable(container);
    (items[0] ?? container).focus();
  }

  return {
    release(): void {
      container.removeEventListener("keydown", onKeydown);
      restore?.focus?.();
    },
  };
}

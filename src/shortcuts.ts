import { makeCloseButton } from "./settings-panel";
import { makeDraggable } from "./drag";

export type Shortcut = {
  key?: string;
  code?: string;
  shift?: boolean;
  cmdOrCtrl?: boolean;
  fingers?: 2 | 3 | 4;
  swipe?: "up";
  label?: string;
  group?: string;
  onPress: () => void;
  description?: string;
};

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPod|iPad/i.test(navigator.platform);

const TAP_MAX_DURATION_MS = 400;
const TAP_MAX_MOVEMENT_PX = 12;
const SWIPE_MIN_PX = 50; // min upward travel for a multi-finger swipe

export function bindShortcuts(shortcuts: Shortcut[]): () => void {
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLSelectElement ||
      target instanceof HTMLTextAreaElement ||
      target?.isContentEditable
    ) {
      return;
    }
    if (e.altKey) return;
    const hasMod = e.metaKey || e.ctrlKey;
    for (const s of shortcuts) {
      if (s.fingers !== undefined) continue;
      const wantsMod = s.cmdOrCtrl === true;
      if (wantsMod !== hasMod) continue;
      if (s.shift !== undefined && s.shift !== e.shiftKey) continue;
      if (s.code && s.code !== e.code) continue;
      if (s.key && s.key.toLowerCase() !== e.key.toLowerCase()) continue;
      if (!s.key && !s.code) continue;
      e.preventDefault();
      s.onPress();
      return;
    }
  };
  window.addEventListener("keydown", onKey);

  // Multi-finger gesture detection: 2/3-finger taps and a 4-finger swipe up.
  let touchStartTime = 0;
  let maxTouches = 0;
  let moved = false;
  const startPositions = new Map<number, { x: number; y: number }>();
  const lastPositions = new Map<number, { x: number; y: number }>();

  const reset = () => {
    maxTouches = 0;
    moved = false;
    startPositions.clear();
    lastPositions.clear();
  };

  const onTouchStart = (e: TouchEvent) => {
    if (startPositions.size === 0) {
      touchStartTime = performance.now();
      moved = false;
    }
    for (const t of Array.from(e.changedTouches)) {
      const pos = { x: t.clientX, y: t.clientY };
      startPositions.set(t.identifier, pos);
      lastPositions.set(t.identifier, { ...pos });
    }
    maxTouches = Math.max(maxTouches, e.touches.length);
  };

  const onTouchMove = (e: TouchEvent) => {
    for (const t of Array.from(e.touches)) {
      lastPositions.set(t.identifier, { x: t.clientX, y: t.clientY });
      const start = startPositions.get(t.identifier);
      if (start && !moved) {
        const d = Math.hypot(t.clientX - start.x, t.clientY - start.y);
        if (d > TAP_MAX_MOVEMENT_PX) moved = true;
      }
    }
  };

  // Average vertical travel (start → last) across all tracked fingers.
  const avgDy = (): number => {
    let sum = 0;
    let n = 0;
    for (const [id, start] of startPositions) {
      const last = lastPositions.get(id);
      if (!last) continue;
      sum += last.y - start.y;
      n++;
    }
    return n ? sum / n : 0;
  };

  const fire = (e: Event, match: (s: Shortcut) => boolean) => {
    for (const s of shortcuts) {
      if (match(s)) {
        e.preventDefault();
        s.onPress();
        return true;
      }
    }
    return false;
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length > 0) return;
    const duration = performance.now() - touchStartTime;
    const fingers = maxTouches;
    const dy = avgDy();
    reset();

    // 4-finger swipe up → toggle menus.
    if (fingers === 4 && dy <= -SWIPE_MIN_PX) {
      fire(e, (s) => s.fingers === 4 && s.swipe === "up");
      return;
    }
    // 2/3-finger tap.
    if (duration > TAP_MAX_DURATION_MS || moved) return;
    if (fingers !== 2 && fingers !== 3) return;
    fire(e, (s) => s.fingers === fingers && s.swipe === undefined);
  };

  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: true });
  window.addEventListener("touchend", onTouchEnd);
  window.addEventListener("touchcancel", () => reset());

  return () => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("touchstart", onTouchStart);
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("touchend", onTouchEnd);
  };
}

function fingerLabel(s: Shortcut): string {
  return `${s.fingers}-finger ${s.swipe === "up" ? "swipe up" : "tap"}`;
}

function shortcutLabel(s: Shortcut): string {
  if (s.fingers !== undefined) {
    return fingerLabel(s);
  }
  const parts: string[] = [];
  if (s.cmdOrCtrl) parts.push(IS_MAC ? "⌘" : "Ctrl");
  if (s.shift) parts.push(IS_MAC ? "⇧" : "Shift");
  const main = s.label ?? s.key?.toUpperCase() ?? s.code ?? "";
  parts.push(main);
  return IS_MAC ? parts.join("") : parts.join("+");
}

// Stable group order — groups not listed here appear after, in insertion order.
const GROUP_ORDER = ["Brushes", "Panels", "Edit", "Help", "Other"];

type GroupedShortcut = {
  description: string;
  group: string;
  keyboardLabels: string[];
  touchLabels: string[];
  onPress: () => void;
};

function groupShortcuts(shortcuts: Shortcut[]): Map<string, GroupedShortcut[]> {
  // Merge entries with the same group + description so e.g. "Undo" shows
  // both Cmd+Z and 2-finger tap on one row.
  const byKey = new Map<string, GroupedShortcut>();
  const order: string[] = [];
  for (const s of shortcuts) {
    if (!s.description) continue;
    const group = s.group ?? "Other";
    const key = `${group}::${s.description}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        description: s.description,
        group,
        keyboardLabels: [],
        touchLabels: [],
        onPress: s.onPress,
      };
      byKey.set(key, entry);
      order.push(key);
    }
    if (s.fingers !== undefined) {
      entry.touchLabels.push(fingerLabel(s));
    } else {
      entry.keyboardLabels.push(shortcutLabel(s));
    }
  }

  const byGroup = new Map<string, GroupedShortcut[]>();
  for (const k of order) {
    const e = byKey.get(k)!;
    const list = byGroup.get(e.group) ?? [];
    list.push(e);
    byGroup.set(e.group, list);
  }

  // Apply stable order.
  const ordered = new Map<string, GroupedShortcut[]>();
  for (const g of GROUP_ORDER) {
    if (byGroup.has(g)) ordered.set(g, byGroup.get(g)!);
  }
  for (const [g, v] of byGroup) {
    if (!ordered.has(g)) ordered.set(g, v);
  }
  return ordered;
}

// A draggable, persistent Shortcuts window (toggled from the Windows menu / "/").
// It only closes via its × button — not on outside-click or Escape — and
// running a row's action leaves it open.
export function createShortcutsPanel(shortcuts: Shortcut[]): {
  el: HTMLElement;
  toggle: () => void;
} {
  const panel = document.createElement("div");
  panel.className = "shortcuts-panel";
  panel.style.display = "none";

  const header = document.createElement("div");
  header.className = "panel-header";
  const title = document.createElement("h3");
  title.textContent = "Shortcuts";
  header.appendChild(title);
  header.appendChild(
    makeCloseButton(() => {
      panel.style.display = "none";
    }),
  );
  panel.appendChild(header);
  makeDraggable(panel, header);

  const card = document.createElement("div");
  card.className = "shortcuts-body";
  panel.appendChild(card);

  const hint = document.createElement("p");
  hint.className = "shortcuts-hint";
  hint.textContent = "Click a row to run it · drag the title to move · × to close.";
  card.appendChild(hint);

  for (const [groupName, items] of groupShortcuts(shortcuts)) {
    const section = document.createElement("section");
    section.className = "shortcuts-group";

    const heading = document.createElement("h4");
    heading.className = "shortcuts-group-title";
    heading.textContent = groupName;
    section.appendChild(heading);

    const table = document.createElement("div");
    table.className = "shortcuts-table";
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "shortcuts-row";
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      const fire = () => {
        item.onPress(); // run the action but leave the window open
      };
      row.addEventListener("click", fire);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fire();
        }
      });

      const descCell = document.createElement("div");
      descCell.className = "shortcuts-desc";
      descCell.textContent = item.description;
      row.appendChild(descCell);

      const kbdCell = document.createElement("div");
      kbdCell.className = "shortcuts-keys";
      for (const k of item.keyboardLabels) {
        const kbd = document.createElement("kbd");
        kbd.textContent = k;
        kbdCell.appendChild(kbd);
      }
      row.appendChild(kbdCell);

      const touchCell = document.createElement("div");
      touchCell.className = "shortcuts-touch";
      for (const t of item.touchLabels) {
        const kbd = document.createElement("kbd");
        kbd.className = "kbd-gesture";
        kbd.textContent = t;
        touchCell.appendChild(kbd);
      }
      row.appendChild(touchCell);

      table.appendChild(row);
    }
    section.appendChild(table);
    card.appendChild(section);
  }

  const toggle = () => {
    panel.style.display = panel.style.display === "none" ? "" : "none";
  };

  return { el: panel, toggle };
}

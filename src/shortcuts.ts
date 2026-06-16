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

// Input types that capture typed characters — single-key shortcuts must yield
// to these (renaming a layer, a number field). Everything else an <input> can
// be (range, checkbox, radio, color, button…) does NOT, and those fill the
// panels: focus stays on a slider/checkbox after you use it, so suppressing
// shortcuts for them killed every shortcut until you clicked the canvas.
const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "password",
  "number",
  "tel",
]);

function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.type);
  return false;
}

export function bindShortcuts(shortcuts: Shortcut[]): () => void {
  const onKey = (e: KeyboardEvent) => {
    // Only real text entry swallows shortcuts — not the sliders/toggles/colour
    // pickers in panels (those keep focus but don't consume letter keys).
    if (isTextEntry(e.target)) return;
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

// One key cap per part, in each platform's modifier order: ⇧⌘Z on mac
// (Apple HIG: shift before command), Ctrl Shift Z elsewhere.
function shortcutParts(s: Shortcut): string[] {
  const parts: string[] = [];
  if (IS_MAC) {
    if (s.shift) parts.push("⇧");
    if (s.cmdOrCtrl) parts.push("⌘");
  } else {
    if (s.cmdOrCtrl) parts.push("Ctrl");
    if (s.shift) parts.push("Shift");
  }
  parts.push(s.label ?? s.key?.toUpperCase() ?? s.code ?? "");
  return parts;
}

// Stable group order — groups not listed here appear after, in insertion order.
const GROUP_ORDER = ["Brushes", "Panels", "Edit", "Capture", "Help", "Other"];

type GroupedShortcut = {
  description: string;
  group: string;
  keyboardCombos: string[][]; // one entry per binding, one cap per part
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
        keyboardCombos: [],
        touchLabels: [],
        onPress: s.onPress,
      };
      byKey.set(key, entry);
      order.push(key);
    }
    if (s.fingers !== undefined) {
      entry.touchLabels.push(fingerLabel(s));
    } else {
      entry.keyboardCombos.push(shortcutParts(s));
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

// A draggable, persistent Shortcuts window (toggled from the Windows menu /
// "/"). It closes via its × button or the "/" toggle — not on outside-click
// or Escape — and running a row's action leaves it open.
export function createShortcutsPanel(shortcuts: Shortcut[]): {
  el: HTMLElement;
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

      // All bindings in one right-aligned cell: key combos as individual
      // caps, gestures as soft badges.
      const bindCell = document.createElement("div");
      bindCell.className = "shortcuts-bind";
      for (const combo of item.keyboardCombos) {
        const comboEl = document.createElement("span");
        comboEl.className = "key-combo";
        for (const part of combo) {
          const kbd = document.createElement("kbd");
          kbd.textContent = part;
          comboEl.appendChild(kbd);
        }
        bindCell.appendChild(comboEl);
      }
      for (const t of item.touchLabels) {
        const gesture = document.createElement("span");
        gesture.className = "kbd-gesture";
        gesture.textContent = t;
        bindCell.appendChild(gesture);
      }
      row.appendChild(bindCell);

      table.appendChild(row);
    }
    section.appendChild(table);
    card.appendChild(section);
  }

  // Pinned under the scrolling list, so it's always visible.
  const foot = document.createElement("p");
  foot.className = "shortcuts-footnote";
  foot.textContent = "Click a row to run its action";
  panel.appendChild(foot);

  return { el: panel };
}

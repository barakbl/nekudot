import { makeCloseButton } from "../settings-panel";
import { makeDraggable } from "../drag";
import { makeToggle } from "../toggle";
import { attachHelp } from "../help";
import type { Theme } from "../menu";

export type AppSettingsBox = { el: HTMLElement; toggle: () => void };

const THEMES: Theme[] = ["auto", "light", "dark"];
const THEME_GLYPH: Record<Theme, string> = { auto: "◐", light: "☀", dark: "☾" };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

// The Application settings panel: the global place for app-wide settings
// (theme, input, advanced) - as opposed to the per-brush settings panel. A
// draggable box sharing the Layers/Symmetry panel chrome.
export function createAppSettingsBox(opts: {
  theme: { initial: Theme; onChange: (t: Theme) => void };
  penEnabled: boolean;
  onTogglePen: (on: boolean) => void;
  pixelLog: boolean;
  onTogglePixelLog: (on: boolean) => void;
  // Wipe all local data and reload to a fresh app (opens its own confirm modal).
  onResetToDefault: () => void;
}): AppSettingsBox {
  const panel = document.createElement("div");
  panel.className = "layers-box app-settings-box";
  panel.style.display = "none";

  const header = document.createElement("div");
  header.className = "panel-header";
  const title = document.createElement("h3");
  title.textContent = "Application settings";
  header.appendChild(title);
  header.appendChild(makeCloseButton(() => (panel.style.display = "none")));
  panel.appendChild(header);
  makeDraggable(panel, header);

  const body = document.createElement("div");
  body.className = "appset-body";
  panel.appendChild(body);

  const sub = (text: string) => {
    const el = document.createElement("div");
    el.className = "appset-sub";
    el.textContent = text;
    return el;
  };
  const row = (labelText: string, control: HTMLElement, help?: string) => {
    const r = document.createElement("div");
    r.className = "appset-row";
    const l = document.createElement("span");
    l.className = "appset-label";
    l.textContent = labelText;
    r.append(l, control);
    if (help) attachHelp(l, help);
    return r;
  };

  // Appearance: a small segmented Auto / Light / Dark picker.
  let activeTheme = opts.theme.initial;
  const seg = document.createElement("div");
  seg.className = "appset-seg";
  const segBtns = new Map<Theme, HTMLButtonElement>();
  const syncTheme = () => {
    for (const [t, b] of segBtns) b.classList.toggle("active", t === activeTheme);
  };
  for (const t of THEMES) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "appset-seg-btn";
    b.innerHTML = `<span class="appset-seg-ic">${THEME_GLYPH[t]}</span>${cap(t)}`;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      activeTheme = t;
      syncTheme();
      opts.theme.onChange(t);
    });
    segBtns.set(t, b);
    seg.appendChild(b);
  }
  syncTheme();

  const pen = makeToggle(opts.penEnabled, opts.onTogglePen);
  const pixelLog = makeToggle(opts.pixelLog, opts.onTogglePixelLog);

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "appset-reset-btn";
  resetBtn.textContent = "Reset to default";
  resetBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    opts.onResetToDefault();
  });

  // App version (compiled in from package.json via Vite — see vite.config.ts).
  const version = document.createElement("span");
  version.className = "appset-value";
  version.textContent = `v${__APP_VERSION__}`;

  body.append(
    sub("Appearance"),
    row("Theme", seg),
    sub("Input"),
    row(
      "Pen pressure",
      pen.el,
      "Use a stylus's pressure and tilt to shape the stroke. Off makes a pen draw like a mouse.",
    ),
    sub("Advanced"),
    row(
      "Pixel log",
      pixelLog.el,
      "Records every deposited point to an append-only log, intended for future features. Off by default - best left off for now; it only grows stored data and nothing uses it yet.",
    ),
    sub("Reset"),
    row(
      "Erase all data",
      resetBtn,
      "Permanently deletes every setting, layer and saved artwork on this device, then reloads the app fresh. You'll have to confirm by typing \"yes\".",
    ),
    sub("About"),
    row("Version", version),
  );

  const toggle = () => {
    panel.style.display = panel.style.display === "none" ? "" : "none";
  };
  return { el: panel, toggle };
}

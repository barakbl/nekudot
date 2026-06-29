import { createPanel } from "../ui/panel";
import { makeToggle } from "../ui/toggle";
import { attachHelp } from "../help";
import { diagnosticsText, diagnosticOverride, setDiagnosticOverride } from "../diagnostics";
import { triggerDownload } from "../export";
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
  smoothGradients: boolean;
  onToggleSmoothGradients: (on: boolean) => void;
  penEnabled: boolean;
  onTogglePen: (on: boolean) => void;
  singleKeyShortcuts: boolean;
  onToggleSingleKeyShortcuts: (on: boolean) => void;
  pixelLog: boolean;
  onTogglePixelLog: (on: boolean) => void;
  diagnostics: boolean;
  onToggleDiagnostics: (on: boolean) => void;
  // Wipe all local data and reload to a fresh app (opens its own confirm modal).
  onResetToDefault: () => void;
  // Download the whole local config (app settings + presets + palettes) as a file.
  onExportSettings: () => void;
  // Pick a settings file and import it (replaces config, then reloads).
  onImportSettings: () => void;
}): AppSettingsBox {
  const { panel } = createPanel({
    className: "layers-box app-settings-box",
    title: "Application settings",
  });

  const body = document.createElement("div");
  body.className = "appset-body";
  panel.appendChild(body);

  const sub = (text: string) => {
    const el = document.createElement("div");
    el.className = "appset-sub";
    el.textContent = text;
    return el;
  };
  // A small always-visible blurb under a section heading (for sections whose
  // purpose isn't obvious from a one-word row label alone).
  const desc = (text: string) => {
    const el = document.createElement("div");
    el.className = "appset-desc";
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

  const smoothGrad = makeToggle(opts.smoothGradients, opts.onToggleSmoothGradients);
  const pen = makeToggle(opts.penEnabled, opts.onTogglePen);
  const singleKey = makeToggle(
    opts.singleKeyShortcuts,
    opts.onToggleSingleKeyShortcuts,
  );
  const pixelLog = makeToggle(opts.pixelLog, opts.onTogglePixelLog);
  const diagnostics = makeToggle(opts.diagnostics, opts.onToggleDiagnostics);

  // Copy / download the captured diagnostics so they can be shared.
  const flash = (btn: HTMLButtonElement, msg: string) => {
    const orig = btn.textContent;
    btn.textContent = msg;
    window.setTimeout(() => (btn.textContent = orig), 1500);
  };
  const downloadLogs = () =>
    triggerDownload(
      new Blob([diagnosticsText()], { type: "text/plain" }),
      "nekudot-diagnostics.txt",
    );
  const diagActions = document.createElement("div");
  diagActions.className = "appset-diag-actions";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "appset-diag-btn";
  copyBtn.textContent = "Copy logs";
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const write = navigator.clipboard?.writeText(diagnosticsText());
    if (write) write.then(() => flash(copyBtn, "Copied!"), () => downloadLogs());
    else downloadLogs(); // no clipboard API (e.g. insecure context) -> file
  });
  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className = "appset-diag-btn";
  downloadBtn.textContent = "Download";
  downloadBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    downloadLogs();
  });
  diagActions.append(copyBtn, downloadBtn);

  // "Try a fix" toggle: bypass the live wet-stroke overlay canvas.
  const bypassWet = makeToggle(diagnosticOverride("disableWetOverlay"), (on) =>
    setDiagnosticOverride("disableWetOverlay", on),
  );

  // Backup: export / import the whole local config as one portable file.
  const ioActions = document.createElement("div");
  ioActions.className = "appset-io-actions";
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.className = "appset-io-btn";
  exportBtn.textContent = "Export";
  exportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    opts.onExportSettings();
  });
  const importBtn = document.createElement("button");
  importBtn.type = "button";
  importBtn.className = "appset-io-btn";
  importBtn.textContent = "Import";
  importBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    opts.onImportSettings();
  });
  ioActions.append(exportBtn, importBtn);

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "appset-reset-btn";
  resetBtn.textContent = "Reset to default";
  resetBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    opts.onResetToDefault();
  });

  // App version (compiled in from package.json via Vite — see vite.config.ts).
  // `typeof` guard so a dev server started before the Vite `define` existed
  // (config isn't hot-reloaded) degrades to "vdev" instead of throwing a
  // ReferenceError that would abort init and leave the app with no toolbar.
  const version = document.createElement("span");
  version.className = "appset-value";
  version.textContent =
    "v" + (typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev");

  // "What's new" - the artist-facing Updates page on the site (new tab).
  const whatsNew = document.createElement("a");
  whatsNew.className = "appset-link";
  whatsNew.href = "/updates.html";
  whatsNew.target = "_blank";
  whatsNew.rel = "noopener";
  whatsNew.textContent = "What's new →";

  body.append(
    sub("Appearance"),
    row("Theme", seg),
    row(
      "Smooth gradients",
      smoothGrad.el,
      "Blend gradients in OKLCH for perceptually even, vivid transitions (no muddy or grey midpoints). Off uses the classic sRGB blend.",
    ),
    sub("Input"),
    row(
      "Pen pressure",
      pen.el,
      "Use a stylus's pressure and tilt to shape the stroke. Off makes a pen draw like a mouse.",
    ),
    row(
      "Single-key shortcuts",
      singleKey.el,
      "Let single keys (b, c, y, 1-9 …) trigger tools and toggles. Turn off if you use voice control or hit them by accident - Cmd/Ctrl shortcuts keep working either way.",
    ),
    sub("Advanced"),
    row(
      "Pixel log",
      pixelLog.el,
      "Records every deposited point to an append-only log, intended for future features. Off by default - best left off for now; it only grows stored data and nothing uses it yet.",
    ),
    sub("Diagnostics"),
    row(
      "Diagnostic logging",
      diagnostics.el,
      "Captures brush, stroke, render and error events into a log you can copy or download to share for troubleshooting. Off by default; nothing is sent anywhere automatically.",
    ),
    diagActions,
    row(
      "Bypass wet layer",
      bypassWet.el,
      "For testing on an old machine where painting doesn't show up: draws faint strokes straight onto the layer instead of the live overlay canvas. If strokes become visible with this on, the overlay's compositing was the problem.",
    ),
    sub("Your settings"),
    desc("Backup your app settings, custom presets and saved palettes as one file"),
    row(
      "Settings file",
      ioActions,
      "Export downloads a .nekudotapp file with your app settings, custom connection presets and saved colour palettes. Import loads one back, replacing your current settings, presets and palettes (your artwork is not affected), then reloads.",
    ),
    sub("Reset"),
    row(
      "Erase all data",
      resetBtn,
      "Permanently deletes every setting, layer and saved artwork on this device, then reloads the app fresh. You'll have to confirm by typing \"yes\".",
    ),
    sub("About"),
    row("Version", version),
    row("What's new", whatsNew, "See the latest updates, told for artists - opens the website."),
  );

  const toggle = () => {
    panel.style.display = panel.style.display === "none" ? "" : "none";
  };
  return { el: panel, toggle };
}

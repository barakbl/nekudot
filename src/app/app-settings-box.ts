import { createPanel } from "../ui/panel";
import { makeToggle } from "../ui/toggle";
import { attachHelp } from "../help";
import { diagnosticsText, diagnosticOverride, setDiagnosticOverride } from "../diagnostics";
import { triggerDownload } from "../export";
import type { Theme } from "../menu";

export type AppSettingsBox = {
  el: HTMLElement;
  toggle: () => void;
  // Re-render the Local folder section after its connection state changes.
  refreshFolder: () => void;
};

// Chrome folder-sync controls, wired by the app. Omitted when unsupported, so the
// whole Local folder section is then hidden.
export type FolderControls = {
  isConnected: () => boolean;
  folderName: () => string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  onSaveSettings: () => void;
  onLoadSettings: () => void;
};

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
  // Chrome folder sync. Omitted on unsupported browsers -> section hidden.
  folder?: FolderControls;
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
  // A small pill button + a row of them (the neutral Backup / folder controls).
  const ioBtn = (label: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "appset-io-btn";
    b.textContent = label;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  };
  const ioActionsRow = (buttons: HTMLButtonElement[]) => {
    const wrap = document.createElement("div");
    wrap.className = "appset-io-actions";
    wrap.append(...buttons);
    return wrap;
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

  // Local folder (Chrome folder sync). A dynamic block - [Connect folder] when
  // idle, the folder name + Disconnect + Save/Load settings once connected -
  // re-rendered via refreshFolder when the connection state changes. Hidden
  // entirely when unsupported (opts.folder omitted).
  const folderBox = document.createElement("div");
  const renderFolder = () => {
    const f = opts.folder;
    if (!f) return;
    folderBox.replaceChildren();
    if (f.isConnected()) {
      const head = document.createElement("div");
      head.className = "appset-io-actions";
      const name = document.createElement("span");
      name.className = "appset-folder-name";
      name.textContent = f.folderName() ?? "Connected";
      head.append(name, ioBtn("Disconnect", f.onDisconnect));
      folderBox.append(
        row("Folder", head),
        row(
          "Settings",
          ioActionsRow([
            ioBtn("Save", f.onSaveSettings),
            ioBtn("Load", f.onLoadSettings),
          ]),
        ),
      );
    } else {
      folderBox.append(
        row("Local folder", ioActionsRow([ioBtn("Connect folder", f.onConnect)])),
      );
    }
  };
  renderFolder();
  const folderNodes = opts.folder
    ? [
        sub("Local folder"),
        desc(
          'Sync your settings and artwork to a folder on this computer - no download each time. Sync artwork from the "..." menu.',
        ),
        folderBox,
      ]
    : [];

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
    sub("Backup"),
    desc("Backup your app settings, custom presets and saved palettes as one file"),
    row(
      "Settings file",
      ioActions,
      "Export downloads a .nekudotapp file with your app settings, custom connection presets and saved colour palettes. Import loads one back, replacing your current settings, presets and palettes (your artwork is not affected), then reloads.",
    ),
    ...folderNodes,
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
  return { el: panel, toggle, refreshFolder: renderFolder };
}

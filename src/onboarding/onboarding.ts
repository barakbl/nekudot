import settings from "./settings.json";
import { makeToggle } from "../ui/toggle";
import { trapFocus, type FocusTrap } from "../ui/focus-trap";
import type { Theme } from "../menu";

// The Start page (a.k.a. onboarding): a full-screen takeover shown on first run
// and after a data reset, offering ways to begin. Reopenable any time from the
// Shortcuts panel. The option grid + tips come from ./settings.json; saved
// .nekudot files dropped in ./assets are auto-listed as "open" cards.

export type BlankVariant = "full" | "square";

// What the page can trigger; the app wires these (so this module stays free of
// the canvas/layer machinery and is easy to test).
export type OnboardingActions = {
  // color: the connecting web's colour source (e.g. "rainbow"), from JSON.
  startMandala: (color?: string) => void;
  startBlank: (variant: BlankVariant) => void;
  loadArtworkFile: (file: File) => Promise<void> | void;
};

type ActionSpec = { type: "mandala"; color?: string } | { type: "blank" };
type OptionSpec = {
  id: string;
  title: string;
  description: string;
  // An optional emphasised (bold) line shown under the description.
  note?: string;
  icon?: string;
  // Preview image (a file in ./assets, by name). Shown in the tile's thumbnail
  // area; when absent the icon is used as a placeholder.
  image?: string;
  badge?: string;
  action: ActionSpec;
};
type TipSpec = { title: string; text: string };
type SettingsSpec = {
  title: string;
  subtitle?: string;
  options: OptionSpec[];
  tips?: TipSpec[];
};

const SETTINGS = settings as SettingsSpec;

// Sample artworks bundled from ./assets, resolved to URLs at build time so a
// card can fetch one on click. Auto-discovered: drop a .nekudot in and it shows.
const ASSET_URLS = import.meta.glob("./assets/*.nekudot", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function discoveredAssets(): { name: string; url: string }[] {
  return Object.entries(ASSET_URLS)
    .map(([path, url]) => ({ name: path.split("/").pop() ?? path, url }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Preview images bundled from ./assets, resolved to URLs so an option tile can
// show one. Optional - tiles fall back to their icon when no image is set.
const IMAGE_URLS = import.meta.glob("./assets/*.{png,jpg,jpeg,webp,svg,avif}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function imageUrl(name: string): string | undefined {
  const hit = Object.entries(IMAGE_URLS).find(([path]) => path.endsWith("/" + name));
  return hit?.[1];
}

// Decide whether to show the Start page automatically. First run (nothing
// stored) or right after a reset (which wipes storage) -> show. An existing user
// with prior data is treated as already onboarded so their canvas isn't hidden.
export function shouldShowOnboarding(opts: {
  onboarded: boolean;
  hasPriorUse: boolean;
}): boolean {
  return !opts.onboarded && !opts.hasPriorUse;
}

export type Onboarding = {
  el: HTMLElement;
  show: () => void;
  hide: () => void;
  isOpen: () => boolean;
};

export function createOnboarding(opts: {
  actions: OnboardingActions;
  // Quick preferences mirrored from App settings, so the first canvas already
  // matches the user's setup. Wired by the app to the same handlers.
  prefs: {
    theme: { initial: Theme; onChange: (t: Theme) => void };
    pen: { initial: boolean; onChange: (on: boolean) => void };
  };
  // Mark the app as onboarded so it won't auto-show again (until a reset).
  onDismiss: () => void;
  // Optional: seed this device from a previously exported settings file before
  // choosing a canvas. Opens a file picker; a successful import reloads the app.
  // Omitted -> the affordance isn't shown.
  onImportSettings?: () => void;
}): Onboarding {
  const el = document.createElement("div");
  el.className = "onboarding";
  el.style.display = "none";

  // Polite live region, kept in the body (outside the hidden takeover) so a
  // screen reader announces the handoff to the canvas when the page is dismissed.
  const liveRegion = document.createElement("div");
  liveRegion.className = "sr-only";
  liveRegion.setAttribute("aria-live", "polite");
  document.body.appendChild(liveRegion);

  const card = document.createElement("div");
  card.className = "onboarding-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.tabIndex = -1;
  el.appendChild(card);

  // APG modal: inert everything outside the dialog while it's open, so AT and the
  // keyboard can't reach the canvas/chrome behind it.
  let inerted: HTMLElement[] = [];
  const setBackgroundInert = (on: boolean) => {
    if (!on) {
      for (const s of inerted) {
        s.inert = false;
        s.removeAttribute("aria-hidden");
      }
      inerted = [];
      return;
    }
    let node: HTMLElement | null = el;
    while (node && node !== document.body) {
      const up: HTMLElement | null = node.parentElement;
      if (!up) break;
      for (const sib of Array.from(up.children)) {
        if (sib === node || sib === liveRegion || !(sib instanceof HTMLElement) || sib.inert)
          continue;
        sib.inert = true;
        sib.setAttribute("aria-hidden", "true");
        inerted.push(sib);
      }
      node = up;
    }
  };

  const finish = () => {
    opts.onDismiss();
    liveRegion.textContent = "Canvas ready"; // announce the handoff once
    hide();
  };

  let trap: FocusTrap | null = null;
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      finish();
    }
  };

  // Close (dismiss without choosing -> reveals the underlying canvas).
  const close = document.createElement("button");
  close.className = "onboarding-close";
  close.setAttribute("aria-label", "Close");
  close.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg>';
  close.addEventListener("click", finish);
  card.appendChild(close);

  // Header.
  const header = document.createElement("div");
  header.className = "onboarding-header";
  const h1 = document.createElement("h1");
  h1.className = "onboarding-title";
  h1.id = "onboarding-title";
  h1.textContent = SETTINGS.title;
  card.setAttribute("aria-labelledby", h1.id);
  header.appendChild(h1);
  if (SETTINGS.subtitle) {
    const sub = document.createElement("p");
    sub.className = "onboarding-subtitle";
    sub.textContent = SETTINGS.subtitle;
    header.appendChild(sub);
  }
  card.appendChild(header);

  // Quick preferences (theme + pen pressure), mirrored from App settings.
  const prefs = document.createElement("div");
  prefs.className = "onboarding-prefs";

  const themeWrap = document.createElement("div");
  themeWrap.className = "onboarding-pref";
  const themeLabel = document.createElement("span");
  themeLabel.className = "onboarding-pref-label";
  themeLabel.id = "onboarding-theme-label";
  themeLabel.textContent = "Theme";
  const seg = document.createElement("div");
  seg.className = "onboarding-seg";
  seg.setAttribute("role", "radiogroup");
  seg.setAttribute("aria-labelledby", themeLabel.id);
  const THEMES: Theme[] = ["auto", "light", "dark"];
  let activeTheme = opts.prefs.theme.initial;
  const segBtns = new Map<Theme, HTMLButtonElement>();
  const syncTheme = () => {
    for (const [t, b] of segBtns) {
      const on = t === activeTheme;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1; // roving tabindex: the group is one tab stop
    }
  };
  const pickTheme = (t: Theme, focus: boolean) => {
    activeTheme = t;
    syncTheme();
    if (focus) segBtns.get(t)?.focus();
    opts.prefs.theme.onChange(t);
  };
  for (const t of THEMES) {
    const b = document.createElement("button");
    b.className = "onboarding-seg-btn";
    b.type = "button";
    b.setAttribute("role", "radio");
    b.textContent = t[0].toUpperCase() + t.slice(1);
    b.addEventListener("click", () => pickTheme(t, false));
    b.addEventListener("keydown", (e) => {
      // Arrow keys move selection (and focus) within the radiogroup.
      const i = THEMES.indexOf(activeTheme);
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        pickTheme(THEMES[(i + 1) % THEMES.length], true);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        pickTheme(THEMES[(i - 1 + THEMES.length) % THEMES.length], true);
      }
    });
    segBtns.set(t, b);
    seg.appendChild(b);
  }
  syncTheme();
  themeWrap.append(themeLabel, seg);

  const penWrap = document.createElement("div");
  penWrap.className = "onboarding-pref";
  const penLabel = document.createElement("span");
  penLabel.className = "onboarding-pref-label";
  penLabel.textContent = "Pen pressure";
  const penToggle = makeToggle(opts.prefs.pen.initial, opts.prefs.pen.onChange);
  penWrap.append(penLabel, penToggle.el);

  prefs.append(themeWrap, penWrap);
  card.appendChild(prefs);

  // Optional: import a settings file (app settings + presets + palettes) to set
  // this device up like another. A subtle link - most first-runs start fresh.
  if (opts.onImportSettings) {
    const importRow = document.createElement("div");
    importRow.className = "onboarding-import";
    const importBtn = document.createElement("button");
    importBtn.type = "button";
    importBtn.className = "onboarding-import-btn";
    importBtn.textContent = "Import a settings file";
    importBtn.addEventListener("click", () => opts.onImportSettings?.());
    importRow.appendChild(importBtn);
    card.appendChild(importRow);
  }

  // Option grid.
  const grid = document.createElement("div");
  grid.className = "onboarding-grid";
  for (const opt of SETTINGS.options) grid.appendChild(buildOptionCard(opt));
  card.appendChild(grid);

  // Auto-discovered saved pieces.
  const assets = discoveredAssets();
  if (assets.length) {
    const label = document.createElement("div");
    label.className = "onboarding-section-label";
    label.textContent = "Open a saved piece";
    card.appendChild(label);
    const row = document.createElement("div");
    row.className = "onboarding-assets";
    for (const a of assets) row.appendChild(buildAssetCard(a.name, a.url));
    card.appendChild(row);
  }

  // Tips.
  if (SETTINGS.tips?.length) {
    const tips = document.createElement("div");
    tips.className = "onboarding-tips";
    for (const t of SETTINGS.tips) {
      const tip = document.createElement("div");
      tip.className = "onboarding-tip";
      const tt = document.createElement("div");
      tt.className = "onboarding-tip-title";
      tt.textContent = t.title;
      const tx = document.createElement("div");
      tx.className = "onboarding-tip-text";
      tx.textContent = t.text;
      tip.append(tt, tx);
      tips.appendChild(tip);
    }
    card.appendChild(tips);
  }

  function buildOptionCard(opt: OptionSpec): HTMLElement {
    const cardEl = document.createElement("div");
    cardEl.className = "onboarding-option";

    // Thumbnail area: a preview image when set, otherwise the icon as a
    // placeholder. Reserved space either way so every tile reads alike.
    const thumb = document.createElement("div");
    thumb.className = "onboarding-thumb";
    const src = opt.image ? imageUrl(opt.image) : undefined;
    if (src) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      img.className = "onboarding-thumb-img";
      thumb.appendChild(img);
    } else if (opt.icon) {
      const ic = document.createElement("div");
      ic.className = "onboarding-thumb-icon";
      ic.innerHTML = opt.icon; // trusted: bundled settings.json
      thumb.appendChild(ic);
    }
    if (opt.badge) {
      const badge = document.createElement("span");
      badge.className = "onboarding-badge";
      badge.textContent = opt.badge;
      thumb.appendChild(badge);
    }
    cardEl.appendChild(thumb);

    const body = document.createElement("div");
    body.className = "onboarding-option-body";
    const title = document.createElement("h3");
    title.className = "onboarding-option-title";
    title.textContent = opt.title;
    const desc = document.createElement("p");
    desc.className = "onboarding-option-desc";
    desc.textContent = opt.description;
    body.append(title, desc);
    if (opt.note) {
      const note = document.createElement("p");
      note.className = "onboarding-option-note";
      note.textContent = opt.note;
      body.appendChild(note);
    }
    // Show the default web colours as a swatch rather than describing them.
    if (opt.action.type === "mandala" && opt.action.color === "rainbow") {
      const swatch = document.createElement("span");
      swatch.className = "onboarding-swatch onboarding-swatch-rainbow";
      swatch.setAttribute("role", "img");
      swatch.setAttribute("aria-label", "Default colours: rainbow gradient");
      body.appendChild(swatch);
    }
    cardEl.appendChild(body);

    if (opt.action.type === "blank") {
      // Blank offers a size choice, so it has its own buttons rather than being
      // one big click target.
      const actions = document.createElement("div");
      actions.className = "onboarding-option-actions";
      const full = document.createElement("button");
      full.className = "onboarding-btn";
      full.textContent = "Full screen";
      full.addEventListener("click", () => {
        opts.actions.startBlank("full");
        finish();
      });
      const square = document.createElement("button");
      square.className = "onboarding-btn";
      square.textContent = "Square 1:1";
      square.addEventListener("click", () => {
        opts.actions.startBlank("square");
        finish();
      });
      actions.append(full, square);
      body.appendChild(actions);
    } else {
      cardEl.classList.add("onboarding-option-clickable");
      cardEl.setAttribute("role", "button");
      cardEl.tabIndex = 0;
      const color = opt.action.type === "mandala" ? opt.action.color : undefined;
      const go = () => {
        opts.actions.startMandala(color);
        finish();
      };
      cardEl.addEventListener("click", go);
      cardEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      });
    }
    return cardEl;
  }

  function buildAssetCard(name: string, url: string): HTMLElement {
    const cardEl = document.createElement("button");
    cardEl.className = "onboarding-asset";
    cardEl.innerHTML =
      '<span class="onboarding-asset-icon"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7 a2 2 0 0 1 2-2 h4 l2 2 h8 a2 2 0 0 1 2 2 v8 a2 2 0 0 1 -2 2 H5 a2 2 0 0 1 -2 -2 Z"/></svg></span>';
    const label = document.createElement("span");
    label.className = "onboarding-asset-name";
    label.textContent = name.replace(/\.nekudot$/i, "");
    cardEl.appendChild(label);
    cardEl.addEventListener("click", async () => {
      cardEl.disabled = true;
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        await opts.actions.loadArtworkFile(
          new File([blob], name, { type: "application/zip" }),
        );
        finish();
      } catch {
        cardEl.disabled = false;
      }
    });
    return cardEl;
  }

  function show(): void {
    liveRegion.textContent = ""; // reset so the next handoff re-announces
    el.style.display = "";
    setBackgroundInert(true);
    document.addEventListener("keydown", onKeyDown);
    trap = trapFocus(card);
  }
  function hide(): void {
    el.style.display = "none";
    setBackgroundInert(false);
    document.removeEventListener("keydown", onKeyDown);
    if (trap) {
      trap.release();
      trap = null;
    }
  }

  return { el, show, hide, isOpen: () => el.style.display !== "none" };
}

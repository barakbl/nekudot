// @vitest-environment happy-dom
//
// Behavioural smoke for the colour popover in a real DOM: seeding renders
// palettes, the Edit toggle gates the editing affordances, picking applies +
// closes, the Import modal lists only not-yet-added palettes (and a deleted one
// becomes available again), export produces a valid .gpl, and - security -
// palette names are rendered as text, never parsed as HTML.
import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createPalettePanel } from "../src/colors/panel";
import { parseGpl } from "../src/colors/gpl";
import {
  clearColorsStore,
  loadCustomPalettes,
  saveCustomPalettes,
} from "../src/colors/store";

const flush = () => new Promise((r) => setTimeout(r, 0));
async function waitFor(fn: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (fn()) return;
    await flush();
  }
  throw new Error("waitFor timed out");
}

type Panel = ReturnType<typeof createPalettePanel>;
let picked: string[] = [];

// Build a panel, mount it, open it for a dummy target, and wait for the seeded
// palettes to render.
async function openPanel(): Promise<{ panel: Panel; el: HTMLElement }> {
  picked = [];
  const panel = createPalettePanel();
  const el = panel.el as HTMLElement;
  document.body.appendChild(el);
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  panel.open({
    title: "Primary color",
    anchor,
    getColor: () => "#123456",
    onPick: (hex) => picked.push(hex),
  });
  await waitFor(() => el.querySelectorAll(".palette-section").length > 0);
  return { panel, el };
}

const sections = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>(".palette-section")];
const sectionName = (s: HTMLElement) =>
  s.querySelector(".palette-section-label")?.textContent ?? "";
const clickEditToggle = (el: HTMLElement) =>
  el.querySelector<HTMLElement>(".palette-edit-toggle")!.click();
const clickImport = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLElement>(".palette-footer .palette-action-btn")]
    .find((b) => b.textContent?.trim() === "Import")!
    .click();

beforeEach(async () => {
  await clearColorsStore();
  document.body.innerHTML = "";
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("colour popover smoke (real DOM)", () => {
  it("seeds + renders the default palettes, and picking applies then closes", async () => {
    const { panel, el } = await openPanel();
    expect(sections(el).map(sectionName)).toContain("App Colors");

    const swatch = el.querySelector<HTMLElement>(".palette-list .swatch-chip");
    expect(swatch).toBeTruthy();
    swatch!.click();
    expect(picked).toHaveLength(1);
    expect(picked[0]).toMatch(/^#[0-9a-f]{6}$/);
    expect((panel.el as HTMLElement).style.display).toBe("none"); // auto-closed
  });

  it("Edit toggle gates the editing affordances", async () => {
    const { el } = await openPanel();
    // Browse mode: no per-palette action icons, no gradient rows, footer hidden.
    expect(el.querySelectorAll(".palette-icon-btn")).toHaveLength(0);
    expect(el.querySelectorAll(".palette-grad-row")).toHaveLength(0);
    expect(el.querySelector<HTMLElement>(".palette-footer")!.style.display).toBe("none");

    clickEditToggle(el);
    expect(el.querySelectorAll(".palette-icon-btn").length).toBeGreaterThan(0);
    expect(el.querySelectorAll(".palette-grad-row").length).toBeGreaterThan(0);
    expect(el.querySelector<HTMLElement>(".palette-footer")!.style.display).not.toBe("none");
  });

  it("Import modal lists only not-yet-added palettes; deleting one re-offers it", async () => {
    const { el } = await openPanel();
    clickEditToggle(el);
    clickImport(el);
    await waitFor(
      () => el.querySelector<HTMLElement>(".palette-import-overlay")!.style.display !== "none",
    );
    const importNames = () =>
      [...el.querySelectorAll(".palette-import-name")].map((n) => n.textContent);
    // App Colors is seeded => must NOT be offered; the list is non-empty (copic, etc.).
    expect(importNames()).not.toContain("App Colors");
    expect(importNames().length).toBeGreaterThan(0);

    // Close the modal, delete "App Colors", reopen Import -> now it's available.
    el.querySelector<HTMLElement>(".palette-import-overlay")!.click(); // backdrop closes
    const appSection = sections(el).find((s) => sectionName(s) === "App Colors")!;
    appSection.querySelector<HTMLElement>('.palette-icon-btn[title="Delete palette"]')!.click();
    await waitFor(() => !sections(el).some((s) => sectionName(s) === "App Colors"));

    clickImport(el);
    await waitFor(() => importNames().includes("App Colors"));
    expect(importNames()).toContain("App Colors");
  });

  it("exports a palette as a valid .gpl that round-trips through parseGpl", async () => {
    const { el } = await openPanel();
    clickEditToggle(el);
    // Capture the Blob handed to the download.
    let captured: Blob | null = null;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = vi.fn((b: Blob) => {
      captured = b;
      return "blob:mock";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    try {
      el.querySelector<HTMLElement>('.palette-icon-btn[title="Export as .gpl"]')!.click();
      await waitFor(() => captured !== null);
      const text = await captured!.text();
      expect(text.startsWith("GIMP Palette")).toBe(true);
      const back = parseGpl(text);
      expect(back?.colors.length).toBeGreaterThan(0);
    } finally {
      URL.createObjectURL = origCreate;
    }
  });

  it("renders a palette name as text, never as parsed HTML (XSS)", async () => {
    const evil = '<img src=x onerror="globalThis.__xss=1">';
    (globalThis as Record<string, unknown>).__xss = undefined;
    // Persist a hostile-named palette, then load it fresh into a panel.
    await saveCustomPalettes([{ id: "evil", name: evil, colors: ["#ffffff"] }]);
    const loaded = await loadCustomPalettes();
    expect(loaded.find((p) => p.id === "evil")?.name).toBe(evil); // stored verbatim

    const { el } = await openPanel();
    await waitFor(() => sections(el).some((s) => sectionName(s) === evil));
    // The name is the literal string, and no <img> element was created from it.
    expect(el.querySelector("img")).toBeNull();
    expect((globalThis as Record<string, unknown>).__xss).toBeUndefined();
  });
});

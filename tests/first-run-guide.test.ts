// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createFirstRunGuide } from "../src/onboarding/first-run-guide";
import settings from "../src/onboarding/settings.json";

// The first-run guide: a pointer-transparent "draw anywhere" cue on the empty
// canvas, and a tips strip that surfaces AFTER the first stroke (never before, so
// it can't compete with the bloom) and retires itself. These lock the lifecycle
// and the de-keyed copy (no unpressable-key instructions reach a touch user).

const tips = (settings as { tips: { title: string; text: string }[] }).tips;
const KEY_INSTRUCTION = /press [a-z/]|number keys/i; // the old key-first phrasing

// A stage-like child of the mount; pointerdown on it bubbles through the mount
// where the cue's capture listener lives (mirrors the real stage/viewport).
function harness() {
  const mount = document.createElement("div");
  const stage = document.createElement("div");
  mount.appendChild(stage);
  document.body.appendChild(mount);
  return { mount, stage };
}
const down = (stage: HTMLElement) =>
  stage.dispatchEvent(new Event("pointerdown", { bubbles: true }));

describe("first-run guide", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
  });
  afterEach(() => vi.useRealTimers());

  it("shows a 'drag to draw' cue on start()", () => {
    const { mount } = harness();
    createFirstRunGuide({ mount }).start();
    const cue = mount.querySelector(".frg-cue");
    expect(cue).toBeTruthy();
    expect(cue?.textContent).toContain("Drag to draw");
    expect(cue?.textContent).toContain("anywhere on the canvas");
    expect(cue?.querySelector("svg.frg-cue-glyph")).toBeTruthy(); // the web-preview glyph
  });

  it("dismisses the cue on the first pointerdown (and does not intercept it)", () => {
    const { mount, stage } = harness();
    createFirstRunGuide({ mount }).start();
    down(stage);
    expect(mount.querySelector(".frg-cue")?.classList.contains("is-dismissing")).toBe(true);
    vi.advanceTimersByTime(400);
    expect(mount.querySelector(".frg-cue")).toBeNull();
  });

  it("surfaces the tips strip only AFTER the first stroke, ~700ms later", () => {
    const { mount } = harness();
    const g = createFirstRunGuide({ mount });
    g.start();
    expect(mount.querySelector(".frg-tips")).toBeNull(); // nothing before a stroke
    g.notifyStrokeEnd();
    expect(mount.querySelector(".frg-tips")).toBeNull(); // not immediately
    vi.advanceTimersByTime(700);
    const strip = mount.querySelector(".frg-tips");
    expect(strip).toBeTruthy();
    expect(strip?.querySelectorAll(".frg-tip").length).toBe(3); // first 3 tips
  });

  it("the strip's tips are de-keyed and name the visible pills", () => {
    const { mount } = harness();
    const g = createFirstRunGuide({ mount });
    g.start();
    g.notifyStrokeEnd();
    vi.advanceTimersByTime(700);
    const txt = mount.querySelector(".frg-tips")?.textContent ?? "";
    expect(txt).not.toMatch(KEY_INSTRUCTION);
    expect(txt).toMatch(/web/i);
    expect(txt).toMatch(/symmetry/i);
  });

  it("retires the strip after a few more strokes", () => {
    const { mount } = harness();
    const g = createFirstRunGuide({ mount });
    g.start();
    g.notifyStrokeEnd(); // stroke 1 -> schedules the strip
    vi.advanceTimersByTime(700);
    expect(mount.querySelector(".frg-tips")).toBeTruthy();
    g.notifyStrokeEnd(); // 2
    g.notifyStrokeEnd(); // 3
    g.notifyStrokeEnd(); // 4 -> 3 strokes past show -> retire
    expect(mount.querySelector(".frg-tips.is-out")).toBeTruthy();
    vi.advanceTimersByTime(320);
    expect(mount.querySelector(".frg-tips")).toBeNull();
  });

  it("retires the strip on the 'Got it' button", () => {
    const { mount } = harness();
    const g = createFirstRunGuide({ mount });
    g.start();
    g.notifyStrokeEnd();
    vi.advanceTimersByTime(700);
    mount.querySelector<HTMLButtonElement>(".frg-tips-got")?.click();
    vi.advanceTimersByTime(320);
    expect(mount.querySelector(".frg-tips")).toBeNull();
  });

  it("retires the strip after the idle timeout", () => {
    const { mount } = harness();
    const g = createFirstRunGuide({ mount });
    g.start();
    g.notifyStrokeEnd();
    vi.advanceTimersByTime(700);
    expect(mount.querySelector(".frg-tips")).toBeTruthy();
    vi.advanceTimersByTime(20000);
    vi.advanceTimersByTime(320);
    expect(mount.querySelector(".frg-tips")).toBeNull();
  });

  it("is show-once: start() is idempotent and strokes before start() do nothing", () => {
    const { mount } = harness();
    const g = createFirstRunGuide({ mount });
    g.notifyStrokeEnd(); // before start -> ignored
    vi.advanceTimersByTime(1000);
    expect(mount.querySelector(".frg-tips")).toBeNull();
    g.start();
    g.start(); // no second cue
    expect(mount.querySelectorAll(".frg-cue").length).toBe(1);
  });

  it("every settings.json tip is de-keyed (gesture-first, touch-usable)", () => {
    expect(tips.length).toBeGreaterThanOrEqual(3);
    for (const t of tips) expect(t.text).not.toMatch(KEY_INSTRUCTION);
  });
});

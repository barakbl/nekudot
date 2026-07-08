import type { IRenderer } from "../renderer";
import type { CanvasSize } from "../canvas-size";
import { type Transform, IDENTITY } from "./transforms";
import type { SymmetryTool, GuideStyle, SymSetting, ToolContext } from "./tool";
import { SYMMETRY_TOOL_DEFS, type SymmetryToolDef } from "./registry";

// "none" plus any registered tool name (radial / mirror / …). A plain string -
// the valid set is the registry + "none", resolved at runtime.
export type SymmetryMode = string;
export type { GuideStyle } from "./tool";

// Minimal store shape (the app's persistent key/value store).
type Store = {
  get<T>(key: string): T | undefined;
  set(key: string, value: unknown): void;
};

const K = {
  mode: "app.symmetry.mode",
  centerX: "app.symmetry.center.x",
  centerY: "app.symmetry.center.y",
  guideColor: "app.symmetry.guide.color",
  guideWidth: "app.symmetry.guide.width",
  guideAlpha: "app.symmetry.guide.alpha",
};
// A tool's settings persist under app.symmetry.<tool>.<key>.
const toolKey = (tool: string, key: string) => `app.symmetry.${tool}.${key}`;

const GUIDE_DEFAULT: GuideStyle = { color: "#888888", width: 1, alpha: 0.35 };

// Owns the active mode + the shared centre + guide style, and delegates the
// per-mode work (transforms, panel controls, guide geometry) to the selected
// plugin tool. Tools are instantiated once and kept, so their params survive
// mode switches; each tool's params persist under its own key namespace.
export class SymmetryController {
  mode: SymmetryMode;
  // Centre for centred tools (usesCentre), as fractions of the canvas (0..1).
  centerX: number;
  centerY: number;
  guide: GuideStyle;

  private tools = new Map<string, SymmetryTool>();
  private current: readonly Transform[] = [IDENTITY];
  private listeners = new Set<() => void>();

  constructor(private store: Store) {
    // Instantiate every registered tool and restore its persisted settings.
    for (const def of SYMMETRY_TOOL_DEFS) {
      const tool = def.create();
      this.restoreTool(def.name, tool);
      this.tools.set(def.name, tool);
    }
    this.mode = store.get<SymmetryMode>(K.mode) ?? "none";
    this.centerX = store.get<number>(K.centerX) ?? 0.5;
    this.centerY = store.get<number>(K.centerY) ?? 0.5;
    this.guide = {
      color: store.get<string>(K.guideColor) ?? GUIDE_DEFAULT.color,
      width: store.get<number>(K.guideWidth) ?? GUIDE_DEFAULT.width,
      alpha: store.get<number>(K.guideAlpha) ?? GUIDE_DEFAULT.alpha,
    };
  }

  // ---- mode + active tool ----------------------------------------------------

  toolDefs(): SymmetryToolDef[] {
    return SYMMETRY_TOOL_DEFS;
  }
  get activeTool(): SymmetryTool | undefined {
    return this.mode === "none" ? undefined : this.tools.get(this.mode);
  }
  active(): boolean {
    return !!this.activeTool;
  }
  usesCentre(): boolean {
    return this.activeTool?.usesCentre ?? false;
  }
  activeSettings(): SymSetting[] {
    return this.activeTool?.settings() ?? [];
  }
  mirrorsPoints(): boolean {
    return this.activeTool?.mirrorsPoints() ?? true;
  }

  // ---- subscriptions ---------------------------------------------------------

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  // ---- mutators --------------------------------------------------------------

  setMode(m: SymmetryMode): void {
    this.mode = m;
    this.store.set(K.mode, m);
    this.notify();
  }
  setCenter(patch: { x?: number; y?: number }): void {
    if (patch.x !== undefined) this.centerX = patch.x;
    if (patch.y !== undefined) this.centerY = patch.y;
    this.store.set(K.centerX, this.centerX);
    this.store.set(K.centerY, this.centerY);
    this.notify();
  }
  setGuide(patch: Partial<GuideStyle>): void {
    this.guide = { ...this.guide, ...patch };
    this.store.set(K.guideColor, this.guide.color);
    this.store.set(K.guideWidth, this.guide.width);
    this.store.set(K.guideAlpha, this.guide.alpha);
    this.notify();
  }

  // Apply a panel control change, then re-persist the active tool's settings.
  setToolSetting(s: SymSetting, v: number | boolean | string): void {
    (s.onChange as (value: typeof v) => void)(v);
    this.persistActiveTool();
    this.notify();
  }
  // Convenience for tests / programmatic tweaks: set by key on the active tool.
  setActiveSetting(key: string, v: number | boolean | string): void {
    const s = this.activeSettings().find((x) => x.key === key);
    if (s) this.setToolSetting(s, v);
  }

  private persistActiveTool(): void {
    if (!this.activeTool) return;
    for (const s of this.activeTool.settings())
      if (s.persist !== false) this.store.set(toolKey(this.mode, s.key), s.value);
  }
  private restoreTool(name: string, tool: SymmetryTool): void {
    for (const s of tool.settings()) {
      if (s.persist === false) continue;
      const stored = this.store.get(toolKey(name, s.key));
      if (stored !== undefined) (s.onChange as (value: unknown) => void)(stored);
    }
  }

  // ---- per-stroke transforms -------------------------------------------------

  // Called on pointerdown: freeze the transform list for the whole stroke.
  beginStroke(x: number, y: number, size: CanvasSize): void {
    const tool = this.activeTool;
    this.current = tool ? tool.transforms(this.context(x, y, size)) : [IDENTITY];
  }

  // A serializable freeze of the symmetry inputs for the event log (vector-replay
  // P1.2): the active tool (null when off) + the centre, enough to reproduce the
  // transforms on replay.
  snapshot(): { tool: string | null; params: Record<string, number> } {
    return {
      tool: this.mode === "none" ? null : this.mode,
      params: { centerX: this.centerX, centerY: this.centerY },
    };
  }
  transforms(): readonly Transform[] {
    return this.current;
  }

  private context(startX: number, startY: number, size: CanvasSize): ToolContext {
    return {
      startX,
      startY,
      size,
      cx: size.width * this.centerX,
      cy: size.height * this.centerY,
      guide: this.guide,
    };
  }

  // ---- guides ----------------------------------------------------------------

  drawGuides(r: IRenderer, size: CanvasSize): void {
    r.clear();
    const tool = this.activeTool;
    if (!tool) return;
    const ctx = this.context(0, 0, size);
    tool.drawGuides(r, ctx);
    if (tool.usesCentre) this.drawCenterMark(r, ctx.cx, ctx.cy);
  }

  // A small crosshair marking the (movable) symmetry centre.
  private drawCenterMark(r: IRenderer, cx: number, cy: number): void {
    const s = 8;
    r.drawLine({ id: 0, x: cx - s, y: cy }, { id: 0, x: cx + s, y: cy }, this.guide);
    r.drawLine({ id: 0, x: cx, y: cy - s }, { id: 0, x: cx, y: cy + s }, this.guide);
  }
}

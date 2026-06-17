import type { IRenderer } from "../renderer";
import type { CanvasSize } from "../canvas-size";
import type { Transform } from "./transforms";

// On-canvas guide-line appearance, shared by every tool (the framework owns it).
export type GuideStyle = { color: string; width: number; alpha: number };

// Everything a tool needs per stroke, resolved by the framework: the stroke
// anchor (Tile pivots here), the canvas size, the centre in canvas px (for
// centred tools) and the current guide style (for drawGuides).
export type ToolContext = {
  startX: number;
  startY: number;
  size: CanvasSize;
  cx: number;
  cy: number;
  guide: GuideStyle;
};

// One declarative panel control. The framework renders the row and, on change,
// applies onChange then re-persists the tool's settings (skipping persist:false).
// `disabled` greys a control out (recomputed each render, e.g. Tile's Reach while
// Fill canvas is on).
export type SymSetting =
  | {
      kind: "slider";
      key: string;
      label: string;
      min: number;
      max: number;
      step?: number;
      value: number;
      onChange: (v: number) => void;
      help?: string;
      disabled?: boolean;
      persist?: boolean;
    }
  | {
      kind: "toggle";
      key: string;
      label: string;
      value: boolean;
      onChange: (v: boolean) => void;
      help?: string;
      persist?: boolean;
    }
  | {
      kind: "segment";
      key: string;
      options: { value: string; label: string; icon?: string }[];
      value: string;
      onChange: (v: string) => void;
      help?: string;
      persist?: boolean;
    };

// Base class every symmetry tool subclasses. A tool owns its parameters (plain
// fields), turns a stroke into a list of affine copies, declares its panel
// controls, and draws its guide lines. Discovery (symmetry.json + registry),
// the panel, persistence, the shared movable Centre and the guide styling are
// the framework's job - a tool stays small. To add one: drop a file in tools/
// that exports `icon` + `create`, and add a row to symmetry.json.
export abstract class SymmetryTool {
  // Opt into the shared movable Centre control. Tile leaves it false (it pivots
  // on the stroke start); the centred tools (Radial/Mirror/Concentric/Spiral)
  // set it true and the framework adds the Centre sliders + Recentre + crosshair.
  readonly usesCentre: boolean = false;

  // The per-stroke copies (frozen at pointerdown). Include an identity copy to
  // draw the master stroke.
  abstract transforms(ctx: ToolContext): Transform[];

  // Declarative panel controls (default: none).
  settings(): SymSetting[] {
    return [];
  }

  // The tool's own guide geometry. The framework clears the overlay first and
  // draws the centre crosshair afterwards for usesCentre tools.
  drawGuides(_r: IRenderer, _ctx: ToolContext): void {}

  // Whether deposited points are mirrored into the searchable cloud. False when a
  // tool floods so many copies it would evict the point cloud (Tile "Fill canvas").
  mirrorsPoints(): boolean {
    return true;
  }
}

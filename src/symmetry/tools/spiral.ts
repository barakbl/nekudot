import { SymmetryTool, type SymSetting, type ToolContext } from "../tool";
import type { IRenderer } from "../../renderer";
import { type Transform, IDENTITY, scaleRotateAbout } from "../transforms";

// Cap so a long copy count (× arms) can't melt the live redraw / point cloud.
const MAX_SPIRAL_COPIES = 120;

export const icon =
  '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><path d="M8 8 a1 1 0 1 1 1.4 0.9 a2.6 2.6 0 1 1 -3.8 -1.2 a4.4 4.4 0 1 1 6.4 2.8"/></svg>';

// Spiral: copies wound around the centre (rotate + scale per step), N arms.
class SpiralTool extends SymmetryTool {
  readonly usesCentre = true;
  copies = 16;
  arms = 1;
  angleStep = 24;
  scalePct = 92;

  // `arms` copies of a log spiral about the centre. Within each arm, copy k is
  // rotated by k·angleStep and scaled by scalePct^k; arms are spread evenly.
  // Arm 0 / copy 0 is the identity (the master stroke).
  transforms(ctx: ToolContext): Transform[] {
    const arms = Math.max(1, Math.floor(this.arms));
    const perArm = Math.min(
      Math.max(1, Math.floor(this.copies)),
      Math.max(1, Math.floor(MAX_SPIRAL_COPIES / arms)),
    );
    const da = (this.angleStep * Math.PI) / 180;
    const step = this.scalePct / 100;
    const out: Transform[] = [];
    for (let m = 0; m < arms; m++) {
      const arm0 = (m * 2 * Math.PI) / arms;
      let scale = 1;
      for (let k = 0; k < perArm; k++) {
        out.push(scaleRotateAbout(scale, arm0 + k * da, ctx.cx, ctx.cy));
        scale *= step;
      }
    }
    return out.length ? out : [IDENTITY];
  }

  settings(): SymSetting[] {
    return [
      {
        kind: "slider",
        key: "copies",
        label: "Copies",
        min: 3,
        max: 40,
        value: this.copies,
        onChange: (v) => (this.copies = v),
        help: "How many copies march around the spiral (per arm).",
      },
      {
        kind: "slider",
        key: "arms",
        label: "Arms",
        min: 1,
        max: 6,
        value: this.arms,
        onChange: (v) => (this.arms = v),
        help: "Repeat the whole spiral this many times, spread evenly around the centre.",
      },
      {
        kind: "slider",
        key: "angleStep",
        label: "Angle step",
        min: 5,
        max: 120,
        value: this.angleStep,
        onChange: (v) => (this.angleStep = v),
        help: "Degrees of rotation between successive copies. Copies × Angle step = total sweep.",
      },
      {
        kind: "slider",
        key: "scalePct",
        label: "Scale %",
        min: 70,
        max: 100,
        value: this.scalePct,
        onChange: (v) => (this.scalePct = v),
        help: "Size of each copy vs the previous. Under 100 spirals inward; 100 = a flat rotational fan.",
      },
    ];
  }

  drawGuides(r: IRenderer, ctx: ToolContext): void {
    const { cx, cy, size, guide } = ctx;
    const arms = Math.max(1, Math.floor(this.arms));
    const copies = Math.min(60, Math.max(1, Math.floor(this.copies)));
    const da = (this.angleStep * Math.PI) / 180;
    const step = this.scalePct / 100;
    const base = Math.min(size.width, size.height) * 0.42;
    for (let m = 0; m < arms; m++) {
      const arm0 = (m * 2 * Math.PI) / arms;
      let prev: { x: number; y: number } | null = null;
      let scale = 1;
      for (let k = 0; k < copies; k++) {
        const a = arm0 + k * da;
        const rad = base * scale;
        const pt = { x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad };
        if (prev) r.drawLine({ id: 0, ...prev }, { id: 0, ...pt }, guide);
        prev = pt;
        scale *= step;
      }
    }
  }
}

export const create = () => new SpiralTool();

import { BrushBase, type BrushSetting } from "../base";
import { MOUSE_SAMPLE, type PenSample } from "../pen";
import type { BrushContext } from "./registry";
import {
  colorSourceIcons,
  connectionColorLabels,
  connectionColorOptions,
  connectionLineColor,
  isDirectionalSource,
  normalizeColorSource,
  wrap01,
} from "./color-source";

export const icon =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><ellipse cx="10" cy="16.5" rx="4.6" ry="2.4"/><ellipse cx="13.5" cy="11.5" rx="4" ry="2.4" opacity="0.72"/><ellipse cx="11" cy="7" rx="3.1" ry="2" opacity="0.48"/></svg>';

export function create(c: BrushContext): WispBrush {
  return new WispBrush(c.host, undefined, c.store);
}

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  color: string | undefined; // undefined = inherit the toolbar Primary
};

const TILT_DRIFT = 1.5; // how hard pen tilt leans the plume
const ALPHA_MIN = 0.002; // retire a puff once it fades below this
// Bounds the per-frame draw + the release bake; defaults peak near ~700, so only
// extreme Density/Lifespan clamp.
const MAX_PARTICLES = 2000;
// Caps the synchronous bake at stroke end; the truncated tail is huge and
// near-invisible, so nothing the eye can see is lost.
const MAX_BAKE_FRAMES = 300;
// Colour-phase walk (non-solid sources): a little per frame so a dwell evolves,
// plus per pixel travelled so a moving stroke walks the palette along its path.
const PHASE_TIME_STEP = 0.0035;
const PHASE_TRAVEL_STEP = 0.0016;

// Port of Harmony v2's "smoke" brush: a live particle plume. A 60fps loop spawns
// puffs at the cursor that drift (aimed by Direction), grow and fade - the soft
// volume is hundreds of accumulated translucent stamps. Like Spray it runs its own
// rAF loop (holding still keeps building) and drops one throttled feeder point per
// frame, so a connecting brush can web over the plume.
//
// Nekudot snapshots undo at stroke end, so on release we BAKE the rest of the plume
// synchronously (fast-forward every puff to the end of its life) instead of
// animating a live tail past pen-up: identical final image, one undo step.
export class WispBrush extends BrushBase {
  private density = 1.0; // puffs spawned per frame
  private rise = 1.0; // drift speed (along `direction`)
  private lifespan = 1.0; // how slowly a puff fades
  private turbulence = 1.0; // wander across the drift axis
  // Plume heading in degrees: 0 = up (default), 90 right, 180 down, 270 left. Rise
  // is aimed along it; spread + turbulence run perpendicular, so it stays coherent.
  private direction = 0;

  // Colour source shared with the web + Color Pen (Primary / Secondary / Gradient /
  // Rainbow / Complement / any palette). "main" = inherit the Primary, one colour.
  private source = "main";
  private colorSpread = 30; // 0..100: how wide each batch spreads across the gradient

  private particles: Particle[] = [];
  private drawing = false; // pen down: the loop spawns while true
  private raf = 0;
  private cx = 0;
  private cy = 0;
  private pressure = 1; // last stylus pressure (1 for a mouse / pen off)
  private driftX = 0; // sideways push from pen tilt
  private driftY = 0;
  // Gradient position (0..1), advanced by time + travel and latched per puff at
  // spawn - so older (risen) puffs carry an earlier phase, a vertical ramp for free.
  private phase = 0;
  private phaseX = 0; // last centre, to advance the phase by travel distance
  private phaseY = 0;

  name(): string {
    return "Wisp";
  }

  // Each puff composites individually so the plume builds with dwell - never the
  // one-uniform-alpha wet buffer.
  bufferedStroke(): boolean {
    return false;
  }

  strokeStart(x: number, y: number): void {
    this.cx = x;
    this.cy = y;
    this.pressure = 1;
    this.driftX = 0;
    this.driftY = 0;
    this.phase = this.random(); // random gradient start so repeated strokes differ
    this.phaseX = x;
    this.phaseY = y;
    this.drawing = true;
    this.spawn(); // an immediate puff, so even a tap leaves a mark
    if (this.raf === 0 && typeof requestAnimationFrame !== "undefined") {
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  // Move the spawn centre + read pen state; the rAF loop does the work. Bypasses
  // the base per-sample deposit/draw, like Spray.
  stroke(x: number, y: number, _sample = true, pen: PenSample = MOUSE_SAMPLE): void {
    this.cx = x;
    this.cy = y;
    this.pressure = pen.isPen ? pen.pressure : 1;
    if (pen.isPen && pen.hasTilt) {
      this.driftX = Math.cos(pen.azimuth) * pen.tilt * TILT_DRIFT;
      this.driftY = Math.sin(pen.azimuth) * pen.tilt * TILT_DRIFT;
    } else {
      this.driftX = 0;
      this.driftY = 0;
    }
  }

  strokeEnd(): void {
    this.drawing = false;
    if (this.raf && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.raf);
    }
    this.raf = 0;
    // Bake the rest of the plume now (see class note): no new spawns, so it
    // terminates; the frame cap bounds the cost.
    let guard = 0;
    while (this.particles.length > 0 && guard++ < MAX_BAKE_FRAMES) {
      this.frame(false);
    }
    this.particles.length = 0;
    super.strokeEnd();
  }

  private tick = (): void => {
    if (!this.drawing) {
      this.raf = 0; // strokeEnd bakes the tail; never animate live past pen-up
      return;
    }
    this.frame(true);
    this.raf = requestAnimationFrame(this.tick);
  };

  // Unit vectors for Direction: `dir` is the heading (0deg = up), `perp` across it.
  // At 0deg -> dir=(0,-1), perp=(1,0): exactly the original up-plume.
  private axes(): { dirX: number; dirY: number; perpX: number; perpY: number } {
    const rad = (this.direction * Math.PI) / 180;
    return { dirX: Math.sin(rad), dirY: -Math.cos(rad), perpX: Math.cos(rad), perpY: Math.sin(rad) };
  }

  // One 60fps step: optionally spawn + feed, then advance/fade/stamp every puff.
  private frame(spawn: boolean): void {
    if (spawn) {
      const dist = Math.hypot(this.cx - this.phaseX, this.cy - this.phaseY);
      this.phase = wrap01(this.phase + PHASE_TIME_STEP + dist * PHASE_TRAVEL_STEP);
      this.phaseX = this.cx;
      this.phaseY = this.cy;
      this.spawn();
      this.depositPixel(this.cx, this.cy); // one feeder point/frame for connecting brushes
    }
    const fade = 1 - 0.03 / this.lifespan;
    const { perpX, perpY } = this.axes(); // wander runs across the drift axis
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      const tj = (this.random() - 0.5) * 0.2 * this.turbulence;
      p.vx += tj * perpX;
      p.vy += tj * perpY;
      p.radius *= 1.01;
      p.alpha *= fade;
      if (p.alpha < ALPHA_MIN) {
        this.particles.splice(i, 1);
        continue;
      }
      this.renderer.fillCircle(p.x, p.y, p.radius, p.color, p.alpha);
    }
  }

  // One batch at the centre: spread + radius scale with Size, count with Density +
  // pressure, start alpha with pressure + Opacity - matching Harmony's smoke.
  private spawn(): void {
    const size = this.host.strokeWidth();
    const opacity = this.host.strokeAlpha();
    const p = this.pressure;
    const n = Math.max(1, Math.round((1 + p * 5) * this.density));
    const dynamic = this.source !== "main"; // solid Primary keeps colour undefined
    const primary = dynamic ? this.frozenPrimary() : "";
    const secondary = dynamic ? this.frozenSecondary() : "";
    const spread = this.colorSpread / 100;
    const { dirX, dirY, perpX, perpY } = this.axes();
    for (let i = 0; i < n; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const color = dynamic
        ? connectionLineColor(
            this.source,
            wrap01(this.phase + spread * (this.random() - 0.5)),
            primary,
            secondary,
          )
        : undefined;
      // Speed along the heading, a small jitter across it (width); driftX/Y is tilt.
      const speed = (this.random() * 1.5 + 0.5) * this.rise;
      const jitter = (this.random() - 0.5) * 0.5;
      this.particles.push({
        x: this.cx + (this.random() - 0.5) * size,
        y: this.cy + (this.random() - 0.5) * size,
        vx: dirX * speed + perpX * jitter + this.driftX,
        vy: dirY * speed + perpY * jitter + this.driftY,
        radius: this.random() * size * 0.5 + size * 0.2,
        alpha: this.random() * 0.3 * p * opacity,
        color,
      });
    }
  }

  getSettings(): BrushSetting[] {
    return [
      {
        kind: "select",
        key: "wispColorSource",
        label: "Colour",
        options: connectionColorOptions(),
        optionLabels: connectionColorLabels(),
        icons: colorSourceIcons(this.store),
        value: this.source,
        onChange: (v) => (this.source = normalizeColorSource(v)),
      },
      {
        kind: "number",
        key: "wispColorSpread",
        label: "Colour spread",
        min: 0,
        max: 100,
        step: 1,
        unit: "%",
        value: this.colorSpread,
        onChange: (v) => (this.colorSpread = v),
        // Only bites for a multi-colour source; a single colour ignores spread.
        visibleWhen: {
          key: "wispColorSource",
          when: (v) => isDirectionalSource(String(v)),
        },
      },
      {
        kind: "number",
        key: "wispDensity",
        label: "Density",
        min: 0.3,
        max: 3.0,
        step: 0.1,
        unit: "×",
        value: this.density,
        onChange: (v) => (this.density = v),
      },
      {
        kind: "number",
        key: "wispRise",
        label: "Rise",
        min: 0,
        max: 3.0,
        step: 0.1,
        unit: "×",
        value: this.rise,
        onChange: (v) => (this.rise = v),
      },
      {
        kind: "number",
        key: "wispDirection",
        label: "Direction",
        min: 0,
        max: 360,
        step: 5,
        unit: "°",
        value: this.direction,
        onChange: (v) => (this.direction = v),
      },
      {
        kind: "number",
        key: "wispLifespan",
        label: "Lifespan",
        min: 0.5,
        max: 3.0,
        step: 0.1,
        unit: "×",
        value: this.lifespan,
        onChange: (v) => (this.lifespan = v),
      },
      {
        kind: "number",
        key: "wispTurbulence",
        label: "Turbulence",
        min: 0,
        max: 3.0,
        step: 0.1,
        unit: "×",
        value: this.turbulence,
        onChange: (v) => (this.turbulence = v),
      },
    ];
  }
}

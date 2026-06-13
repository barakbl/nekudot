// Pen (stylus) input. PointerEvents carry pressure / tilt / azimuth; this
// module turns them into one normalized PenSample per pointer sample, plus the
// response shaping (curve + floor + smoothing) that converts raw values into
// modulation factors. Only `pointerType === "pen"` modulates anything — mice
// and touch report constant pressure, so they always yield MOUSE_SAMPLE and
// every code path stays byte-identical to the pre-pen behaviour.

export type PenSample = {
  isPen: boolean;
  pressure: number; // 0..1
  tilt: number; // 0 = vertical pen, 1 = lying flat on the surface
  azimuth: number; // radians, screen-space direction the pen leans toward
  // Whether THIS sample has a usable lean direction (azimuth is meaningless
  // for a vertical pen or a device that doesn't report tilt).
  hasTilt: boolean;
};

export const MOUSE_SAMPLE: PenSample = {
  isPen: false,
  pressure: 1,
  tilt: 0,
  azimuth: 0,
  hasTilt: false,
};

// The PointerEvent fields we read — optional because altitude/azimuth only
// exist on newer browsers (and not in all TS lib versions).
export type PenEventLike = {
  pointerType: string;
  pressure: number;
  tiltX?: number;
  tiltY?: number;
  altitudeAngle?: number;
  azimuthAngle?: number;
};

const HALF_PI = Math.PI / 2;
const MIN_TILT_FOR_DIRECTION = 0.02;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function readPenSample(e: PenEventLike): PenSample {
  if (e.pointerType !== "pen") return MOUSE_SAMPLE;
  let tilt = 0;
  let azimuth = 0;
  if (typeof e.altitudeAngle === "number" && typeof e.azimuthAngle === "number") {
    // altitudeAngle: π/2 = perpendicular to the screen, 0 = lying flat.
    tilt = clamp01(1 - e.altitudeAngle / HALF_PI);
    azimuth = e.azimuthAngle;
  } else if (e.tiltX || e.tiltY) {
    // Spherical conversion from the tiltX/tiltY plane angles (degrees).
    const tx = ((e.tiltX ?? 0) * Math.PI) / 180;
    const ty = ((e.tiltY ?? 0) * Math.PI) / 180;
    azimuth = Math.atan2(Math.tan(ty), Math.tan(tx));
    const altitude = Math.atan2(1, Math.hypot(Math.tan(tx), Math.tan(ty)));
    tilt = clamp01(1 - altitude / HALF_PI);
  }
  return {
    isPen: true,
    pressure: clamp01(e.pressure),
    tilt,
    azimuth,
    hasTilt: tilt > MIN_TILT_FOR_DIRECTION,
  };
}

// Response shaping: a gamma curve with a floor — the bound slider's value is
// the MAXIMUM, pressure/tilt sweep from floor×value up to it. Gamma < 1 makes
// a light touch count more; > 1 demands firmer pressure (the "Response"
// slider in the Pen section picks it, DEFAULT_GAMMA at its midpoint).
export const DEFAULT_GAMMA = 0.7;
export const SIZE_FLOOR = 0.15;
export const ALPHA_FLOOR = 0.05;
export const DIAL_FLOOR = 0; // web dials sweep the full range

export function penFactor(
  input: number,
  floor: number,
  gamma = DEFAULT_GAMMA,
): number {
  return floor + (1 - floor) * Math.pow(clamp01(input), gamma);
}

// Per-stroke exponential smoothing so sensor wobble doesn't stipple the mark.
// `step` is the EMA fraction applied per sample (1 = raw samples, smaller =
// smoother/laggier — the "Smoothing" slider maps onto it). Azimuth is left
// raw (circular smoothing isn't worth the complexity for a chisel direction).
export const DEFAULT_SMOOTHING_STEP = 0.35;

export class PenSmoother {
  private pressure: number | null = null;
  private tilt: number | null = null;

  reset(): void {
    this.pressure = null;
    this.tilt = null;
  }

  smooth(s: PenSample, step = DEFAULT_SMOOTHING_STEP): PenSample {
    if (!s.isPen) {
      this.reset();
      return s;
    }
    this.pressure =
      this.pressure === null
        ? s.pressure
        : this.pressure + step * (s.pressure - this.pressure);
    this.tilt =
      this.tilt === null ? s.tilt : this.tilt + step * (s.tilt - this.tilt);
    return { ...s, pressure: this.pressure, tilt: this.tilt };
  }
}

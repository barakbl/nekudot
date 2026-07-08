// Idle-gap collapse + target-duration mapping for the process-video export
// (vector-replay P3.2). Pure + unit-tested, the house style for clip timing
// (mirrors src/clip/timeline.ts). Real sessions have thinking pauses, so a raw-time
// replay video is mostly stillness; this maps the SOURCE times of the captured
// states (one per sampled stroke, in order) onto OUTPUT frames: long idle gaps are
// clamped to a threshold, then the remaining activity is scaled to fill a target
// duration at a fixed fps. The frame producer holds each state (shares the same
// ImageData) across the frames it maps to, so RAM stays bounded by the state count.

export type FramePlanOptions = {
  // Gaps between consecutive states longer than this are collapsed to it (ms).
  idleGapMs: number;
  // Desired output video length (ms). The frame count is targetDurationMs/1000 * fps.
  targetDurationMs: number;
  // Output frame rate.
  fps: number;
  // Hard cap on output frames (bounds duration to maxFrames/fps and RAM/GIF size).
  maxFrames: number;
};

// Total ACTIVE time with idle gaps clamped to `idleGapMs` - the collapsed timeline's
// length. A producer uses this to pick a sensible target duration.
export function collapsedActivityMs(sourceTimes: readonly number[], idleGapMs: number): number {
  let total = 0;
  for (let i = 1; i < sourceTimes.length; i++) {
    const gap = Math.max(0, sourceTimes[i] - sourceTimes[i - 1]);
    total += Math.min(gap, idleGapMs);
  }
  return total;
}

// Map states -> output frames. Returns an array of length = the output frame count,
// each entry the index into `sourceTimes` of the state to show at that frame. Always
// non-decreasing (a build-up), starts at 0, ends at the last state.
export function planFrames(sourceTimes: readonly number[], opts: FramePlanOptions): number[] {
  const n = sourceTimes.length;
  if (n === 0) return [];
  if (n === 1) return [0];

  // Collapse idle gaps into a monotone activity clock per state.
  const clock = new Array<number>(n);
  clock[0] = 0;
  for (let i = 1; i < n; i++) {
    const gap = Math.max(0, sourceTimes[i] - sourceTimes[i - 1]);
    clock[i] = clock[i - 1] + Math.min(gap, opts.idleGapMs);
  }
  const totalClock = clock[n - 1];
  const frameCount = Math.max(
    2,
    Math.min(opts.maxFrames, Math.round((opts.targetDurationMs / 1000) * opts.fps)),
  );
  const plan = new Array<number>(frameCount);

  // Degenerate (every state at the same time, e.g. an all-simultaneous test input):
  // no activity clock to scale, so spread the states evenly by index.
  if (totalClock <= 0) {
    for (let f = 0; f < frameCount; f++) plan[f] = Math.round((f / (frameCount - 1)) * (n - 1));
    return plan;
  }

  // For each output frame, the latest state whose scaled activity time has elapsed.
  let si = 0;
  for (let f = 0; f < frameCount; f++) {
    const outT = (f / (frameCount - 1)) * opts.targetDurationMs; // frameCount >= 2 => safe
    while (si + 1 < n && (clock[si + 1] / totalClock) * opts.targetDurationMs <= outT) si++;
    plan[f] = si;
  }
  plan[frameCount - 1] = n - 1; // guarantee the finished artwork is the last frame
  return plan;
}

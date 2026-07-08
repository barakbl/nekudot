import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Guardrail (a tripwire, not a behavioural test). The global opacity slider must
// flow through OpacityController.set(), which writes BOTH the LayerManager's
// renderer alpha AND the persisted "app.opacity". Drive one without the other and
// the deposited points and the drawn line/previews diverge - the "web darkens" /
// "invisible brush" bug class this app has already been bitten by. The whole
// OpacityController exists to keep those two in lockstep.
//
// This scans src/ for `.setGlobalAlpha(` call sites and fails if one shows up in
// a file that isn't sanctioned below. It is intentionally simple, so be clear on
// its reach:
//   - it CATCHES a NEW file reaching for setGlobalAlpha (the real regression path:
//     someone adds a module and pulls the alpha lever directly);
//   - it does NOT catch a misuse INSIDE an already-listed file (the allowlist is
//     per-file, not per-call);
//   - a plain text scan can't tell the dangerous LayerManager channel from a
//     harmless renderer-level call, so files that legitimately use the
//     renderer-level setter (previews / the host pass-through) are listed too and
//     become trusted for both;
//   - it says nothing about correctness - that the controller actually keeps the
//     renderer alpha and "app.opacity" in sync lives in opacity-controller.test.ts.
//
// Adding an entry here should be a conscious "yes, this is a renderer-level use,
// not the slider channel" decision - not a reflex to make the test green.
const ALLOWED = new Set([
  "layered/manager.ts", // defines the slider channel + re-applies it to new layers
  "app/opacity-controller.ts", // the ONLY sanctioned caller of the LayerManager channel
  "brush-preview.ts", // its own offscreen preview renderer, not a layer
  "paint-host.ts", // pass-through of the renderer-level setGlobalAlpha
  "replay/offscreen.ts", // offscreen replay: sets alpha per stroke from the recorded ctx.alpha (no slider / no app.opacity to keep in sync)
]);

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

// Recursive walk (Node's readdirSync recursive option is too new to rely on).
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("global alpha channel", () => {
  it("routes setGlobalAlpha only through sanctioned files (slider alpha -> OpacityController)", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC_DIR)) {
      if (!/\.setGlobalAlpha\(/.test(readFileSync(file, "utf8"))) continue;
      const rel = file.slice(SRC_DIR.length + 1); // already posix-joined above
      if (!ALLOWED.has(rel)) offenders.push(rel);
    }
    expect(
      offenders,
      `These files call setGlobalAlpha directly: ${offenders.join(", ")}.\n` +
        `Route the global opacity slider through OpacityController.set() so the ` +
        `renderer alpha and the persisted "app.opacity" can't diverge. If this is ` +
        `genuinely a renderer-level use (e.g. a standalone preview canvas), add ` +
        `the file to ALLOWED in this test with a note saying why.`,
    ).toEqual([]);
  });
});

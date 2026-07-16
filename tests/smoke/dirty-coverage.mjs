// Dirty-tracker coverage smoke (tile-undo PR6). Drives every hard tool through a
// real offscreen LayerManager and asserts every changed pixel lands inside the
// layer's tracked dirty rects (PR4). Runs on REAL Chrome WITH GPU (never
// --disable-gpu - headless GPU-off masks the raster path that actually ships).
// Manual, like the other tests/smoke/*-live.mjs harnesses.
//
//   node tests/smoke/dirty-coverage.mjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4419, DBG = 9354;
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_URL = `http://localhost:${PORT}/tests/smoke/dirty-coverage.html`;
const findChrome = () =>
  [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean).find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, step = 200) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await fn()) return true; } catch {}
    await sleep(step);
  }
  return false;
}
function cdp(ws) {
  let id = 0;
  const p = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && p.has(m.id)) {
      const { res, rej } = p.get(m.id);
      p.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  return (method, params = {}, sid) =>
    new Promise((res, rej) => {
      const mid = ++id;
      p.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) }));
    });
}

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.log("• No Chrome found (set $CHROME). Skipping."); return 0; }

  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: join(HERE, "..", ".."),
    stdio: "ignore",
  });
  // GPU ON: no --disable-gpu. headless=new keeps the real GPU raster path, which
  // is what the off-screen-attached layer canvases accelerate on.
  const browser = spawn(chrome, [
    "--headless=new",
    `--remote-debugging-port=${DBG}`,
    "--force-device-scale-factor=1",
    "--window-size=1200,900",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });

  let ws;
  try {
    if (!(await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok)))
      throw new Error("vite dev server did not start");
    let wsUrl;
    if (!(await waitFor(async () => {
      const r = await fetch(`http://localhost:${DBG}/json/version`).then((x) => x.json()).catch(() => null);
      wsUrl = r?.webSocketDebuggerUrl;
      return !!wsUrl;
    }))) throw new Error("chrome devtools did not start");

    ws = await new Promise((res, rej) => {
      const w = new WebSocket(wsUrl);
      w.onopen = () => res(w);
      w.onerror = rej;
    });
    const send = cdp(ws);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S("Page.enable");
    await S("Runtime.enable");
    await S("Page.navigate", { url: PAGE_URL });

    const E = async (expr) => {
      const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails)
        throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };

    if (!(await waitFor(() => E("window.__coverageDone === true"), 90000)))
      throw new Error("coverage harness did not finish");

    const error = await E("window.__coverageError");
    if (error) { console.log("✗ harness error:\n" + error); return 1; }

    const results = await E("window.__coverageResult");
    let failed = 0;
    for (const r of results) {
      const painted = r.changed > 0;
      const covered = r.uncovered === 0;
      const pass = painted && covered;
      if (!pass) failed++;
      const why = !painted ? " (nothing painted!)" : !covered ? ` (${r.uncovered} UNCOVERED)` : "";
      console.log(`  ${pass ? "✓" : "✗"} ${r.name}: changed=${r.changed} uncovered=${r.uncovered} rects=${r.rects}${r.all ? " all" : ""}${r.buffered ? " wet" : ""}${why}`);
    }
    console.log(
      failed
        ? `\n✗ ${failed}/${results.length} tools have pixels outside their tracked dirty set`
        : `\n✓ all ${results.length} tools: every painted pixel is inside the tracked dirty set`,
    );
    await send("Target.closeTarget", { targetId });
    return failed ? 1 : 0;
  } finally {
    try { ws?.close(); } catch {}
    browser.kill("SIGKILL");
    dev.kill("SIGKILL");
  }
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error("dirty-coverage failed:", e.message);
  process.exit(1);
});

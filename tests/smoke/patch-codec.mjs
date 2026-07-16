// Patch-codec smoke (tile-undo PR8). Runs the browser-only half of the codec
// tests - the PNG fallback and blitPatch pixel placement - which Node can't (no
// ImageData/canvas). The deflate path is covered exactly in tests/patch-codec.test.ts.
// Manual, like the other tests/smoke/*-live.mjs harnesses.
//
//   node tests/smoke/patch-codec.mjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4420, DBG = 9355;
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE_URL = `http://localhost:${PORT}/tests/smoke/patch-codec.html`;
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
  const browser = spawn(chrome, [
    "--headless=new",
    `--remote-debugging-port=${DBG}`,
    "--force-device-scale-factor=1",
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

    if (!(await waitFor(() => E("window.__patchDone === true"), 30000)))
      throw new Error("patch-codec harness did not finish");

    const error = await E("window.__patchError");
    if (error) { console.log("✗ harness error:\n" + error); return 1; }

    const results = await E("window.__patchResult");
    let failed = 0;
    for (const r of results) {
      if (!r.pass) failed++;
      console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}${r.detail ? ` - ${r.detail}` : ""}`);
    }
    console.log(failed ? `\n✗ ${failed}/${results.length} checks failed` : `\n✓ all ${results.length} checks passed`);
    await send("Target.closeTarget", { targetId });
    return failed ? 1 : 0;
  } finally {
    try { ws?.close(); } catch {}
    browser.kill("SIGKILL");
    dev.kill("SIGKILL");
  }
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error("patch-codec smoke failed:", e.message);
  process.exit(1);
});

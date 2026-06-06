// Regression gate for the brushes/presets refactor. Renders every brush and
// every connecting preset through the real engine in headless Chrome and either
// freezes a baseline or pixel-diffs against it.
//
//   node tests/smoke/all-render.mjs --update   # freeze baseline PNGs
//   node tests/smoke/all-render.mjs            # diff vs baseline (exit 1 on regress)
//
// Diffing happens in-browser (window.__diff) so we need no Node PNG decoder.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4401;
const UPDATE = process.argv.includes("--update");
const TOL = Number(process.env.DIFF_TOL ?? 8); // per-channel tolerance (0..255)
const THRESH = Number(process.env.DIFF_THRESH ?? 0.005); // max mismatched fraction
const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(HERE, "baseline");
const PAGE_URL = `http://localhost:${PORT}/tests/smoke/all-render.html`;

function findChrome() {
  return [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean).find((p) => existsSync(p));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 20000, step = 200) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if (await fn()) return true; } catch {}
    await sleep(step);
  }
  return false;
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  };
  return (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
}

function dataUrlToBuffer(url) {
  return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
}
function pngToDataUrl(buf) {
  return "data:image/png;base64," + buf.toString("base64");
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.log("• No Chrome found (set $CHROME). Skipping.");
    return 0;
  }

  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: join(HERE, "..", ".."),
    stdio: "ignore",
  });
  const browser = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--remote-debugging-port=9335",
    "--force-device-scale-factor=1", "--no-first-run", "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });

  let ws;
  try {
    if (!(await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok)))
      throw new Error("vite dev server did not start");
    let wsUrl;
    if (!(await waitFor(async () => {
      const r = await fetch("http://localhost:9335/json/version").then((x) => x.json()).catch(() => null);
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

    if (!(await waitFor(() => E("window.__renderDone === true"), 25000)))
      throw new Error("harness did not finish rendering");

    const errors = await E("window.__errors");
    if (errors?.length) {
      console.log("✗ cell render errors:\n  " + errors.join("\n  "));
      return 1;
    }

    if (UPDATE) {
      mkdirSync(BASELINE_DIR, { recursive: true });
      const cells = await E("window.__cells");
      let n = 0;
      for (const [name, { png }] of Object.entries(cells)) {
        writeFileSync(join(BASELINE_DIR, `${name}.png`), dataUrlToBuffer(png));
        n++;
      }
      console.log(`✓ froze ${n} baseline cells → ${BASELINE_DIR}`);
      await send("Target.closeTarget", { targetId });
      return 0;
    }

    if (!existsSync(BASELINE_DIR)) {
      console.log("✗ no baseline; run with --update first");
      return 1;
    }
    const baselines = {};
    for (const f of readdirSync(BASELINE_DIR)) {
      if (f.endsWith(".png"))
        baselines[f.slice(0, -4)] = pngToDataUrl(readFileSync(join(BASELINE_DIR, f)));
    }
    await E(`window.__BASELINES = ${JSON.stringify(baselines)}`);
    const results = await E(`window.__diff(window.__BASELINES, ${TOL})`);

    let failed = 0;
    for (const r of results.sort((a, b) => a.name.localeCompare(b.name))) {
      if (r.missing) { console.log(`  ✗ ${r.name}: no baseline`); failed++; continue; }
      if (r.orphan) { console.log(`  ✗ ${r.name}: baseline has no cell`); failed++; continue; }
      const pct = (r.frac * 100).toFixed(3);
      if (r.frac > THRESH) { console.log(`  ✗ ${r.name}: ${pct}% changed (${r.mismatch}px)`); failed++; }
      else console.log(`  ✓ ${r.name}: ${pct}%`);
    }
    console.log(failed ? `\n✗ ${failed} cell(s) regressed (tol ${TOL}, thresh ${(THRESH * 100).toFixed(2)}%)`
                       : `\n✓ all ${results.length} cells within threshold`);
    await send("Target.closeTarget", { targetId });
    return failed ? 1 : 0;
  } finally {
    try { ws?.close(); } catch {}
    browser.kill("SIGKILL");
    dev.kill("SIGKILL");
  }
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error("all-render failed:", e.message);
  process.exit(1);
});

// Fur lab: render a labeled grid of fur parameter variants through the real
// engine in headless Chrome, so fur tuning can be eyeballed.
//
//   node tests/smoke/fur-lab.mjs --variants v.json --out /tmp/fur.png \
//        [--port 4500] [--debug-port 9400]
//
// `v.json` is a JSON array of variants. Each variant starts from the real "fur"
// preset; any ArtStyle key it sets (strands, spread, alpha, density, radius,
// fade, scatter, taper, flow, fray, length, wave, dynamics, grainStrength,
// grainAngle, grainCross, connect, ...) overrides it. `label` names the cell;
// `stroke` (hex) sets the ink colour. Distinct --port / --debug-port let several
// runs go in parallel.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const PORT = Number(arg("port", "4500"));
const DEBUG_PORT = Number(arg("debug-port", "9400"));
const OUT = arg("out", "/tmp/fur-lab.png");
const VARIANTS_FILE = arg("variants", "");
const ROOT = new URL("../..", import.meta.url).pathname;
const PAGE_URL = `http://localhost:${PORT}/tests/smoke/fur-lab.html`;

const variants = VARIANTS_FILE
  ? JSON.parse(readFileSync(VARIANTS_FILE, "utf8"))
  : [{ label: "fur (default)" }];

function findChrome() {
  return [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean).find((p) => existsSync(p));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 25000, step = 200) {
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

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.log("• No Chrome found (set $CHROME). Skipping."); return 0; }

  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT, stdio: "ignore",
  });
  const browser = spawn(chrome, [
    "--headless=new", "--disable-gpu", `--remote-debugging-port=${DEBUG_PORT}`,
    "--force-device-scale-factor=1", "--no-first-run", "--no-default-browser-check",
    `--user-data-dir=/tmp/fur-lab-chrome-${DEBUG_PORT}`, "about:blank",
  ], { stdio: "ignore" });

  let ws;
  try {
    if (!(await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok)))
      throw new Error("vite dev server did not start");
    let wsUrl;
    if (!(await waitFor(async () => {
      const r = await fetch(`http://localhost:${DEBUG_PORT}/json/version`).then((x) => x.json()).catch(() => null);
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
    await S("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1200, deviceScaleFactor: 1, mobile: false });
    // Inject the variants before any page script runs.
    await S("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.__FUR_VARIANTS = ${JSON.stringify(variants)};`,
    });
    await S("Page.navigate", { url: PAGE_URL });

    const E = async (expr) => {
      const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };

    if (!(await waitFor(() => E("window.__renderDone === true"), 25000)))
      throw new Error("harness did not finish rendering");
    await sleep(300);

    const errs = await E(`[...document.querySelectorAll('figcaption')].filter(c=>/ERROR/.test(c.textContent)).map(c=>c.textContent)`);
    if (errs.length) console.log("⚠ variant errors:\n" + errs.join("\n"));

    const { cssContentSize } = await S("Page.getLayoutMetrics");
    const clip = { x: 0, y: 0, width: Math.ceil(cssContentSize.width), height: Math.ceil(cssContentSize.height), scale: 1 };
    const { data } = await S("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
    writeFileSync(OUT, Buffer.from(data, "base64"));
    console.log(`✓ wrote ${OUT} (${clip.width}×${clip.height}, ${variants.length} variants)`);

    await send("Target.closeTarget", { targetId });
    return 0;
  } finally {
    try { ws?.close(); } catch {}
    browser.kill("SIGKILL");
    dev.kill("SIGKILL");
  }
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error("fur-lab failed:", e.message);
  process.exit(1);
});

// Render every connection art-style preset through the real engine in headless
// Chrome and capture one screenshot grid, so textures can be eyeballed.
//
//   node tests/smoke/render-presets.mjs [out.png]
//
// Serves the app with the Vite dev server (so /src/*.ts is transpiled) and loads
// tests/smoke/presets-render.html, which draws each preset to its own canvas.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFileSync } from "node:fs";

const PORT = 4400;
const OUT = process.argv[2] || "/tmp/preset-render.png";
const PAGE = process.argv[3] || "tests/smoke/presets-render.html";
const PAGE_URL = `http://localhost:${PORT}/${PAGE}`;

function findChrome() {
  const cands = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return cands.find((p) => existsSync(p));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 20000, step = 200) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await fn()) return true;
    } catch {}
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
  if (!chrome) {
    console.log("• No Chrome found (set $CHROME). Skipping.");
    return 0;
  }

  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], {
    cwd: new URL("../..", import.meta.url).pathname,
    stdio: "ignore",
  });
  const browser = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--remote-debugging-port=9334",
    "--force-device-scale-factor=1", "--no-first-run", "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });

  let ws;
  try {
    if (!(await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok)))
      throw new Error("vite dev server did not start");
    let wsUrl;
    if (!(await waitFor(async () => {
      const r = await fetch("http://localhost:9334/json/version").then((x) => x.json()).catch(() => null);
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
    await S("Emulation.setDeviceMetricsOverride", { width: 1000, height: 960, deviceScaleFactor: 1, mobile: false });
    await S("Page.navigate", { url: PAGE_URL });

    const E = async (expr) => {
      const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };

    if (!(await waitFor(() => E("window.__renderDone === true"), 20000)))
      throw new Error("harness did not finish rendering");
    await sleep(300);

    // Report any per-preset errors the harness surfaced in captions.
    const errs = await E(`[...document.querySelectorAll('figcaption')].filter(c=>/ERROR/.test(c.textContent)).map(c=>c.textContent)`);
    if (errs.length) console.log("⚠ preset errors:\n" + errs.join("\n"));

    const { cssContentSize } = await S("Page.getLayoutMetrics");
    const clip = { x: 0, y: 0, width: Math.ceil(cssContentSize.width), height: Math.ceil(cssContentSize.height), scale: 1 };
    const { data } = await S("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
    writeFileSync(OUT, Buffer.from(data, "base64"));
    console.log(`✓ wrote ${OUT} (${clip.width}×${clip.height})`);

    await send("Target.closeTarget", { targetId });
    return 0;
  } finally {
    try { ws?.close(); } catch {}
    browser.kill("SIGKILL");
    dev.kill("SIGKILL");
  }
}

main().then((c) => process.exit(c)).catch((e) => {
  console.error("render failed:", e.message);
  process.exit(1);
});

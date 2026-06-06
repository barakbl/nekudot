// Capture clean book figures: render each demo page in headless Chrome and grab
// just the white <canvas> (no dark page chrome, no caption) into public/book/img.
//
//   node tests/smoke/capture-figures.mjs
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const PORT = 4401;
const ROOT = new URL("../..", import.meta.url).pathname;
const OUTDIR = ROOT + "public/book/img/";

// page → [{ idx: canvas index, out: filename }]
const TARGETS = [
  ["tests/smoke/fur-demo.html", [{ idx: 0, out: "fur-cat.png" }]],
  ["tests/smoke/lace-demo.html", [{ idx: 0, out: "lace-mat.png" }, { idx: 1, out: "lace-map.png" }]],
];

const findChrome = () => [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean).find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 20000, step = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(step); } return false; }
function cdp(ws) { let id = 0; const pending = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sessionId) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) })); }); }

const chrome = findChrome();
if (!chrome) { console.log("• No Chrome found. Skipping."); process.exit(0); }
const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
const browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--remote-debugging-port=9337", "--force-device-scale-factor=1", "--no-first-run", "about:blank"], { stdio: "ignore" });
let ws;
try {
  await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok);
  let wsUrl; await waitFor(async () => { const r = await fetch("http://localhost:9337/json/version").then((x) => x.json()).catch(() => null); wsUrl = r?.webSocketDebuggerUrl; return !!wsUrl; });
  ws = await new Promise((res, rej) => { const w = new WebSocket(wsUrl); w.onopen = () => res(w); w.onerror = rej; });
  const send = cdp(ws);
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S("Page.enable"); await S("Runtime.enable");
  await S("Emulation.setDeviceMetricsOverride", { width: 1300, height: 1500, deviceScaleFactor: 1, mobile: false });
  const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

  for (const [page, shots] of TARGETS) {
    await S("Page.navigate", { url: `http://localhost:${PORT}/${page}` });
    if (!(await waitFor(() => E("window.__renderDone === true")))) throw new Error("no render: " + page);
    await sleep(250);
    for (const { idx, out } of shots) {
      const rect = JSON.parse(await E(`(()=>{const c=document.querySelectorAll('canvas')[${idx}];const r=c.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height});})()`));
      const { data } = await S("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 } });
      writeFileSync(OUTDIR + out, Buffer.from(data, "base64"));
      console.log("✓", out, `${Math.round(rect.w)}×${Math.round(rect.h)} @2x`);
    }
  }
} finally {
  try { ws?.close(); } catch {}
  browser.kill("SIGKILL"); dev.kill("SIGKILL");
}

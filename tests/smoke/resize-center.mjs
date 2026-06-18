// Real app: the canvas stays centred across a window resize (regression guard
// for viewport.onResize). A resize that doesn't overflow used to leave the
// canvas pinned to its old offset, drifting off-centre. Internals-free: drive a
// real viewport resize and assert the layer canvas's on-screen margins stay
// symmetric. Run: node tests/smoke/resize-center.mjs  (exit 1 on regression).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4438, DBG = 9372;
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = `http://localhost:${PORT}/`;
const findChrome = () => ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, s = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(s); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome — skipping."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const br = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,720", "--no-first-run", "about:blank"], { stdio: "ignore" });
  let ws, fails = 0;
  const ok = (name, cond, detail) => { console.log(`${cond ? "✓" : "✗"} ${name}${cond ? "" : " — " + detail}`); if (!cond) fails++; };
  try {
    await waitFor(async () => (await fetch(PAGE)).ok);
    let u; await waitFor(async () => { const r = await fetch(`http://localhost:${DBG}/json/version`).then((x) => x.json()).catch(() => null); u = r?.webSocketDebuggerUrl; return !!u; });
    ws = await new Promise((res, rej) => { const w = new WebSocket(u); w.onopen = () => res(w); w.onerror = rej; });
    const send = cdp(ws);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S("Page.enable"); await S("Runtime.enable");
    await S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    // A small square canvas (so off-centring is large) and skip onboarding.
    await E("localStorage.setItem('app.onboarded','true'); localStorage.setItem('app.canvas.size', JSON.stringify({width:400,height:400}))");
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await sleep(400);

    // Margins of the drawing layer canvas (the 400px one with a real size).
    const margins = () => E(`(function(){
      const c=[...document.querySelectorAll('.stage canvas')].find(c=>c.style.width==='400px' && c.getBoundingClientRect().width>0);
      const r=c.getBoundingClientRect();
      return { L:Math.round(r.left), R:Math.round(innerWidth-r.right), T:Math.round(r.top), B:Math.round(innerHeight-r.bottom) };
    })()`);
    const centred = (m) => Math.abs(m.L - m.R) <= 1 && Math.abs(m.T - m.B) <= 1;

    const m0 = await margins();
    ok("centred at initial size", centred(m0), JSON.stringify(m0));

    await S("Emulation.setDeviceMetricsOverride", { width: 760, height: 620, deviceScaleFactor: 1, mobile: false });
    await E("window.dispatchEvent(new Event('resize'))");
    await sleep(300);
    const m1 = await margins();
    ok("stays centred after shrink", centred(m1), JSON.stringify(m1));

    await S("Emulation.setDeviceMetricsOverride", { width: 1300, height: 860, deviceScaleFactor: 1, mobile: false });
    await E("window.dispatchEvent(new Event('resize'))");
    await sleep(300);
    const m2 = await margins();
    ok("stays centred after grow", centred(m2), JSON.stringify(m2));
  } finally {
    try { ws?.close(); } catch {}
    br.kill("SIGKILL"); dev.kill("SIGKILL");
  }
  console.log(fails ? `\n✗ ${fails} check(s) failed` : "\n✓ canvas stays centred across resizes");
  return fails ? 1 : 0;
}
main().then((c) => process.exit(c));

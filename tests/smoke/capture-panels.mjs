// Capture the book's UI figures (toolbar + panels) from the real app in headless
// Chrome, into docs/book/img. Opens each panel, positions it for a clean shot,
// and grabs just that element. Dark theme + a clean canvas for consistency.
//
//   node tests/smoke/capture-panels.mjs
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const PORT = 4402, DBG = 9338;
const ROOT = new URL("../..", import.meta.url).pathname;
const OUTDIR = ROOT + "docs/book/img/";
const findChrome = () => [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean).find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 20000, step = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(step); } return false; }
function cdp(ws) { let id = 0; const pending = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

const chrome = findChrome();
if (!chrome) { console.log("• No Chrome found. Skipping."); process.exit(0); }
const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
const browser = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=2", "--window-size=1400,1600", "--no-first-run", "about:blank"], { stdio: "ignore" });
let ws;
try {
  await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok);
  let wsUrl; await waitFor(async () => { const r = await fetch(`http://localhost:${DBG}/json/version`).then((x) => x.json()).catch(() => null); wsUrl = r?.webSocketDebuggerUrl; return !!wsUrl; });
  ws = await new Promise((res, rej) => { const w = new WebSocket(wsUrl); w.onopen = () => res(w); w.onerror = rej; });
  const send = cdp(ws);
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S("Page.enable"); await S("Runtime.enable");
  await S("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1600, deviceScaleFactor: 2, mobile: false });
  const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const key = async (k, code, vk) => { for (const t of ["keyDown", "keyUp"]) await S("Input.dispatchKeyEvent", { type: t, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await sleep(180); };

  await S("Page.navigate", { url: `http://localhost:${PORT}/` });
  await waitFor(() => E("!!document.querySelector('.stage canvas')"));
  await E("localStorage.clear(); localStorage.setItem('app.theme','\"dark\"')");
  await S("Page.navigate", { url: `http://localhost:${PORT}/` });
  await waitFor(() => E("!!document.querySelector('.stage canvas')"));
  await sleep(500);

  const shot = async (selector, out, pad = 0, move = true) => {
    // position the panel for a fully-visible shot (skip for the toolbar, which
    // is centred via transform - moving it would push its contents off the clip)
    if (move) {
      await E(`(()=>{const p=document.querySelector(${JSON.stringify(selector)}); if(p){p.style.left='60px'; p.style.top='70px'; p.style.right='auto'; p.style.bottom='auto';}})()`);
      await sleep(120);
    }
    const rect = JSON.parse(await E(`(()=>{const p=document.querySelector(${JSON.stringify(selector)}); const r=p.getBoundingClientRect(); return JSON.stringify({x:r.x,y:r.y,w:r.width,h:r.height});})()`));
    const { data } = await S("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: rect.x - pad, y: rect.y - pad, width: rect.w + pad * 2, height: rect.h + pad * 2, scale: 1 } });
    writeFileSync(OUTDIR + out, Buffer.from(data, "base64"));
    console.log("✓", out, `${Math.round(rect.w)}×${Math.round(rect.h)} @2x`);
  };

  // Start page (onboarding) - it's showing now because we just cleared storage
  // (first run). Capture the content card, then dismiss it for the panel shots.
  await shot(".onboarding-card", "start-page.png", 20, false);
  await E("(()=>{const b=document.querySelector('.onboarding-close'); if(b) b.click();})()");
  await sleep(150);

  // Toolbar (always present, centred) - now includes the Reset view button.
  await shot(".toolbar", "toolbar.png", 0, false);

  // Symmetry panel in Radial: shows the 6-mode picker (Concentric/Spiral),
  // the Mirror iOS switch, the movable Centre + Recentre, and Guides.
  await key("y", "KeyY", 89);
  await E(`[...document.querySelectorAll('.sym-mode-btn')].find(b=>b.textContent.includes('Radial')).click()`);
  await sleep(150);
  await shot(".symmetry-box", "panel-symmetry.png");
  await key("y", "KeyY", 89); // close

  // Brush settings (Brush tab) - pen bindings are iOS switches now.
  await key("b", "KeyB", 66);
  await shot(".settings-panel", "panel-settings.png");
  await key("b", "KeyB", 66);

  // Connecting settings tab - open the Web weight "Customize" fold so the figure
  // shows the presets AND the underlying sliders.
  await key("c", "KeyC", 67);
  await sleep(120);
  await E("(()=>{const t=document.querySelector('.settings-group-webweight .settings-group-toggle'); if(t) t.click();})()");
  await sleep(150);
  await shot(".settings-panel", "panel-settings-connecting.png");
  await key("c", "KeyC", 67);

  // Layers panel - the Background "Transparent" iOS switch.
  await key("l", "KeyL", 76);
  await shot(".layers-box:not(.symmetry-box)", "panel-layers.png");
  await key("l", "KeyL", 76);

  // Application settings panel (global: theme / input / advanced).
  await key(",", "Comma", 188);
  await shot(".app-settings-box", "panel-app-settings.png");
  await key(",", "Comma", 188);
} finally {
  try { ws?.close(); } catch {}
  browser.kill("SIGKILL"); dev.kill("SIGKILL");
}

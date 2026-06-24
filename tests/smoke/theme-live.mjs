// Drive the REAL app (root index.html -> /src/main.ts) in headless Chrome with
// REAL mouse events: open App Settings and flip the theme via the segmented
// Auto / Light / Dark control, screenshotting each step and asserting the root
// dataset.theme actually changes. Theme lives in App Settings now (it used to
// be a More-menu submenu); this catches what a synthetic .click() harness misses.
//
//   node tests/smoke/theme-live.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4406, DBG = 9340;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "buildup-out");
const PAGE_URL = `http://localhost:${PORT}/`;
const findChrome = () => [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, step = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(step); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome found."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const browser = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,720", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ws;
  try {
    if (!(await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok))) throw new Error("vite did not start");
    let wsUrl;
    if (!(await waitFor(async () => { const r = await fetch(`http://localhost:${DBG}/json/version`).then((x) => x.json()).catch(() => null); wsUrl = r?.webSocketDebuggerUrl; return !!wsUrl; }))) throw new Error("devtools did not start");
    ws = await new Promise((res, rej) => { const w = new WebSocket(wsUrl); w.onopen = () => res(w); w.onerror = rej; });
    const send = cdp(ws);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S("Page.enable"); await S("Runtime.enable");
    await S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
    // Treat as already onboarded so the Start page doesn't cover the canvas/UI.
    await S("Page.addScriptToEvaluateOnNewDocument", { source: "try { localStorage.setItem('app.onboarded', 'true'); } catch (e) {}" });
    await S("Page.navigate", { url: PAGE_URL });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

    mkdirSync(OUT, { recursive: true });
    const shot = async (name) => { const s = await S("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, name), Buffer.from(s.data, "base64")); };

    // real mouse click at an element's center (mousedown -> mouseup -> the click)
    const realClick = async (selector) => {
      const box = await E(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
      if (!box) throw new Error(`no element: ${selector}`);
      for (const type of ["mousePressed", "mouseReleased"])
        await S("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1, buttons: 1 });
      await sleep(120);
    };
    const key = async (type, k, code) => S("Input.dispatchKeyEvent", { type, key: k, code });

    if (!(await waitFor(() => E(`!!document.querySelector('.canvas-menu-btn')`), 30000))) throw new Error("app/toolbar did not load");
    await sleep(300);
    await shot("live-00-initial.png");

    // Theme moved from the More menu to App Settings: open it with the "," shortcut.
    await key("keyDown", ",", "Comma"); await key("keyUp", ",", "Comma");
    if (!(await waitFor(() => E(`(() => { const p = document.querySelector('.app-settings-box'); return p && getComputedStyle(p).display !== 'none'; })()`), 5000)))
      throw new Error("App settings panel did not open");
    await shot("live-01-appsettings.png");

    const before = await E(`document.documentElement.dataset.theme || '(auto/none)'`);
    // Segmented Auto / Light / Dark control: pick the option that isn't active.
    const picked = await E(`document.querySelector('.appset-seg-btn:not(.active)')?.textContent ?? null`);
    if (!picked) throw new Error("no inactive theme button found");
    await realClick(".appset-seg-btn:not(.active)");
    await sleep(150);
    const after = await E(`document.documentElement.dataset.theme || '(auto/none)'`);
    const activeLabel = await E(`document.querySelector('.appset-seg-btn.active')?.textContent ?? null`);
    await shot("live-02-theme-picked.png");
    console.log(`Theme: ${before} -> ${after} (active button: ${activeLabel})`);

    if (after === before) throw new Error(`theme did not change (still ${after})`);

    console.log(`\nScreenshots → ${OUT}/live-0*.png`);
    await send("Target.closeTarget", { targetId });
    return 0;
  } finally { try { ws?.close(); } catch {} browser.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("theme-live failed:", e.message); process.exit(1); });

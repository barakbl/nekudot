// Drive the REAL app (root index.html -> /src/main.ts) in headless Chrome with
// REAL mouse events: draw a stroke, then exercise the canvas menu's Export and
// Share, asserting a PNG download fires for each and that Share shows its chip.
// Web Share is neutralized so Share takes the desktop download + chip fallback
// (headless otherwise exposes navigator.canShare and silently "shares").
//
//   node tests/smoke/export-share-live.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4407, DBG = 9341;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "buildup-out");
const DL = mkdtempSync(join(tmpdir(), "smoke-dl-"));
const PAGE_URL = `http://localhost:${PORT}/`;
const SHARE_CHIP = "Image saved + caption copied — attach it to share";
const findChrome = () => [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, step = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(step); } return false; }
function cdp(ws, events) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method) events.push(m); }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome found."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const browser = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,720", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  const events = [];
  let ws;
  try {
    if (!(await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok))) throw new Error("vite did not start");
    let wsUrl;
    if (!(await waitFor(async () => { const r = await fetch(`http://localhost:${DBG}/json/version`).then((x) => x.json()).catch(() => null); wsUrl = r?.webSocketDebuggerUrl; return !!wsUrl; }))) throw new Error("devtools did not start");
    ws = await new Promise((res, rej) => { const w = new WebSocket(wsUrl); w.onopen = () => res(w); w.onerror = rej; });
    const send = cdp(ws, events);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S("Page.enable"); await S("Runtime.enable");
    await S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 720, deviceScaleFactor: 1, mobile: false });
    await S("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL, eventsEnabled: true }).catch(() => {});
    // Onboarded (uncovered canvas) + no Web Share, so Share hits the desktop path.
    await S("Page.addScriptToEvaluateOnNewDocument", { source: "try { localStorage.setItem('app.onboarded', 'true'); Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch (e) {}" });
    await S("Page.navigate", { url: PAGE_URL });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

    mkdirSync(OUT, { recursive: true });
    const shot = async (name) => { const s = await S("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, name), Buffer.from(s.data, "base64")); };
    // button stays "left" even on release/move so Chrome synthesizes the click;
    // the held state is carried by the buttons bitmask (1 = down, 0 = up).
    const mouse = async (type, x, y, buttons) => S("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: buttons ?? 0, clickCount: 1 });
    const realClick = async (selector) => {
      const box = await E(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
      if (!box) throw new Error(`no element: ${selector}`);
      await mouse("mousePressed", box.x, box.y, 1); await mouse("mouseReleased", box.x, box.y, 0);
      await sleep(150);
    };
    const clickMenuItem = async (label) => {
      const box = await E(`(() => { const o = [...document.querySelectorAll('.canvas-menu-popover .brush-option')].find((o) => o.querySelector('.opt-label')?.textContent === ${JSON.stringify(label)}); if (!o) return null; const r = o.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
      if (!box) throw new Error(`no menu item: ${label}`);
      await mouse("mousePressed", box.x, box.y, 1); await mouse("mouseReleased", box.x, box.y, 0);
      await sleep(250);
    };
    const downloads = () => events.filter((m) => /downloadWillBegin$/.test(m.method)).map((m) => m.params?.suggestedFilename).filter(Boolean);

    if (!(await waitFor(() => E(`!!document.querySelector('.canvas-menu-btn') && !!document.querySelector('.stage')`), 30000))) throw new Error("app/toolbar did not load");
    await sleep(400);
    await shot("es-00-initial.png");

    // ---- draw a stroke so there's something to export/share ----
    const rect = await E(`(() => { const r = document.querySelector('.stage').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
    const sx = rect.l + rect.w / 2 - 80, sy = rect.t + rect.h / 2 - 40;
    await mouse("mouseMoved", sx, sy, 0); await mouse("mousePressed", sx, sy, 1);
    for (let i = 1; i <= 10; i++) await mouse("mouseMoved", sx + i * 16, sy + i * 8, 1);
    await mouse("mouseReleased", sx + 160, sy + 80, 0);
    await sleep(300);
    const strokePixels = await E(`(() => { const c = document.querySelector('.stage canvas'); if (!c) return -1; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; })()`);
    await shot("es-01-stroke.png");
    if (strokePixels <= 0) throw new Error(`stroke left no pixels (${strokePixels})`);

    // ---- Share as PNG -> chip + download ----
    await realClick(".canvas-menu-btn");
    await clickMenuItem("Share as PNG");
    await waitFor(() => E(`!!document.querySelector('.undo-chip')`), 5000);
    const chip = await E(`document.querySelector('.undo-chip')?.textContent ?? null`);
    await shot("es-02-share-chip.png");
    if (chip !== SHARE_CHIP) throw new Error(`share chip mismatch: ${JSON.stringify(chip)}`);
    await sleep(400);

    // ---- Export image (.png) -> download ----
    await realClick(".canvas-menu-btn");
    await clickMenuItem("Export image (.png)");
    await sleep(600);
    await shot("es-03-export.png");

    const dl = downloads();
    const files = readdirSync(DL);
    console.log(`Stroke pixels : ${strokePixels}`);
    console.log(`Share chip    : ${JSON.stringify(chip)}`);
    console.log(`Downloads     : ${dl.join(", ") || "(none)"}`);
    console.log(`Files on disk : ${files.join(", ") || "(none)"}`);
    if (!dl.some((f) => f.startsWith("nekudot_"))) throw new Error("no Share (nekudot_*) download fired");
    if (!dl.some((f) => f.startsWith("art_"))) throw new Error("no Export (art_*) download fired");

    console.log(`\nScreenshots → ${OUT}/es-0*.png`);
    await send("Target.closeTarget", { targetId });
    return 0;
  } finally { try { ws?.close(); } catch {} browser.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("export-share-live failed:", e.message); process.exit(1); });

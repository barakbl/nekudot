// Drive the REAL app (root index.html -> /src/main.ts) in headless Chrome with
// REAL mouse events, exercising the More menu + theme submenu, screenshotting
// each step. This catches what a synthetic .click() harness misses (e.g. the
// document 'mousedown' close-on-outside listener).
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

    if (!(await waitFor(() => E(`!!document.querySelector('.canvas-menu-btn')`), 30000))) throw new Error("app/toolbar did not load");
    await sleep(300);
    await shot("live-00-initial.png");

    await realClick(".canvas-menu-btn");
    const open1 = await E(`!!document.querySelector('.canvas-menu-popover.open')`);
    const info1 = await E(`(() => {
      const pop = document.querySelector('.canvas-menu-popover');
      const head = pop && pop.querySelector('.canvas-menu-current');
      const sub = pop && pop.querySelector('.canvas-menu-sub');
      return {
        popoverOpen: !!(pop && pop.classList.contains('open')),
        hasCurrentRow: !!head,
        currentLabel: head && head.querySelector('.opt-label')?.textContent,
        subExists: !!sub,
        subVisible: sub ? getComputedStyle(sub).display !== 'none' : null,
      };
    })()`);
    await shot("live-01-more-open.png");
    console.log("After clicking More:", JSON.stringify(info1));

    await realClick(".canvas-menu-current");
    const info2 = await E(`(() => {
      const pop = document.querySelector('.canvas-menu-popover');
      const sub = pop && pop.querySelector('.canvas-menu-sub');
      return {
        popoverStillOpen: !!(pop && pop.classList.contains('open')),
        subVisible: sub ? getComputedStyle(sub).display !== 'none' : null,
        subOptions: sub ? [...sub.querySelectorAll('.opt-label')].map(e => e.textContent) : [],
      };
    })()`);
    await shot("live-02-theme-open.png");
    console.log("After clicking current-theme row:", JSON.stringify(info2));

    // click the theme option that isn't the current one
    const picked = await E(`(() => {
      const sub = document.querySelector('.canvas-menu-sub');
      const rows = sub ? [...sub.querySelectorAll('.brush-option')] : [];
      const target = rows.find(r => !r.classList.contains('active')) || rows[0];
      return target ? target.querySelector('.opt-label')?.textContent : null;
    })()`);
    if (picked) {
      await realClick(`.canvas-menu-sub .brush-option:not(.active)`);
      const info3 = await E(`(() => {
        const pop = document.querySelector('.canvas-menu-popover');
        const head = pop && pop.querySelector('.canvas-menu-current');
        const sub = pop && pop.querySelector('.canvas-menu-sub');
        return {
          docTheme: document.documentElement.dataset.theme || '(auto/none)',
          currentLabel: head && head.querySelector('.opt-label')?.textContent,
          subCollapsed: sub ? getComputedStyle(sub).display === 'none' : null,
          popoverStillOpen: !!(pop && pop.classList.contains('open')),
        };
      })()`);
      await shot("live-03-picked.png");
      console.log(`After picking "${picked}":`, JSON.stringify(info3));
    }

    console.log(`\nScreenshots → ${OUT}/live-0*.png`);
    await send("Target.closeTarget", { targetId });
    return 0;
  } finally { try { ws?.close(); } catch {} browser.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("theme-live failed:", e.message); process.exit(1); });

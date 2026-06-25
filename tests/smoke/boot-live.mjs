// Full-boot lifecycle smoke: drives the REAL app (root index.html -> /src/main.ts)
// through cold boot -> onboarding -> draw -> reload+restore -> undo -> settings
// persistence -> panels -> reset, asserting the boot still produces a working app
// at each step. A safety net for changes to the boot/init/wiring order (the area
// that bred bugs #1/#2). Manual (needs Chrome), like the other smokes.
//
//   node tests/smoke/boot-live.mjs
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4415, DBG = 9349;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "buildup-out");
const PAGE_URL = `http://localhost:${PORT}/`;
const findChrome = () => [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 15000, step = 150) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(step); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome found."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const browser = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,760", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ws;
  const checks = [];
  const ok = (name, pass, detail = "") => { checks.push({ name, pass, detail }); console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
  try {
    if (!(await waitFor(async () => (await fetch(`http://localhost:${PORT}/`)).ok, 30000))) throw new Error("vite did not start");
    let wsUrl;
    if (!(await waitFor(async () => { const r = await fetch(`http://localhost:${DBG}/json/version`).then((x) => x.json()).catch(() => null); wsUrl = r?.webSocketDebuggerUrl; return !!wsUrl; }, 30000))) throw new Error("devtools did not start");
    ws = await new Promise((res, rej) => { const w = new WebSocket(wsUrl); w.onopen = () => res(w); w.onerror = rej; });
    const send = cdp(ws);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S("Page.enable"); await S("Runtime.enable");
    await S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });
    await S("Page.navigate", { url: PAGE_URL });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    mkdirSync(OUT, { recursive: true });
    const shot = async (n) => { const s = await S("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, n), Buffer.from(s.data, "base64")); };
    const visible = (sel) => E(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});return !!e && getComputedStyle(e).display!=='none'})()`);
    const mouse = (type, x, y, buttons) => S("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: buttons ?? 0, clickCount: 1 });
    const clickSel = async (sel) => { const b = await E(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`); if (!b) throw new Error(`no element: ${sel}`); await mouse("mousePressed", b.x, b.y, 1); await mouse("mouseReleased", b.x, b.y, 0); await sleep(150); };
    const key = async (k, code) => { for (const type of ["keyDown", "keyUp"]) await S("Input.dispatchKeyEvent", { type, key: k, code }); await sleep(150); };
    const alpha = () => E(`(()=>{let best=0;for(const c of document.querySelectorAll('.stage canvas')){if(c.width<50)continue;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let s=0;for(let i=3;i<d.length;i+=4)s+=d[i];if(s>best)best=s}return best})()`);
    const drawStroke = async () => { const r = await E(`(()=>{const b=document.querySelector('.stage').getBoundingClientRect();return{l:b.left,t:b.top,w:b.width,h:b.height}})()`); const sx = r.l + r.w / 2 - 70, sy = r.t + r.h / 2 - 30; await mouse("mouseMoved", sx, sy, 0); await mouse("mousePressed", sx, sy, 1); for (let i = 1; i <= 10; i++) await mouse("mouseMoved", sx + i * 14, sy + i * 6, 1); await mouse("mouseReleased", sx + 140, sy + 60, 0); };
    const reload = async () => { await S("Page.reload"); await waitFor(() => E(`!!document.querySelector('.stage')`), 20000); await sleep(700); };

    // ---- A) cold boot -> onboarding -> blank canvas -------------------------
    if (!(await waitFor(() => E(`!!document.querySelector('.stage')`), 30000))) throw new Error("app did not boot");
    await sleep(500);
    ok("A1 cold boot shows the Start page (onboarding)", await visible(".onboarding"));
    await shot("boot-A-onboarding.png");
    // click the "Full screen" blank-start button
    const startBox = await E(`(()=>{const b=[...document.querySelectorAll('.onboarding-btn')].find(x=>x.textContent.trim()==='Full screen');if(!b)return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
    if (!startBox) throw new Error("no 'Full screen' start button");
    await mouse("mousePressed", startBox.x, startBox.y, 1); await mouse("mouseReleased", startBox.x, startBox.y, 0); await sleep(500);
    ok("A2 picking a start gives a canvas + dismisses onboarding", !(await visible(".onboarding")) && !!(await E(`!!document.querySelector('.stage canvas')`)));
    await sleep(600); // let bootRestored settle (input gate, bug #1)

    // ---- B) draw -> reload -> paint restored -------------------------------
    await drawStroke();
    await sleep(900); // let the stroke's async capture + IDB write commit
    const drawn = await alpha();
    ok("B1 a stroke paints pixels", drawn > 0, `alpha ${drawn}`);
    await reload();
    const restored = await alpha();
    ok("B2 paint is restored after reload", restored > 0 && Math.abs(restored - drawn) / drawn < 0.05, `${drawn} -> ${restored}`);
    ok("B3 onboarding stays dismissed after reload", !(await visible(".onboarding")));
    await shot("boot-B-restored.png");

    // ---- C) undo after reload (history restored too) -----------------------
    await clickSel('button[title="Undo"]');
    await sleep(500);
    const undone = await alpha();
    ok("C1 undo after reload removes the restored stroke", undone < restored, `${restored} -> ${undone}`);

    // ---- D) settings persistence (theme) across reload ---------------------
    await key(",", "Comma"); // open App settings
    await waitFor(() => visible(".app-settings-box"), 5000);
    const pickedTheme = await E(`document.querySelector('.appset-seg-btn:not(.active)')?.textContent ?? null`);
    await clickSel(".appset-seg-btn:not(.active)");
    await sleep(200);
    const themeSet = await E(`document.documentElement.dataset.theme || ''`);
    await reload();
    const themeAfter = await E(`document.documentElement.dataset.theme || ''`);
    ok("D1 a theme change persists across reload", themeSet !== "" && themeAfter === themeSet, `picked ${pickedTheme} -> ${themeAfter}`);

    // ---- F) every panel opens + renders (shortcut -> panel) ----------------
    const panels = [["b", "KeyB", ".settings-panel"], ["l", "KeyL", ".layers-box"], ["m", "KeyM", ".maps-box"], ["y", "KeyY", ".symmetry-box"], [",", "Comma", ".app-settings-box"], ["/", "Slash", ".shortcuts-panel"]];
    const opened = [];
    for (const [k, code, sel] of panels) {
      await key(k, code);
      if (await waitFor(() => visible(sel), 2500)) opened.push(sel);
    }
    ok("F1 all panels open from their shortcut", opened.length === panels.length, `${opened.length}/${panels.length}: ${opened.join(" ")}`);
    await shot("boot-F-panels.png");

    // ---- E) reset to default -> reload -> fresh (onboarding) ----------------
    await key(",", "Comma"); // raise App settings above the panels opened in F (window-stack)
    await waitFor(() => visible(".app-settings-box"), 3000);
    await clickSel(".appset-reset-btn");
    await waitFor(() => E(`!!document.querySelector('.confirm-input')`), 4000);
    await E(`(()=>{const i=document.querySelector('.confirm-input');i.value='yes';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await sleep(150);
    await clickSel(".confirm-btn-destructive");
    await waitFor(() => visible(".onboarding"), 15000);
    ok("E1 reset to default wipes everything -> Start page returns", await visible(".onboarding"));
    await shot("boot-E-reset.png");

    const passed = checks.filter((c) => c.pass).length;
    console.log(`\n${passed === checks.length ? "✓ PASS" : "✗ FAIL"} — ${passed}/${checks.length} boot-lifecycle checks`);
    await send("Target.closeTarget", { targetId });
    return passed === checks.length ? 0 : 1;
  } finally { try { ws?.close(); } catch {} browser.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("boot-live failed:", e.message); process.exit(1); });

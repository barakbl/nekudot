// Live smoke (manual, needs Chrome) for M5: the Start page is an accessible modal.
// Checks the dialog semantics, the Theme radiogroup (roles, aria-checked, roving
// tabindex, arrow-key nav, non-colour selected cue) and the "canvas ready" live
// region on handoff.
//   node tests/smoke/onboarding-a11y-live.mjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4424, DBG = 9354;
const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = `http://localhost:${PORT}/`;
const findChrome = () => ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, s = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(s); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }
const key = (S, k, code, vk) => Promise.resolve().then(async () => { await S("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk }); await S("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); });

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.log("• No Chrome - skipping."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const br = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,820", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ws;
  const fails = [];
  const check = (n, c, d) => { console.log(`   ${c ? "✓" : "✗"} ${n}${d ? "  " + d : ""}`); if (!c) fails.push(n); };
  try {
    await waitFor(async () => (await fetch(PAGE)).ok);
    let u; await waitFor(async () => { const r = await fetch(`http://localhost:${DBG}/json/version`).then((x) => x.json()).catch(() => null); u = r?.webSocketDebuggerUrl; return !!u; });
    ws = await new Promise((res, rej) => { const w = new WebSocket(u); w.onopen = () => res(w); w.onerror = rej; });
    const send = cdp(ws);
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const S = (m, p) => send(m, p, sessionId);
    await S("Page.enable"); await S("Runtime.enable");
    await S("Emulation.setDeviceMetricsOverride", { width: 1100, height: 820, deviceScaleFactor: 1, mobile: false });
    const E = async (e) => { const r = await S("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

    // fresh load (first run auto-opens the mandala) then open the Start page via G.
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await E("localStorage.clear(); indexedDB.databases && indexedDB.databases().then(ds=>ds.forEach(d=>indexedDB.deleteDatabase(d.name)))");
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await sleep(400);
    await key(S, "g", "KeyG", 71);
    await waitFor(() => E("!!document.querySelector('.confirm-card')"));
    await E(`[...document.querySelectorAll('.confirm-card button')].find(b=>b.textContent.trim()==='Start page')?.click()`);
    await waitFor(() => E("getComputedStyle(document.querySelector('.onboarding')).display !== 'none'"));
    await sleep(200);

    console.log("\n■ Dialog semantics");
    check("card role=dialog + aria-modal + aria-labelledby", await E(`(()=>{const c=document.querySelector('.onboarding-card'); return c.getAttribute('role')==='dialog' && c.getAttribute('aria-modal')==='true' && !!c.getAttribute('aria-labelledby') && !!document.getElementById(c.getAttribute('aria-labelledby'));})()`));

    console.log("\n■ Theme radiogroup");
    check("seg has role=radiogroup + label", await E(`(()=>{const s=document.querySelector('.onboarding-seg'); return s.getAttribute('role')==='radiogroup' && !!s.getAttribute('aria-labelledby');})()`));
    check("each option is role=radio with aria-checked", await E(`[...document.querySelectorAll('.onboarding-seg-btn')].every(b=>b.getAttribute('role')==='radio' && b.hasAttribute('aria-checked'))`));
    check("exactly one is checked", (await E(`document.querySelectorAll('.onboarding-seg-btn[aria-checked="true"]').length`)) === 1);
    check("roving tabindex (checked=0, others=-1)", await E(`(()=>{const bs=[...document.querySelectorAll('.onboarding-seg-btn')]; return bs.every(b=> (b.getAttribute('aria-checked')==='true') === (b.tabIndex===0));})()`));
    check("selected has a non-colour cue (ring + bold)", await E(`(()=>{const b=document.querySelector('.onboarding-seg-btn[aria-checked="true"]'); const cs=getComputedStyle(b); return cs.boxShadow!=='none' && parseInt(cs.fontWeight,10) >= 600;})()`));

    // Arrow-key nav: focus the checked radio, press ArrowRight -> next selected.
    const beforeLabel = await E(`document.querySelector('.onboarding-seg-btn[aria-checked="true"]').textContent`);
    await E(`document.querySelector('.onboarding-seg-btn[aria-checked="true"]').focus()`);
    await key(S, "ArrowRight", "ArrowRight", 39);
    await sleep(150);
    const afterLabel = await E(`document.querySelector('.onboarding-seg-btn[aria-checked="true"]').textContent`);
    check("ArrowRight moves the selection", afterLabel !== beforeLabel, `${beforeLabel} -> ${afterLabel}`);
    check("focus follows the selection", await E(`document.activeElement === document.querySelector('.onboarding-seg-btn[aria-checked="true"]')`));
    check("selecting applies the theme", await E(`(()=>{const t=document.querySelector('.onboarding-seg-btn[aria-checked="true"]').textContent.toLowerCase().trim(); return t==='auto' ? !document.documentElement.dataset.theme : document.documentElement.dataset.theme===t;})()`));

    console.log("\n■ Background inert (modal open)");
    check("canvas/stage is inert + aria-hidden", await E(`(()=>{const s=document.querySelector('.stage'); return !!s.inert && s.getAttribute('aria-hidden')==='true';})()`));
    check("toolbar is inert", await E(`!!document.querySelector('.toolbar')?.inert`));
    check("the dialog itself is not inert", await E(`document.querySelector('.onboarding').inert !== true`));

    console.log("\n■ Canvas-ready announcement");
    check("a polite live region exists", await E(`!!document.querySelector('[aria-live="polite"].sr-only')`));
    check("empty while the modal is open", (await E(`document.querySelector('[aria-live="polite"].sr-only').textContent`)) === "");
    // dismiss with X -> handoff
    await E(`document.querySelector('.onboarding-close').click()`);
    await sleep(200);
    check('announces "Canvas ready" on handoff', (await E(`document.querySelector('[aria-live="polite"].sr-only').textContent`)) === "Canvas ready");
    check("inert cleared after dismiss", await E(`!document.querySelector('.stage')?.inert && !document.querySelector('.toolbar')?.inert`));

    await send("Target.closeTarget", { targetId });
    if (fails.length) { console.log(`\n✗ ${fails.length} check(s) failed: ${fails.join(", ")}`); return 1; }
    console.log("\n✓ all checks passed");
    return 0;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("onboarding-a11y-live failed:", e.message); process.exit(1); });

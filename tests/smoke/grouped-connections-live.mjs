// Real app: the Connecting combo shows groups (Classic/More); saving the current
// preset adds a Custom group (shown first) persisted to IndexedDB; it survives a
// reload; and the × deletes it. window.prompt is stubbed to supply the name.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4416, DBG = 9350;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "buildup-out");
const PAGE = `http://localhost:${PORT}/`;
const findChrome = () => ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, s = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(s); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const br = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,720", "--no-first-run", "about:blank"], { stdio: "ignore" });
  let ws;
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
    const load = async () => { await S("Page.navigate", { url: PAGE }); await waitFor(() => E(`!!document.querySelector('.connect-pill')`)); await sleep(400); };

    // fresh start: clear localStorage + the presets IndexedDB
    await load();
    await E(`localStorage.clear(); indexedDB.deleteDatabase('nekudot-connections');`);
    await load();
    mkdirSync(OUT, { recursive: true });

    // 1) combo groups before saving (open the popover)
    await E(`document.querySelector('.connect-pill').click()`);
    await sleep(150);
    const before = await E(`[...document.querySelectorAll('.connect-pill .brush-group-header')].map(h=>h.textContent.replace(/\\s+/g,' ').trim())`);
    await S("Page.captureScreenshot", { format: "png" }).then((s) => writeFileSync(join(OUT, "groups-before.png"), Buffer.from(s.data, "base64")));
    await E(`document.body.click()`); await sleep(80);
    console.log(`Groups before save: [${before.join(", ")}]  (expect Custom first, then Classic, More)`);

    // 2) save current preset via the Connecting panel + the name modal
    // open connecting panel ('c') so the Save button is visible, then click it
    for (const type of ["keyDown", "keyUp"]) await S("Input.dispatchKeyEvent", { type, key: "c", code: "KeyC", windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67 });
    await sleep(150);
    const hasSaveBtn = await E(`!!document.querySelector('.settings-save-preset')`);
    await E(`document.querySelector('.settings-save-preset').click()`);
    await sleep(150);
    const hasModal = await E(`!!document.querySelector('.confirm-modal .confirm-input')`);
    await S("Page.captureScreenshot", { format: "png" }).then((s) => writeFileSync(join(OUT, "save-preset-modal.png"), Buffer.from(s.data, "base64")));
    console.log(`Name modal shown: ${hasModal ? "✓" : "✗"}`);
    // type a name + confirm
    await E(`(() => { const i = document.querySelector('.confirm-input'); i.value = 'My Preset'; document.querySelector('.confirm-modal .confirm-btn-primary').click(); })()`);
    await sleep(400); // allow IndexedDB write

    // 3) combo groups after saving
    await E(`document.querySelector('.connect-pill').click()`);
    await sleep(150);
    const after = await E(`[...document.querySelectorAll('.connect-pill .brush-group-header')].map(h=>h.textContent)`);
    const customItems = await E(`[...document.querySelectorAll('.connect-pill .brush-popover .brush-option .opt-label')].slice(0,3).map(e=>e.textContent)`);
    const hasDelete = await E(`!!document.querySelector('.connect-pill .opt-remove')`);
    await S("Page.captureScreenshot", { format: "png" }).then((s) => writeFileSync(join(OUT, "groups-after-save.png"), Buffer.from(s.data, "base64")));
    await E(`document.body.click()`); await sleep(80);
    console.log(`Save button present: ${hasSaveBtn ? "✓" : "✗"}`);
    console.log(`Groups after save:  [${after.join(", ")}]  (expect Custom first)`);
    console.log(`First combo items:  [${customItems.join(", ")}]  delete(×) present: ${hasDelete ? "✓" : "✗"}`);

    // 4) persistence across reload (IndexedDB)
    await load();
    await E(`document.querySelector('.connect-pill').click()`); await sleep(150);
    const afterReload = await E(`[...document.querySelectorAll('.connect-pill .brush-group-header')].map(h=>h.textContent)`);
    const reloadHasPreset = await E(`[...document.querySelectorAll('.connect-pill .opt-label')].some(e=>e.textContent==='My Preset')`);
    console.log(`After reload groups:[${afterReload.join(", ")}]  "My Preset" present: ${reloadHasPreset ? "✓" : "✗"}`);

    // 5) delete via ×
    await E(`document.querySelector('.connect-pill .opt-remove').click()`);
    await sleep(400);
    await E(`document.querySelector('.connect-pill').click()`); await sleep(150);
    const afterDeleteHasPreset = await E(`[...document.querySelectorAll('.connect-pill .opt-label')].some(e=>e.textContent==='My Preset')`);
    console.log(`After delete: "My Preset" present: ${afterDeleteHasPreset ? "✗ still there" : "✓ gone"} (Custom group stays, now empty)`);

    const ok =
      before[0] === "Custom" && before.includes("Classic") && before.includes("More") &&
      hasSaveBtn && hasModal && after[0] === "Custom" && customItems.includes("My Preset") && hasDelete &&
      reloadHasPreset && !afterDeleteHasPreset;
    console.log(ok ? "\n✓ PASS — grouped combo, save→Custom-first, persist, delete all work" : "\n✗ FAIL");
    await send("Target.closeTarget", { targetId });
    return ok ? 0 : 1;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("grouped-connections-live failed:", e.message); process.exit(1); });

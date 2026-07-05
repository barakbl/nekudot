// Real app: with a built-in style active, the Connecting box shows one
// "Save as preset…". With a custom preset active it shows two buttons —
// "Update «name»" (overwrites in place) and "Save as new…" (pre-filled "name copy").
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4422, DBG = 9356;
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
    mkdirSync(OUT, { recursive: true });

    await load();
    await E(`localStorage.clear(); indexedDB.deleteDatabase('nekudot-connections');`);
    await load();

    const ensurePanel = async () => {
      const vis = await E(`(()=>{const p=document.querySelector('.connecting-panel');return !!p&&getComputedStyle(p).display!=='none';})()`);
      if (!vis) await E(`document.querySelector('.connect-pill .brush-gear').click()`);
      await sleep(150);
    };
    const saveButtons = () => E(`[...document.querySelectorAll('.connecting-panel .settings-save-preset')].map(b=>b.textContent.trim())`);
    const clickSaveBtn = (match) => E(`{ const b=[...document.querySelectorAll('.connecting-panel .settings-save-preset')].find(x=>x.textContent.includes(${JSON.stringify(match)})); b&&b.click(); }`);
    const customItems = () => E(`(()=>{ const h=[...document.querySelectorAll('.connect-pill .brush-popover .brush-group-header')].find(x=>x.textContent.trim().startsWith('Custom')); const out=[]; let n=h?.nextElementSibling; while(n&&n.classList.contains('brush-option')){ out.push(n.querySelector('.opt-label')?.textContent); n=n.nextElementSibling;} return out; })()`);
    const openCombo = () => E(`document.querySelector('.connect-pill .brush-popover').classList.add('open')`);
    const closeCombo = () => E(`document.querySelector('.connect-pill .brush-popover').classList.remove('open')`);

    // 1) built-in (Sketchy) → single save button
    await ensurePanel();
    const builtinBtns = await saveButtons();
    console.log(`Built-in active — save buttons: [${builtinBtns.join(" | ")}]  (expect one "Save as preset")`);

    // 2) save P1 (prompt)
    await clickSaveBtn("Save as preset"); await sleep(150);
    await E(`(()=>{ const i=document.querySelector('.confirm-input'); i.value='P1'; document.querySelector('.confirm-modal .confirm-btn-primary').click(); })()`);
    await sleep(300);
    await ensurePanel();
    const customBtns = await saveButtons();
    console.log(`Custom active — save buttons: [${customBtns.join(" | ")}]  (expect "Update …" + "Save as new…")`);
    await S("Page.captureScreenshot", { format: "png" }).then((s) => writeFileSync(join(OUT, "update-vs-new.png"), Buffer.from(s.data, "base64")));

    // 3) change Density → Update «P1» → overwrites in place (count stays 1)
    const setDensity = await E(`(()=>{ const row=[...document.querySelectorAll('.connecting-panel .settings-row')].find(r=>r.querySelector('label')?.textContent.trim()==='Density'); const inp=row?.querySelector('input[type=range]'); if(!inp) return null; inp.value='80'; inp.dispatchEvent(new Event('input',{bubbles:true})); return inp.value; })()`);
    await E(`window.__blobText=null; const _c=URL.createObjectURL; URL.createObjectURL=(b)=>{ b.text().then(t=>window.__blobText=t); return _c(b); };`);
    await clickSaveBtn("Update"); await sleep(300);
    await openCombo(); await sleep(120);
    const afterUpdate = await customItems();
    await closeCombo();
    console.log(`Density set to ${setDensity}; after Update — Custom items: [${afterUpdate.join(", ")}]  (expect just P1)`);

    // export P1 to confirm the updated density was saved in place
    await openCombo(); await sleep(120);
    await E(`{ const b=[...document.querySelectorAll('.connect-pill .group-action')][1]; b&&b.click(); }`);
    await sleep(200);
    await E(`document.querySelector('.confirm-modal .confirm-btn-primary')?.click()`);
    await waitFor(() => E(`window.__blobText!==null`), 4000);
    let parsed = null; try { parsed = JSON.parse(await E(`window.__blobText`)); } catch {}
    const p1 = parsed?.presets?.find((p) => p.name === "P1");
    const updatedOk = !!p1 && p1.defaults?.density === 80;
    console.log(`Exported P1.density === 80 (update persisted dials): ${updatedOk ? "✓" : "✗"}`);

    // 4) Save as new → pre-filled "P1 copy" → creates a 2nd preset
    await ensurePanel();
    await clickSaveBtn("Save as new"); await sleep(150);
    const prefill = await E(`document.querySelector('.confirm-input')?.value`);
    await E(`document.querySelector('.confirm-modal .confirm-btn-primary').click()`);
    await sleep(300);
    await openCombo(); await sleep(120);
    const finalItems = await customItems();
    await closeCombo();
    console.log(`Save as new — name field pre-filled: "${prefill}" (expect "P1 copy"); Custom now: [${finalItems.join(", ")}]`);

    const ok =
      builtinBtns.length === 1 && /Save as preset/.test(builtinBtns[0]) &&
      customBtns.length === 2 && customBtns.some((b) => b.startsWith("Update")) && customBtns.some((b) => /Save as new/.test(b)) &&
      afterUpdate.length === 1 && afterUpdate[0] === "P1" && updatedOk &&
      prefill === "P1 copy" && finalItems.includes("P1") && finalItems.includes("P1 copy");
    console.log(`\n✓ screenshot → ${join(OUT, "update-vs-new.png")}`);
    console.log(ok ? "✓ PASS — single button on built-in; Update/Save-as-new on custom; update in place; pre-fill" : "✗ FAIL");
    await send("Target.closeTarget", { targetId });
    return ok ? 0 : 1;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("update-preset-live failed:", e.message); process.exit(1); });

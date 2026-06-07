// Real app: the navbar Maps quick-access icon. Its popover has actions (New map,
// Flash Active map, Open editor) then a list of every map with a live dot count
// (active bold, each row a flash icon, names editable inline). Verifies: default
// name is "map-1"; drawing raises the active map's dots; "New map" creates an
// active map (popover stays open); per-map flash lights the overlay; clicking a
// name renames it inline.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4426, DBG = 9360;
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
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await E("localStorage.clear()");
    await S("Page.navigate", { url: PAGE });
    await waitFor(() => E("!!document.querySelector('.stage canvas')"));
    await sleep(400);
    mkdirSync(OUT, { recursive: true });

    const openMenu = () => E(`document.querySelector('.toolbar button[title="Memory maps"]').click()`);
    const popoverOpen = () => E(`(() => { const p=document.querySelector('.maps-menu-popover'); return !!p && p.classList.contains('open'); })()`);
    const readCount = () => E(`document.querySelector('.maps-menu-count')?.textContent||''`);
    const readRows = () => E(`[...document.querySelectorAll('.maps-menu-row')].map(r=>({ name:r.querySelector('.maps-menu-name')?.textContent||'', dots:(()=>{const n=parseInt(r.querySelector('.maps-menu-dots')?.textContent||'',10);return isNaN(n)?-1:n;})(), active:r.classList.contains('active'), tag:!!r.querySelector('.maps-menu-tag'), select:!!r.querySelector('.maps-menu-select'), del:!!r.querySelector('.maps-menu-delete') })) `);
    const clickSelect = (name) => E(`(() => { const r=[...document.querySelectorAll('.maps-menu-row')].find(x=>x.querySelector('.maps-menu-name')?.textContent===${JSON.stringify(name)}); const b=r&&r.querySelector('.maps-menu-select'); if(!b) return false; b.click(); return true; })()`);
    const clickDelete = (name) => E(`(() => { const r=[...document.querySelectorAll('.maps-menu-row')].find(x=>x.querySelector('.maps-menu-name')?.textContent===${JSON.stringify(name)}); const b=r&&r.querySelector('.maps-menu-delete'); if(!b) return false; b.click(); return true; })()`);
    const clickRow = (label) => E(`(() => { const r=[...document.querySelectorAll('.maps-menu-popover .brush-option')].find(x=>x.querySelector('.opt-label')?.textContent===${JSON.stringify(label)}); if(!r) return false; r.click(); return true; })()`);
    const flashIconCount = () => E(`document.querySelectorAll('.maps-menu-row .maps-menu-flash').length`);
    const clickMapFlash = (name) => E(`(() => { const r=[...document.querySelectorAll('.maps-menu-row')].find(x=>x.querySelector('.maps-menu-name')?.textContent===${JSON.stringify(name)}); const b=r&&r.querySelector('.maps-menu-flash'); if(!b) return false; b.click(); return true; })()`);
    const overlayLit = () => E(`(() => { const cs=[...document.querySelectorAll('.stage canvas')]; const ov=cs.reduce((a,b)=>(+getComputedStyle(b).zIndex||0)>(+getComputedStyle(a).zIndex||0)?b:a); const d=ov.getContext('2d').getImageData(0,0,ov.width,ov.height).data; let lit=0; for(let i=3;i<d.length;i+=4) if(d[i]>0) lit++; return lit; })()`);
    const renameMap = (oldName, newName) => E(`(() => {
      const r=[...document.querySelectorAll('.maps-menu-row')].find(x=>x.querySelector('.maps-menu-name')?.textContent===${JSON.stringify(oldName)});
      if(!r) return 'no-row';
      r.querySelector('.maps-menu-name').click();
      const inp=r.querySelector('.maps-menu-name-input');
      if(!inp) return 'no-input';
      inp.value=${JSON.stringify(newName)};
      inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      return 'ok';
    })()`);

    // 1) icon present; default map is "map-1"
    const hasBtn = await E(`!!document.querySelector('.toolbar button[title="Memory maps"]')`);
    await openMenu(); await sleep(120);
    const open1 = await popoverOpen();
    const rows1 = await readRows();
    console.log(`Icon: ${hasBtn ? "✓" : "✗"}  Popover open: ${open1 ? "✓" : "✗"}`);
    console.log(`Initial -> ${JSON.stringify(rows1)}`);

    // 2) draw a stroke into the active first map
    await openMenu(); await sleep(80);
    const pts = []; for (let x = 200; x <= 900; x += 6) pts.push([x, 380 + 90 * Math.sin((x - 200) / 80)]);
    await S("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", clickCount: 1, buttons: 1 });
    for (let i = 1; i < pts.length; i++) await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: pts[i][0], y: pts[i][1], button: "left", buttons: 1 });
    await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: pts.at(-1)[0], y: pts.at(-1)[1], button: "left", clickCount: 1, buttons: 1 });
    await sleep(200);
    await openMenu(); await sleep(120);
    const rows2 = await readRows();
    const active2 = rows2.find((r) => r.active);
    console.log(`After draw -> ${JSON.stringify(rows2)}`);

    // 3) Flash Active map (top action)
    const flashClicked = await clickRow("Flash Active map on canvas");
    await sleep(120);
    const litActive = await overlayLit();
    console.log(`Flash Active: ${flashClicked ? "✓" : "✗"}  lit:${litActive}`);

    // 4) New map (navbar action) -> creates an active map, popover stays open
    await openMenu(); await sleep(100);
    const newClicked = await clickRow("New map");
    await sleep(100);
    const afterNewOpen = await popoverOpen();
    const rows3 = await readRows();
    console.log(`New map: ${newClicked ? "✓" : "✗"}  popover stays open:${afterNewOpen ? "✓" : "✗"}  -> ${JSON.stringify(rows3)}`);

    // 5) per-map flash icons; flashing a row flashes that map AND closes the popover
    const icons = await flashIconCount();
    const perMapFlashed = await clickMapFlash("map-1");
    await sleep(120);
    const litPerMap = await overlayLit();
    const closedAfterFlash = !(await popoverOpen());
    console.log(`Flash icons:${icons}  flashed map-1:${perMapFlashed ? "✓" : "✗"}  lit:${litPerMap}  popover closed:${closedAfterFlash ? "✓" : "✗"}`);

    // 6) inline rename: reopen, click map-2's name, type "Faces", Enter
    await openMenu(); await sleep(100);
    const renamed = await renameMap("map-2", "Faces");
    await sleep(80);
    const rows4 = await readRows();
    console.log(`Rename map-2 -> Faces: ${renamed}  -> ${JSON.stringify(rows4)}`);

    // 7) Select map-1 -> becomes active, popover closes, chip + flash give
    //    feedback. Reopen to confirm the roles swapped.
    const selClicked = await clickSelect("map-1");
    await sleep(120);
    const selClosed = !(await popoverOpen());
    const chipText = await E(`document.querySelector('.undo-chip')?.textContent || ''`);
    const selLit = await overlayLit();
    console.log(`Select map-1: ${selClicked ? "✓" : "✗"}  popover closed:${selClosed ? "✓" : "✗"}  chip:"${chipText}"  flash lit:${selLit}`);
    await openMenu(); await sleep(120);
    const rows5 = await readRows();
    await S("Page.captureScreenshot", { format: "png" }).then((s) => writeFileSync(join(OUT, "maps-menu.png"), Buffer.from(s.data, "base64")));
    console.log(`After select -> ${JSON.stringify(rows5)}`);

    // 8) the standalone Neighbors-map box is gone; verify no such element exists.
    const noBox = await E(`!document.querySelector('.neighbors-map-box')`);
    // and the 'm' shortcut now toggles this maps popover (open after step 7).
    const pressM = async () => { for (const t of ["keyDown", "keyUp"]) await S("Input.dispatchKeyEvent", { type: t, key: "m", code: "KeyM", windowsVirtualKeyCode: 77, nativeVirtualKeyCode: 77 }); };
    await pressM(); await sleep(80);
    const closedByKey = !(await popoverOpen());
    await pressM(); await sleep(80);
    const openedByKey = await popoverOpen();
    console.log(`No box element: ${noBox ? "✓" : "✗"}  'm' toggles popover -> closed:${closedByKey ? "✓" : "✗"} reopened:${openedByKey ? "✓" : "✗"}`);

    // 9) delete a map via the list -> confirm modal -> removed. With 2 maps each
    //    row has a delete button; deleting Faces leaves only map-1 (no delete on
    //    the sole remaining map). Popover is open from step 8's 'm' reopen.
    const delBtnsAt2 = rows5.length === 2 && rows5.every((r) => r.del);
    const delClicked = await clickDelete("Faces");
    await sleep(120);
    const modalShown = await E(`!!document.querySelector('.confirm-modal')`);
    // destructive confirm uses .confirm-btn-destructive (primary is for non-destructive)
    await E(`document.querySelector('.confirm-modal .confirm-btn-destructive')?.click()`);
    await sleep(220);
    await openMenu(); await sleep(120);
    const rowsFinal = await readRows();
    console.log(`Delete btns @2:${delBtnsAt2 ? "✓" : "✗"}  delete Faces:${delClicked ? "✓" : "✗"} modal:${modalShown ? "✓" : "✗"} -> ${JSON.stringify(rowsFinal)}`);

    const facesRow4 = rows4.find((r) => r.name === "Faces");
    const map1Row4 = rows4.find((r) => r.name === "map-1");
    const map1Row5 = rows5.find((r) => r.name === "map-1");
    const facesRow5 = rows5.find((r) => r.name === "Faces");
    const ok =
      hasBtn && open1 &&
      rows1.length === 1 && rows1[0].name === "map-1" && rows1[0].active && rows1[0].dots === 0 &&
      active2 && active2.name === "map-1" && active2.dots > 0 &&
      flashClicked && litActive > 0 &&
      newClicked && afterNewOpen && rows3.length === 2 &&
      rows3.some((r) => r.name === "map-2" && r.active && r.dots === 0) &&
      rows3.some((r) => r.name === "map-1" && !r.active && r.dots > 0) &&
      icons === 2 && perMapFlashed && litPerMap > 0 && closedAfterFlash &&
      renamed === "ok" &&
      // after rename: Faces active (tag, no Select); map-1 inactive (Select, no tag)
      !!facesRow4 && facesRow4.active && facesRow4.tag && !facesRow4.select &&
      !!map1Row4 && !map1Row4.active && map1Row4.select && !map1Row4.tag &&
      // Select map-1: closes the popover, chips "Selected ...", flashes the map,
      // and the roles swap (map-1 active, Faces selectable).
      selClicked && selClosed && chipText.includes("map-1") && selLit > 0 &&
      !!map1Row5 && map1Row5.active && map1Row5.tag &&
      !!facesRow5 && !facesRow5.active && facesRow5.select &&
      // box removed; 'm' toggles the popover
      noBox && closedByKey && openedByKey &&
      // delete via confirm modal: Faces removed, only map-1 left (no delete btn)
      delBtnsAt2 && delClicked && modalShown &&
      rowsFinal.length === 1 && rowsFinal[0].name === "map-1" && !rowsFinal[0].del;
    console.log(`\n✓ screenshot → ${join(OUT, "maps-menu.png")}`);
    console.log(ok ? "✓ PASS — map-N naming; New map; per-map flash; rename; select; delete (confirm); no box; 'm' toggles menu" : "✗ FAIL");
    await send("Target.closeTarget", { targetId });
    return ok ? 0 : 1;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("maps-menu-live failed:", e.message); process.exit(1); });

// Live smoke for G1 (contrast-safe canvas defaults / kill the hostile blank).
// Boots the REAL app fresh, then for two paths - picking "Blank" and dismissing
// the Start page with X - drives a REAL pointer stroke on the revealed canvas and
// checks the first stroke is clearly visible: the canvas is the neutral dark
// (#14151a, NOT white, NOT the mandala #0d0e12) and the stroke deposits LIGHT ink
// on it. Also confirms X never forces a rainbow mandala.
//
//   node tests/smoke/contrast-blank-live.mjs
//
// Needs Chrome; manual (not in CI), like the other live smokes.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4421, DBG = 9351;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "buildup-out");
const PAGE = `http://localhost:${PORT}/`;
const findChrome = () => ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, s = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(s); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

const NEUTRAL = "rgb(20, 21, 26)"; // #14151a
const MANDALA = "rgb(13, 14, 18)"; // #0d0e12

// A curved drag near the canvas centre - enough travel to deposit a web.
function strokePath(cx, cy) {
  const pts = [];
  for (let t = 0; t <= 1.0001; t += 0.04) {
    pts.push([Math.round(cx - 150 + t * 300), Math.round(cy - 60 + Math.sin(t * Math.PI) * 120)]);
  }
  return pts;
}

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.log("• No Chrome - skipping."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const br = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=1100,720", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  let ws;
  const fails = [];
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

    // Read stage bg + count deposited pixels (and how many are LIGHT) across the
    // layer canvases. Painted alpha proves the stroke landed; light luminance on a
    // dark canvas proves it is visible.
    const measure = `(() => {
      const stage = document.querySelector('.stage');
      const bg = getComputedStyle(stage).backgroundColor;
      let painted = 0, light = 0, sample = null;
      for (const cv of document.querySelectorAll('.stage canvas')) {
        const ctx = cv.getContext('2d'); if (!ctx) continue;
        const d = ctx.getImageData(0,0,cv.width,cv.height).data;
        for (let i=0;i<d.length;i+=4){ if (d[i+3] > 12){ painted++; const l=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; if (l>140){ light++; if(!sample) sample=[d[i],d[i+1],d[i+2]]; } } }
      }
      return { bg, painted, light, sample };
    })()`;

    async function drawStroke() {
      const pts = strokePath(550, 380);
      await S("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", clickCount: 1, buttons: 1 });
      for (let i = 1; i < pts.length; i++) await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: pts[i][0], y: pts[i][1], button: "left", buttons: 1 });
      await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: pts.at(-1)[0], y: pts.at(-1)[1], button: "left", clickCount: 1, buttons: 1 });
      await sleep(200);
    }

    async function freshLoad() {
      await S("Page.navigate", { url: PAGE });
      await waitFor(() => E("!!document.querySelector('.stage canvas')"));
      await E("localStorage.clear(); indexedDB.databases && indexedDB.databases().then(ds=>ds.forEach(d=>indexedDB.deleteDatabase(d.name)))");
      await S("Page.navigate", { url: PAGE });
      await waitFor(() => E("!!document.querySelector('.onboarding') && document.querySelector('.onboarding').style.display !== 'none'"));
      await sleep(300);
    }

    function check(name, cond, detail) { console.log(`   ${cond ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`); if (!cond) fails.push(name); }

    mkdirSync(OUT, { recursive: true });

    // ---- Path 1: pick "Blank" (Full screen) ---------------------------------
    console.log("\n■ Blank → first stroke");
    await freshLoad();
    await E(`[...document.querySelectorAll('.onboarding-btn')].find(b=>b.textContent.trim()==='Full screen')?.click()`);
    await waitFor(() => E("document.querySelector('.onboarding').style.display === 'none'"));
    await sleep(200);
    const before1 = await E(measure);
    await drawStroke();
    const after1 = await E(measure);
    check("canvas is neutral dark (not white)", after1.bg === NEUTRAL, after1.bg);
    check("canvas is NOT the mandala shade", after1.bg !== MANDALA, after1.bg);
    check("canvas empty before the stroke", before1.painted === 0, `painted=${before1.painted}`);
    check("first stroke deposited ink", after1.painted > 200, `painted=${after1.painted}`);
    check("stroke ink is LIGHT (visible on dark)", after1.light > 100, `light=${after1.light} sample=${JSON.stringify(after1.sample)}`);
    let shot = await S("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, "contrast-blank.png"), Buffer.from(shot.data, "base64"));

    // ---- Path 2: dismiss with X --------------------------------------------
    console.log("\n■ Dismiss (X) → first stroke");
    await freshLoad();
    await E(`document.querySelector('.onboarding-close')?.click()`);
    await waitFor(() => E("document.querySelector('.onboarding').style.display === 'none'"));
    await sleep(200);
    const before2 = await E(measure);
    await drawStroke();
    const after2 = await E(measure);
    check("dismiss reveals neutral dark canvas", after2.bg === NEUTRAL, after2.bg);
    check("X did NOT force a mandala", after2.bg !== MANDALA, after2.bg);
    check("canvas empty before the stroke", before2.painted === 0, `painted=${before2.painted}`);
    check("first stroke deposited ink", after2.painted > 200, `painted=${after2.painted}`);
    check("stroke ink is LIGHT (visible on dark)", after2.light > 100, `light=${after2.light} sample=${JSON.stringify(after2.sample)}`);
    shot = await S("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, "contrast-dismiss.png"), Buffer.from(shot.data, "base64"));

    console.log(`\n✓ screenshots → ${OUT}/contrast-blank.png, contrast-dismiss.png`);
    await send("Target.closeTarget", { targetId });
    if (fails.length) { console.log(`\n✗ ${fails.length} check(s) failed: ${fails.join(", ")}`); return 1; }
    console.log("\n✓ all contrast checks passed");
    return 0;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("contrast-blank-live failed:", e.message); process.exit(1); });

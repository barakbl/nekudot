// Live smoke for the first-run experience + contrast-safe blank.
// Boots the REAL app fresh and checks:
//   1) First run opens STRAIGHT into the mandala (no Start page), on the deep
//      near-black canvas, with the symmetry sliders panel HIDDEN by default; a
//      real pointer stroke blooms into a colourful kaleidoscope.
//   2) The Start page is still reachable via the G shortcut, and picking "Blank"
//      there lands on the contrast-safe neutral dark canvas where a first stroke
//      deposits LIGHT, clearly-visible ink (never the hostile white + black).
//
//   node tests/smoke/onboarding-first-run-live.mjs
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

const NEUTRAL = "rgb(20, 21, 26)"; // #14151a (blank)
const MANDALA = "rgb(13, 14, 18)"; // #0d0e12 (mandala)

// A curved drag near the canvas centre - enough travel to bloom under symmetry.
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

    // Read stage bg, whether the onboarding/symmetry panels are visible, and the
    // painted ink across the layer canvases (count, how much is LIGHT, hue spread).
    const measure = `(() => {
      const stage = document.querySelector('.stage');
      const bg = getComputedStyle(stage).backgroundColor;
      const onb = document.querySelector('.onboarding');
      const onboardingShown = !!onb && getComputedStyle(onb).display !== 'none';
      const sym = document.querySelector('.symmetry-box');
      const symPanelShown = !!sym && getComputedStyle(sym).display !== 'none';
      let painted = 0, light = 0; const hues = new Set();
      for (const cv of document.querySelectorAll('.stage canvas')) {
        const ctx = cv.getContext('2d'); if (!ctx) continue;
        const d = ctx.getImageData(0,0,cv.width,cv.height).data;
        for (let i=0;i<d.length;i+=4){ if (d[i+3] > 12){ painted++; const r=d[i],g=d[i+1],b=d[i+2];
          if (0.299*r+0.587*g+0.114*b > 140) light++;
          const mx=Math.max(r,g,b), mn=Math.min(r,g,b);
          if (mx-mn > 30){ let h; if(mx===r)h=((g-b)/(mx-mn))%6; else if(mx===g)h=(b-r)/(mx-mn)+2; else h=(r-g)/(mx-mn)+4; hues.add(Math.floor((((h*60)+360)%360)/30)); } } }
      }
      return { bg, onboardingShown, symPanelShown, painted, light, hueBins: hues.size };
    })()`;

    async function drawStroke() {
      const pts = strokePath(550, 360);
      await S("Input.dispatchMouseEvent", { type: "mousePressed", x: pts[0][0], y: pts[0][1], button: "left", clickCount: 1, buttons: 1 });
      for (let i = 1; i < pts.length; i++) await S("Input.dispatchMouseEvent", { type: "mouseMoved", x: pts[i][0], y: pts[i][1], button: "left", buttons: 1 });
      await S("Input.dispatchMouseEvent", { type: "mouseReleased", x: pts.at(-1)[0], y: pts.at(-1)[1], button: "left", clickCount: 1, buttons: 1 });
      await sleep(250);
    }

    async function freshLoad() {
      await S("Page.navigate", { url: PAGE });
      await waitFor(() => E("!!document.querySelector('.stage canvas')"));
      await E("localStorage.clear(); indexedDB.databases && indexedDB.databases().then(ds=>ds.forEach(d=>indexedDB.deleteDatabase(d.name)))");
      await S("Page.navigate", { url: PAGE });
      await waitFor(() => E("!!document.querySelector('.stage canvas')"));
      await sleep(500);
    }

    function check(name, cond, detail) { console.log(`   ${cond ? "✓" : "✗"} ${name}${detail ? "  " + detail : ""}`); if (!cond) fails.push(name); }

    mkdirSync(OUT, { recursive: true });

    // ---- Path 1: first run opens straight into the mandala -------------------
    console.log("\n■ First run → mandala (no Start page, sliders hidden)");
    await freshLoad();
    const m0 = await E(measure);
    check("Start page NOT shown on first run", m0.onboardingShown === false);
    check("lands on the mandala canvas", m0.bg === MANDALA, m0.bg);
    check("symmetry sliders panel hidden by default", m0.symPanelShown === false);
    // Baseline before drawing isn't 0: radial symmetry paints faint guide spokes
    // on a stage overlay canvas. Measure the bloom as the delta the stroke adds.
    console.log(`   · baseline before drawing: painted=${m0.painted} (radial symmetry guides)`);
    await drawStroke();
    const m1 = await E(measure);
    check("one stroke blooms (many mirrored points)", m1.painted - m0.painted > 50000, `Δpainted=${m1.painted - m0.painted}`);
    check("bloom is colourful (rainbow hues)", m1.hueBins >= 3, `hueBins=${m1.hueBins}`);
    check("symmetry panel still hidden after drawing", m1.symPanelShown === false);
    let shot = await S("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, "first-run-mandala.png"), Buffer.from(shot.data, "base64"));

    // ---- Path 2: G → Start page → Blank → contrast-safe dark -----------------
    console.log("\n■ G → Start page → Blank → first stroke");
    // Open the Start page via the G shortcut, then confirm the "start over" dialog.
    await S("Input.dispatchKeyEvent", { type: "keyDown", key: "g", code: "KeyG", windowsVirtualKeyCode: 71 });
    await S("Input.dispatchKeyEvent", { type: "keyUp", key: "g", code: "KeyG", windowsVirtualKeyCode: 71 });
    await waitFor(() => E("!!document.querySelector('.confirm-card')"));
    await E(`[...document.querySelectorAll('.confirm-card button')].find(b=>b.textContent.trim()==='Start page')?.click()`);
    await waitFor(() => E("!!document.querySelector('.onboarding') && getComputedStyle(document.querySelector('.onboarding')).display !== 'none'"));
    await E(`[...document.querySelectorAll('.onboarding-btn')].find(b=>b.textContent.trim()==='Full screen')?.click()`);
    await waitFor(() => E("getComputedStyle(document.querySelector('.onboarding')).display === 'none'"));
    await sleep(200);
    const b0 = await E(measure);
    check("Blank lands on the neutral dark canvas", b0.bg === NEUTRAL, b0.bg);
    check("Blank is NOT the mandala shade", b0.bg !== MANDALA, b0.bg);
    check("canvas empty before the stroke", b0.painted === 0, `painted=${b0.painted}`);
    await drawStroke();
    const b1 = await E(measure);
    check("first stroke deposited ink", b1.painted > 150, `painted=${b1.painted}`);
    check("stroke ink is LIGHT (visible on dark)", b1.light > 80, `light=${b1.light}`);
    shot = await S("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, "blank-via-g.png"), Buffer.from(shot.data, "base64"));

    console.log(`\n✓ screenshots → ${OUT}/first-run-mandala.png, blank-via-g.png`);
    await send("Target.closeTarget", { targetId });
    if (fails.length) { console.log(`\n✗ ${fails.length} check(s) failed: ${fails.join(", ")}`); return 1; }
    console.log("\n✓ all checks passed");
    return 0;
  } finally { try { ws?.close(); } catch {} br.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("onboarding-first-run-live failed:", e.message); process.exit(1); });

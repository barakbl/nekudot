import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PORT = 4404, DBG = 9338;
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "buildup-out");
const PAGE_URL = `http://localhost:${PORT}/tests/smoke/panel-scroll.html`;
const findChrome = () => [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((p) => existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, step = 200) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch {} await sleep(step); } return false; }
function cdp(ws) { let id = 0; const p = new Map(); ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } }; return (method, params = {}, sid) => new Promise((res, rej) => { const mid = ++id; p.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params, ...(sid ? { sessionId: sid } : {}) })); }); }

async function main() {
  const chrome = findChrome(); if (!chrome) { console.log("• No Chrome found."); return 0; }
  const dev = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { cwd: join(HERE, "..", ".."), stdio: "ignore" });
  const browser = spawn(chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${DBG}`, "--force-device-scale-factor=1", "--window-size=760,460", "--hide-scrollbars=false", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
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
    await S("Emulation.setDeviceMetricsOverride", { width: 760, height: 460, deviceScaleFactor: 1, mobile: false });
    await S("Page.navigate", { url: PAGE_URL });
    const E = async (expr) => { const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    if (!(await waitFor(() => E("window.__done === true"), 45000))) throw new Error("harness did not finish");

    const m = await E("window.__metrics");
    console.log("Fur connecting panel in a 460px-tall viewport (More expanded):");
    console.log(`  viewport height     : ${m.viewportH}px`);
    console.log(`  panel height        : ${m.panelH}px   ${m.fitsViewport ? "✓ fits viewport" : "✗ OVERFLOWS viewport"}`);
    console.log(`  content scroll/client: ${m.contentScrollH}/${m.contentClientH}px   ${m.scrolls ? "✓ scrolls" : "✗ no scroll"}`);

    const shot = await S("Page.captureScreenshot", { format: "png" });
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, "panel-fur-scroll.png"), Buffer.from(shot.data, "base64"));
    console.log(`\n✓ screenshot → ${join(OUT, "panel-fur-scroll.png")}`);

    const ok = m.fitsViewport && m.scrolls;
    console.log(ok ? "\n✓ PASS — panel is capped and the body scrolls" : "\n✗ FAIL");
    await send("Target.closeTarget", { targetId });
    return ok ? 0 : 1;
  } finally { try { ws?.close(); } catch {} browser.kill("SIGKILL"); dev.kill("SIGKILL"); }
}
main().then((c) => process.exit(c)).catch((e) => { console.error("panel-scroll failed:", e.message); process.exit(1); });

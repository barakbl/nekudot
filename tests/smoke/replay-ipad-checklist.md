# Real-iPad replay probe (vector-replay P2.3, risks #4/#5)

The headless bench (`npm run smoke:replay-bench`) says replay compute is ~0.4s for a
full 20-min dense mandala and the cost plateaus (MAX_PIXELS). This probe confirms it
on real Apple hardware/Safari, where the repo has past iOS scars (invisible strokes,
Safari 17 `getCoalescedEvents`, IDB/ITP quirks - see PR #12 history).

Do this once, on a real iPad in real Safari, and paste the numbers back (they get
appended to the report + card #126).

## A. Record a real 45-min-ish mandala dogfood session

1. Serve the app to the iPad: on the Mac run `npm run dev -- --host`, note the
   `Network:` URL, open it in iPad Safari (same Wi-Fi). Or use the deployed app.
2. Turn recording on (no UI toggle yet): Safari devtools is awkward on iPad, so
   easiest is to enable it from the Mac first if using localhost, OR add
   `?__eventlog=1`-style bootstrapping. Simplest: in Safari, use the Web Inspector
   (Mac Safari → Develop → <iPad> → the page → Console) and run
   `localStorage.setItem('app.eventLog','true'); location.reload()`.
3. Draw a real, dense, radial-symmetry mandala for a good while (aim ~30-45 min of
   real drawing - the risk is dense radial × a heavy connection style like LongFur).
4. Leave the tab; don't reload (the log is in the `nekudot-events` IndexedDB).

## B. Measure replay on the iPad

In the Mac Safari Web Inspector Console (attached to the iPad page), run the
self-copying snippet the assistant provides (or paste this):

```js
(async () => {
  const off = await import('/src/replay/offscreen.ts');
  const eng = await import('/src/replay/engine.ts');
  const bw  = await import('/src/replay/bare-world.ts');
  const nf  = await import('/src/neighbor-finder.ts');
  const db = await new Promise((res,rej)=>{const r=indexedDB.open('nekudot-events');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
  const rows = await new Promise((res,rej)=>{const req=db.transaction('events','readonly').objectStore('events').getAll();req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error);});
  const init = rows.find(e=>e.t==='init');
  const seed = () => { const s=new bw.MemoryStore(); for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);const raw=localStorage.getItem(k);try{s.set(k,JSON.parse(raw));}catch{s.set(k,raw);}} return s; };
  const strokes = rows.filter(r=>r.t==='begin').length;
  const samples = rows.filter(r=>r.t==='samples').reduce((n,r)=>n+r.x.length,0);
  // offscreen replay (compute + real Safari canvas raster)
  const t0 = performance.now();
  const { world, manager } = off.createOffscreenReplayWorld({ width: init.width, height: init.height, layers: init.layers, dpr: window.devicePixelRatio, store: seed() });
  eng.replay(rows, world);
  const offMs = performance.now() - t0;
  // compute-only floor (bare quadtree)
  const t1 = performance.now();
  eng.replay(rows, bw.createBareReplayWorld({ store: seed(), finder: nf.createNeighborFinder('quadtree', []) }));
  const bareMs = performance.now() - t1;
  const out = { device: navigator.userAgent, strokes, samples, offscreenMs: Math.round(offMs), computeMs: Math.round(bareMs), msPerSample: +(offMs/samples).toFixed(3) };
  console.log('IPAD REPLAY →', JSON.stringify(out));
  try { copy(JSON.stringify(out)); } catch {}
  return out;
})();
```

Record: `offscreenMs` (full replay incl. Safari raster), `computeMs` (device-
independent floor), `msPerSample`, and whether the replayed artwork looks visually
identical to the live one (open the Web Inspector, or add the artwork to the DOM).

## C. Equivalence sanity on iPad (optional)

Run the P2.2-style compare: after the live session, `window.__replay.layerManager`
is the live artwork; flatten it (`off.flattenToImageData(window.__replay.layerManager)`)
and diff against `off.flattenToImageData(manager)` from the replay above. On the same
device this should be pixel-identical (or note any Safari-specific AA differences).

## What to watch for (past iOS scars)

- **Safari IDB/ITP**: the `nekudot-events` DB may be evicted under storage pressure or
  ITP - confirm the log survived (row count > 0) before benching.
- **`getCoalescedEvents`**: absent on older Safari - shouldn't matter for replay (it
  reads the recorded samples), but if the RECORDING looks sparse, that's the cause.
- **Dense radial × LongFur**: this is the ~200× worst case (risk #4). If replay of a
  real such session is many seconds on the iPad, that's the number GATE 2 needs.

/* The hero's living web: points drift slowly and faint threads bloom between
   near neighbours - the app's whole idea, rendered behind the words. Gold points
   over blue threads, matching the app palette. Vanilla canvas, no deps.

   It's deliberately calm (slow drift, low-opacity lines) so it reads as
   atmosphere, not a screensaver. Honours prefers-reduced-motion by drawing a
   single still frame, and pauses when the tab is hidden. */
(function () {
  const canvas = document.getElementById("web");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  const BLUE = "107, 148, 255"; // thread colour (rgb of --blue)
  const GOLD = "255, 204, 51"; // point colour (rgb of --gold)
  const LINK_DIST = 150; // px within which two points connect
  const SPEED = 0.14; // base drift speed (px/frame at 60fps)

  let w = 0;
  let h = 0;
  let dpr = 1;
  let points = [];

  // Density scales with area, capped so big screens stay light.
  function pointCount() {
    return Math.min(78, Math.round((w * h) / 14000));
  }

  function seed() {
    points = [];
    const n = pointCount();
    for (let i = 0; i < n; i++) {
      points.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * SPEED * 2,
        vy: (Math.random() - 0.5) * SPEED * 2,
        r: 1.1 + Math.random() * 1.6,
        // Each point breathes on its own slow phase, so the gold glimmers.
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function step(now) {
    ctx.clearRect(0, 0, w, h);

    for (const p of points) {
      p.x += p.vx;
      p.y += p.vy;
      // Soft wrap with a margin so points re-enter instead of popping.
      const m = LINK_DIST;
      if (p.x < -m) p.x = w + m;
      else if (p.x > w + m) p.x = -m;
      if (p.y < -m) p.y = h + m;
      else if (p.y > h + m) p.y = -m;
    }

    // Threads first, so points sit on top of them.
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      for (let j = i + 1; j < points.length; j++) {
        const b = points[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d > LINK_DIST) continue;
        const t = 1 - d / LINK_DIST; // 0 at the edge, 1 when overlapping
        ctx.strokeStyle = `rgba(${BLUE}, ${(t * 0.34).toFixed(3)})`;
        ctx.lineWidth = 0.6 + t * 0.6;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    // Glowing gold points.
    for (const p of points) {
      const breathe = 0.6 + 0.4 * Math.sin(now * 0.0011 + p.phase);
      ctx.beginPath();
      ctx.fillStyle = `rgba(${GOLD}, ${(0.5 + 0.4 * breathe).toFixed(3)})`;
      ctx.shadowColor = `rgba(${GOLD}, 0.5)`;
      ctx.shadowBlur = 8 * breathe;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
  }

  let raf = null;
  function loop(now) {
    step(now);
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (raf == null) raf = requestAnimationFrame(loop);
  }
  function stop() {
    if (raf != null) {
      cancelAnimationFrame(raf);
      raf = null;
    }
  }

  resize();
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  if (reduceMotion) {
    step(0); // one calm, static frame
  } else {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else start();
    });
    start();
  }
})();

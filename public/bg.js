// ClipLab – schwebender Sternenstaub im Hintergrund (wie die Partikel auf imakio.de).
// Dezent, langsam, sparsam: wenige Punkte, pausiert bei verstecktem Tab, respektiert "Bewegung reduzieren".
(() => {
  if (document.getElementById("clbg")) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const c = document.createElement("canvas");
  c.id = "clbg"; c.setAttribute("aria-hidden", "true");
  c.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;background:#0A0A0A";
  document.documentElement.style.background = "#0A0A0A";
  (document.body || document.documentElement).prepend(c);
  const ctx = c.getContext("2d");
  let W = 0, H = 0, dpr = 1, pts = [], last = performance.now(), running = true;
  const rnd = (a, b) => a + Math.random() * (b - a);

  function resize() {
    dpr = Math.min(1.5, devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
    const n = Math.round(Math.min(320, (W * H) / 6000));
    pts = Array.from({ length: n }, () => ({
      x: rnd(0, W), y: rnd(0, H), r: rnd(0.6, 1.9), a: rnd(0.25, 0.85),
      vx: rnd(-0.06, 0.06), vy: rnd(-0.1, -0.02), tw: rnd(0, Math.PI * 2), ts: rnd(0.3, 1.2),
    }));
    if (reduce) draw(0);
  }
  function draw(dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // leichter Lichtschein oben links, wie das Leuchten in der Live-Phase der Website
    const g = ctx.createRadialGradient(W * 0.2, -H * 0.1, 0, W * 0.2, -H * 0.1, Math.max(W, H) * 0.7);
    g.addColorStop(0, "rgba(255,255,255,0.045)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (const p of pts) {
      p.x += p.vx * dt * 60; p.y += p.vy * dt * 60; p.tw += p.ts * dt;
      if (p.y < -4) { p.y = H + 4; p.x = rnd(0, W); }
      if (p.x < -4) p.x = W + 4; else if (p.x > W + 4) p.x = -4;
      const a = p.a * (0.65 + 0.35 * Math.sin(p.tw));
      ctx.fillStyle = `rgba(244,244,244,${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  }
  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    draw(dt);
    requestAnimationFrame(frame);
  }
  addEventListener("resize", resize); resize();
  if (!reduce) {
    requestAnimationFrame(frame);
    document.addEventListener("visibilitychange", () => {
      running = !document.hidden;
      if (running) { last = performance.now(); requestAnimationFrame(frame); }
    });
  }
})();

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
    // Drei Tiefenebenen: nahe Punkte größer, heller und schneller – ergibt ein sichtbares Schweben
    pts = Array.from({ length: n }, () => {
      const depth = Math.random();                 // 0 = fern, 1 = nah
      const ang = rnd(-Math.PI * 0.75, -Math.PI * 0.25); // überwiegend nach oben, leicht seitlich
      const sp = 0.12 + depth * 0.5;
      return {
        x: rnd(0, W), y: rnd(0, H), depth,
        r: 0.6 + depth * 1.8, a: 0.2 + depth * 0.65,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        wob: rnd(0, Math.PI * 2), ws: rnd(0.2, 0.6),   // leichtes Hin-und-Her
        tw: rnd(0, Math.PI * 2), ts: rnd(0.4, 1.4),    // Flimmern
      };
    });
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
      p.wob += p.ws * dt; p.tw += p.ts * dt;
      p.x += (p.vx + Math.sin(p.wob) * 0.25 * p.depth) * dt * 60;
      p.y += p.vy * dt * 60;
      if (p.y < -6) { p.y = H + 6; p.x = rnd(0, W); }
      if (p.x < -6) p.x = W + 6; else if (p.x > W + 6) p.x = -6;
      const a = p.a * (0.6 + 0.4 * Math.sin(p.tw));
      ctx.fillStyle = `rgba(244,244,244,${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      if (p.depth > 0.85) {   // die nächsten Punkte leuchten leicht
        ctx.fillStyle = `rgba(244,244,244,${(a * 0.18).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2); ctx.fill();
      }
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

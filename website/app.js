// Imakio – Scroll-Story als digitaler Build, monochrom auf Schwarz.
// 0 Idee (ein blinkender Cursor-Block) → 1 Think (Leiterbahnen wie auf einer Platine verbinden Knoten, Datenpakete laufen mit dem Scroll)
// → 2 Make (Knoten rasten auf die Würfelecken, ein Cursor baut Kante für Kante, mit Koordinaten-Readouts) → 3 Create (Flächen füllen sich Pixel
// für Pixel) → 4 Live (fester Körper, Scan-Zeile, Status-Readout). LED-Punktraster als Hintergrund. Keine Dauerbewegung außer Cursor und Scan.
// Drumherum: Headlines wechseln links/rechts, Kapitelnummer unten links, schwebende Labels, Glas-Panels mit Clip-Ausschnitten.
(() => {
  "use strict";
  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d");
  const story = document.getElementById("story");
  const heads = [...document.querySelectorAll(".head")];
  const labels = [...document.querySelectorAll(".lab")];
  const phases = [...document.querySelectorAll(".phases li")];
  const bar = document.getElementById("bar");
  const stStep = document.getElementById("stStep"), stPct = document.getElementById("stPct"), stName = document.getElementById("stName");
  const NAMES = ["Idee", "Think", "Make", "Create", "Live"];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const ease = (t) => t * t * (3 - 2 * t);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const INK = "244,244,244";

  // ---- Größe ----
  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  addEventListener("resize", resize); resize();

  // ---- Scroll-Fortschritt 0..4 ----
  let progress = 0;
  const panels = [...document.querySelectorAll(".panel")];
  function readScroll() {
    const r = story.getBoundingClientRect();
    const total = story.offsetHeight - innerHeight;
    const p = Math.min(1, Math.max(0, -r.top / Math.max(1, total)));
    progress = p * 4;
    const step = Math.min(4, Math.max(0, Math.round(progress - 0.1)));
    heads.forEach((h, i) => h.classList.toggle("on", i === step));
    labels.forEach((l) => l.classList.toggle("on", Number(l.dataset.step) === step));
    phases.forEach((li, i) => li.classList.toggle("on", i <= step));
    bar.style.width = (p * 100).toFixed(1) + "%";
    stStep.textContent = String(step + 1).padStart(2, "0");
    stPct.textContent = Math.round(p * 100) + "%";
    stName.textContent = NAMES[step];
    panels.forEach((pn) => pn.classList.toggle("on", step >= Number(pn.dataset.from)));
    const stage = story.querySelector(".stage"); stage.classList.toggle("side-r", step % 2 === 1); stage.classList.toggle("side-l", step % 2 === 0);
  }
  addEventListener("scroll", readScroll, { passive: true }); readScroll();

  // ---- Maus: nur ein leichtes Kippen des Objekts und ein Parallax der Panels ----
  let mx = -1, my = -1, smx = -1, smy = -1;
  addEventListener("pointermove", (e) => { mx = e.clientX; my = e.clientY; }, { passive: true });
  addEventListener("pointerleave", () => { mx = my = -1; });
  function parallax() {
    if (smx >= 0 && !reduce) { const dx = (smx / W - 0.5), dy = (smy / H - 0.5);
      panels.forEach((p, i) => { const k = 14 + i * 6; p.style.setProperty("--px", (-dx * k).toFixed(1) + "px"); p.style.setProperty("--py", (-dy * k).toFixed(1) + "px"); }); }
    requestAnimationFrame(parallax);
  }
  requestAnimationFrame(parallax);

  // ---- Würfel: Ecken, Kanten, Flächen ----
  const V = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
  // Reihenfolge, in der der Cursor die Kanten baut: Boden, Säulen, Deckel
  const E = [[0,1],[1,2],[2,3],[3,0],[0,4],[4,5],[5,1],[5,6],[6,2],[6,7],[7,3],[7,4]];
  const F = [{ v: [4,5,6,7], n: [0,0,1] }, { v: [0,1,2,3], n: [0,0,-1] }, { v: [1,2,6,5], n: [1,0,0] }, { v: [0,3,7,4], n: [-1,0,0] }, { v: [3,2,6,7], n: [0,1,0] }, { v: [0,1,5,4], n: [0,-1,0] }];
  const S = 0.72, CELLS = 9;
  // Knoten in Phase 1: 14 Punkte auf dem Raster, die ersten 8 wandern später auf die Würfelecken
  const NODES = 14, ideas = [];
  for (let i = 0; i < NODES; i++) { const a = rnd() * Math.PI * 2, r = 0.55 + rnd() * 0.9; ideas.push([Math.cos(a) * r * 1.5, Math.sin(a) * r, 0, rnd()]); }
  const LINKS = [];
  for (let i = 0; i < NODES; i++) { LINKS.push([-1, i]); if (i > 0) LINKS.push([i, Math.floor(rnd() * i)]); }
  // feste Zufallsreihenfolge, in der die Pixel jeder Fläche aufleuchten
  const cellOrder = F.map(() => Array.from({ length: CELLS * CELLS }, () => rnd()));
  const hex = (n) => (n >>> 0).toString(16).toUpperCase().padStart(2, "0");

  function dotGrid(ox, oy) {
    // LED-Matrix statt Linienraster: feine Punkte, jeder vierte etwas heller
    const step = W > 760 ? 22 : 18;
    const x0 = ((ox % step) + step) % step, y0 = ((oy % step) + step) % step;
    for (let y = y0, r = 0; y <= H; y += step, r++) {
      for (let x = x0, c = 0; x <= W; x += step, c++) {
        const major = ((Math.round((x - ox) / step) % 4) === 0) && ((Math.round((y - oy) / step) % 4) === 0);
        ctx.fillStyle = major ? `rgba(${INK},.14)` : `rgba(${INK},.045)`;
        ctx.fillRect(Math.round(x), Math.round(y), major ? 2 : 1, major ? 2 : 1);
      }
    }
  }
  const snap = (v, g) => Math.round(v / g) * g;
  // Leiterbahn wie auf einer Platine: gerade, dann 45°-Knick
  function trace(A, B) {
    const dx = B[0] - A[0], dy = B[1] - A[1], ax = Math.abs(dx), ay = Math.abs(dy);
    const mid = ax > ay ? [B[0] - Math.sign(dx) * ay, A[1]] : [A[0], B[1] - Math.sign(dy) * ax];
    return [A, mid, B];
  }
  function along(pts, f) { // Punkt bei Anteil f (0..1) entlang eines Pfads, plus der Pfad bis dahin
    const seg = []; let L = 0; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]); seg.push(l); L += l; }
    let d = f * L; const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) { if (d <= seg[i-1]) { const k = seg[i-1] ? d / seg[i-1] : 0; const p = [pts[i-1][0] + (pts[i][0] - pts[i-1][0]) * k, pts[i-1][1] + (pts[i][1] - pts[i-1][1]) * k]; out.push(p); return out; } d -= seg[i-1]; out.push(pts[i]); }
    return out;
  }
  function tag(x, y, text, a, alignRight) { // kleines Readout in Monospace
    ctx.font = `500 10px ui-monospace, "SF Mono", Menlo, monospace`;
    const w = ctx.measureText(text).width + 10, X = alignRight ? x - w : x;
    ctx.fillStyle = `rgba(7,7,7,${(0.85 * a).toFixed(3)})`; ctx.fillRect(X, y - 8, w, 16);
    ctx.strokeStyle = `rgba(${INK},${(0.3 * a).toFixed(3)})`; ctx.lineWidth = 1; ctx.strokeRect(Math.round(X) + .5, Math.round(y - 8) + .5, Math.round(w), 16);
    ctx.fillStyle = `rgba(${INK},${(0.85 * a).toFixed(3)})`; ctx.fillText(text, X + 5, y + 3.5);
  }
  function node(x, y, s, a) { // quadratischer Knoten
    ctx.fillStyle = `rgba(${INK},${a.toFixed(3)})`; ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
  }

  // ---- Zeichnen ----
  let shown = 0, last = performance.now(), T = 0;
  function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now; T += dt;
    shown += (progress - shown) * Math.min(1, dt * 6);
    const sparkT = Math.min(1, shown);            // Phase 0→1: Leiterbahnen wachsen
    const snapT = clamp01(shown - 1);             // Phase 1→2: Knoten rasten ein, Cursor baut die Kanten
    const pixT = clamp01(shown - 2);              // Phase 2→3: Flächen füllen sich Pixel für Pixel
    const liveT = clamp01(shown - 3);             // Phase 3→4: fester Körper, hebt ab

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#070707"; ctx.fillRect(0, 0, W, H);
    if (smx < 0 && mx >= 0) { smx = mx; smy = my; } else { smx += (mx - smx) * Math.min(1, dt * 6); smy += (my - smy) * Math.min(1, dt * 6); }
    if (mx < 0) smx = -1;
    const px = (smx >= 0 && !reduce) ? (smx / W - 0.5) : 0, py = (smy >= 0 && !reduce) ? (smy / H - 0.5) : 0;

    const cx = W * 0.5, cy = H * (W > 760 ? 0.5 : 0.34);
    const scale = (W > 760 ? Math.min(W * 0.15, H * 0.23) : Math.min(W, H) * 0.22);
    const G = W > 760 ? 11 : 9;                   // Rasterweite, auf die alles einrastet
    dotGrid(cx, cy);

    // Projektion: feste Ansicht, nur ein leichtes Kippen zur Maus
    const yaw = 0.62 + px * 0.18, pitch = -0.38 + py * 0.12;
    const cr = Math.cos(yaw), sr = Math.sin(yaw), ct = Math.cos(pitch), st = Math.sin(pitch);
    const lift = -liveT * scale * 0.28;
    const proj = (x, y, z) => {
      let X = x * cr - z * sr, Z = x * sr + z * cr;
      let Y = y * ct - Z * st; Z = y * st + Z * ct;
      const persp = 3.4 / (3.4 + Z);
      return [cx + X * scale * persp, cy + lift + Y * scale * persp, Z, persp];
    };
    const C = V.map((v) => proj(v[0] * S, v[1] * S, v[2] * S));

    // Boden und Spiegelung in der Live-Phase (als Pixelzeilen)
    if (liveT > 0.01) {
      const floorY = Math.round(cy + scale * 1.05);
      for (let i = 0; i < 26; i++) { const y = floorY + i * 4, a = 0.05 * liveT * (1 - i / 26); ctx.fillStyle = `rgba(${INK},${a.toFixed(3)})`; ctx.fillRect(cx - scale * 2.6, y, scale * 5.2, 1); }
      ctx.save(); ctx.globalAlpha = 0.14 * liveT; ctx.beginPath();
      for (const [a, b] of E) { const A = C[a], B = C[b]; ctx.moveTo(A[0], 2 * floorY - A[1]); ctx.lineTo(B[0], 2 * floorY - B[1]); }
      const rg = ctx.createLinearGradient(0, floorY, 0, floorY + scale * 1.6);
      rg.addColorStop(0, `rgba(${INK},.9)`); rg.addColorStop(1, `rgba(${INK},0)`);
      ctx.setLineDash([2, 3]); ctx.strokeStyle = rg; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
    }

    // ---- Phase 0: ein blinkender Cursor-Block ----
    const sparkA = 1 - snapT;
    if (sparkA > 0.01) {
      const on = reduce || (Math.floor(T * 1.8) % 2 === 0) || sparkT > 0.05;
      const s = 10;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 0.45);
      g.addColorStop(0, `rgba(${INK},${(0.16 * sparkA * (1 - sparkT * 0.6)).toFixed(3)})`); g.addColorStop(1, `rgba(${INK},0)`);
      ctx.fillStyle = g; ctx.fillRect(cx - scale, cy - scale, scale * 2, scale * 2);
      if (on) node(cx, cy, s, sparkA);
      if (sparkT < 0.6) {
        const a = sparkA * (1 - sparkT / 0.6);
        ctx.font = `500 11px ui-monospace, "SF Mono", Menlo, monospace`; ctx.fillStyle = `rgba(${INK},${(0.55 * a).toFixed(3)})`;
        ctx.fillText("> neue_idee", cx + 16, cy + 4);
      }
    }
    // ---- Phase 1: Leiterbahnen vom Cursor zu den Knoten, Datenpakete laufen mit dem Scroll ----
    const P = ideas.map((n, i) => {
      const from = [snap(cx + n[0] * scale * sparkT, G), snap(cy + n[1] * scale * sparkT, G)];
      if (i < 8) { const s = ease(clamp01((snapT - n[3] * 0.4) / 0.6)); return [from[0] + (C[i][0] - from[0]) * s, from[1] + (C[i][1] - from[1]) * s, 1]; }
      return [from[0], from[1], 1 - snapT];
    });
    if (sparkT > 0.01 && snapT < 1) {
      LINKS.forEach(([a, b], j) => {
        const A = a < 0 ? [cx, cy] : P[a], B = P[b];
        const grow = ease(clamp01((sparkT - (j / LINKS.length) * 0.7) / 0.3));
        if (grow <= 0) return;
        const alpha = 0.42 * Math.min(A[2] ?? 1, B[2]) * (1 - snapT);
        if (alpha < 0.005) return;
        const path = trace(A, B), part = along(path, grow);
        ctx.beginPath(); part.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.strokeStyle = `rgba(${INK},${alpha.toFixed(3)})`; ctx.lineWidth = 1; ctx.stroke();
        // Datenpaket: Position hängt am Scroll, nicht an der Zeit
        if (grow >= 1) { const f = (shown * 2.5 + j * 0.37) % 1, q = along(path, f).pop(); node(q[0], q[1], 3, Math.min(1, alpha * 2.2)); }
      });
    }
    // Knoten (Quadrate); in Phase 2 mit Koordinaten-Readout
    if (sparkT > 0.01) {
      P.forEach((p, i) => {
        const a = (i < 8 ? 1 : p[2]) * sparkT;
        if (a < 0.01) return;
        node(p[0], p[1], i < 8 ? 6 : 4, 0.95 * a);
        if (i < 8) { ctx.strokeStyle = `rgba(${INK},${(0.35 * a).toFixed(3)})`; ctx.lineWidth = 1; ctx.strokeRect(Math.round(p[0] - 6) + .5, Math.round(p[1] - 6) + .5, 12, 12); }
      });
      const ta = clamp01((snapT - 0.5) / 0.3) * (1 - clamp01((pixT - 0.6) / 0.3));
      if (ta > 0.01 && W > 760) {
        [0, 2, 6].forEach((i) => { const p = C[i], v = V[i], right = p[0] > cx; tag(p[0] + (right ? 14 : -14), p[1] - 14, `N${i} ${v.map((c) => (c > 0 ? "+" : "-") + "1").join(" ")}`, ta, !right); });
      }
    }

    // ---- Phase 2: ein Cursor-Block baut die 12 Kanten nacheinander, gestrichelt → fest ----
    const built = ease(snapT) * E.length;
    let pen = null;
    E.forEach(([a, b], i) => {
      const f = clamp01(built - i); if (f <= 0) return;
      const A = C[a], B = C[b], X = A[0] + (B[0] - A[0]) * f, Y = A[1] + (B[1] - A[1]) * f;
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(X, Y);
      if (f < 1) { pen = [X, Y]; ctx.setLineDash([3, 3]); } else ctx.setLineDash([]);
      ctx.save(); if (liveT > 0) { ctx.shadowColor = `rgba(${INK},${liveT})`; ctx.shadowBlur = 12 * liveT; }
      ctx.strokeStyle = `rgba(${INK},${(0.9 - liveT * 0.2).toFixed(3)})`; ctx.lineWidth = 1.2; ctx.stroke(); ctx.restore();
    });
    ctx.setLineDash([]);
    if (pen) { node(pen[0], pen[1], 8, 1); tag(pen[0] + 12, pen[1] + 16, `EDGE ${String(Math.ceil(built)).padStart(2, "0")}/12`, 0.9, false); }

    // ---- Phase 3/4: Flächen füllen sich Pixel für Pixel, dann fest ----
    const light = [0.5, -0.7, 0.5];
    const faces = F.map((f, fi) => {
      const n = f.n; let nx = n[0] * cr - n[2] * sr, nz = n[0] * sr + n[2] * cr; let ny = n[1] * ct - nz * st; nz = n[1] * st + nz * ct;
      return { f, fi, nz, shade: Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]) };
    }).filter((x) => x.nz < 0).sort((a, b) => b.nz - a.nz);
    if (pixT > 0.01) {
      faces.forEach((x, k) => {
        const q = x.f.v.map((i) => V[i].map((c) => c * S));
        const reveal = clamp01((pixT - k * 0.12) / 0.7);
        if (liveT > 0.01) { // feste Fläche nach Lichteinfall
          ctx.beginPath(); x.f.v.forEach((i, j) => (j ? ctx.lineTo(C[i][0], C[i][1]) : ctx.moveTo(C[i][0], C[i][1]))); ctx.closePath();
          ctx.fillStyle = `rgba(${INK},${(liveT * (0.1 + x.shade * 0.4)).toFixed(3)})`; ctx.fill();
        }
        const cellA = 1 - liveT * 0.75;
        for (let u = 0; u < CELLS; u++) for (let v = 0; v < CELLS; v++) {
          if (cellOrder[x.fi][u * CELLS + v] > reveal) continue;
          const s = (u + 0.5) / CELLS, t = (v + 0.5) / CELLS;
          const lerp = (A, B, k) => A.map((c, d) => c + (B[d] - c) * k);
          const p3 = lerp(lerp(q[0], q[1], s), lerp(q[3], q[2], s), t);
          const p = proj(p3[0], p3[1], p3[2]);
          const size = Math.max(2, Math.round(scale * S * 2 / CELLS * p[3] * 0.55));
          const lum = 0.25 + x.shade * 0.6;
          ctx.fillStyle = `rgba(${INK},${(lum * cellA).toFixed(3)})`;
          ctx.fillRect(Math.round(p[0] - size / 2), Math.round(p[1] - size / 2), size, size);
        }
      });
      // Readouts statt Maßlinien: Fortschritt und Auflösung
      const ra = ease(clamp01((pixT - 0.3) / 0.4)) * (1 - liveT);
      if (ra > 0.01) {
        const xs = C.map((p) => p[0]), ys = C.map((p) => p[1]);
        const maxX = Math.max(...xs), minX = Math.min(...xs), maxY = Math.max(...ys);
        tag(minX, maxY + 24, `RENDER ${String(Math.round(pixT * 100)).padStart(3, " ")}%`, ra, false);
        if (W > 760) tag(maxX, maxY + 24, `${CELLS}×${CELLS} PX · 0x${hex(Math.round(pixT * 255))}`, ra, true);
      }
      if (liveT > 0.01) {
        ctx.beginPath(); for (const [a, b] of E) { ctx.moveTo(C[a][0], C[a][1]); ctx.lineTo(C[b][0], C[b][1]); }
        ctx.strokeStyle = `rgba(${INK},${(0.85 * liveT).toFixed(3)})`; ctx.lineWidth = 1.2; ctx.stroke();
      }
    }
    // Live: Ecken als Pixel, ein ruhiger Scan über den Körper, Status-Readout
    if (liveT > 0.01) {
      const g = ctx.createRadialGradient(cx, cy + lift, 0, cx, cy + lift, scale * 2.2);
      g.addColorStop(0, `rgba(${INK},${(0.06 * liveT).toFixed(3)})`); g.addColorStop(1, `rgba(${INK},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      C.forEach((p) => node(p[0], p[1], 5, liveT));
      if (!reduce) {
        const ys = C.map((p) => p[1]), minY = Math.min(...ys), maxY = Math.max(...ys), xs = C.map((p) => p[0]);
        const y = minY + ((T * 0.25) % 1) * (maxY - minY);
        ctx.fillStyle = `rgba(${INK},${(0.25 * liveT).toFixed(3)})`; ctx.fillRect(Math.min(...xs) - 10, Math.round(y), Math.max(...xs) - Math.min(...xs) + 20, 1);
      }
      const top = C.reduce((m, p) => (p[1] < m[1] ? p : m));
      tag(top[0] - 34, top[1] - 26, "● STATUS: LIVE", liveT, false);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- 3D-Karussell: dreht sich automatisch weiter ----
  const ringBox = document.getElementById("bauen");
  const ring = document.getElementById("ring");
  const cards = [...ring.querySelectorAll(".card")];
  const ringNow = document.getElementById("ringNow");
  const STEP = 360 / cards.length;
  const HOLD = 3200;                      // so lange steht jede Karte vorne (ms)
  let target = 0, ringRot = 0, paused = false, visible = true, timer = null;
  function radius() { return ring.offsetWidth * 0.98 + 40; }
  function placeCards() { const R = radius(); cards.forEach((c, i) => { c.style.transform = `rotateY(${i * STEP}deg) translateZ(${R}px)`; }); }
  addEventListener("resize", placeCards); placeCards();
  function go(delta) { target += delta * STEP; restart(); }
  function restart() {
    clearInterval(timer);
    if (reduce) return;                   // bei "Bewegung reduzieren" keine automatische Drehung
    timer = setInterval(() => { if (!paused && visible && !document.hidden) target += STEP; }, HOLD);
  }
  ring.addEventListener("mouseenter", () => { paused = true; });
  ring.addEventListener("mouseleave", () => { paused = false; });
  ring.addEventListener("focusin", () => { paused = true; });
  ring.addEventListener("focusout", () => { paused = false; });
  if ("IntersectionObserver" in window) new IntersectionObserver((e) => { visible = e[0].isIntersecting; }, { threshold: 0.3 }).observe(ringBox);
  let sx = null;
  ring.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
  ring.addEventListener("touchend", (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1); sx = null; });
  document.getElementById("prev").addEventListener("click", () => go(-1));
  document.getElementById("next").addEventListener("click", () => go(1));
  restart();
  function ringFrame() {
    ringRot += (target - ringRot) * (reduce ? 1 : 0.07);
    ring.style.transform = `translateZ(${-radius()}px) rotateY(${-ringRot}deg)`;
    const n = cards.length, active = ((Math.round(ringRot / STEP) % n) + n) % n;
    cards.forEach((c, i) => c.classList.toggle("dim", i !== active));
    ringNow.textContent = String(active + 1).padStart(2, "0");
    requestAnimationFrame(ringFrame);
  }
  requestAnimationFrame(ringFrame);

  // ---- Zahlen zählen hoch, sobald sie sichtbar werden ----
  const nums = [...document.querySelectorAll("[data-count]")];
  if (!reduce && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        const el = e.target, end = Number(el.dataset.count), suf = el.dataset.suffix || "", t0 = performance.now();
        const tick = (now) => {
          const k = Math.min(1, (now - t0) / 1400), v = Math.round(end * (1 - Math.pow(1 - k, 3)));
          el.textContent = v + suf;
          if (k < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    }, { threshold: 0.6 });
    nums.forEach((n) => io.observe(n));
  }
})();

// Kopfzeile passt sich hellen Abschnitten an
(() => {
  const top = document.querySelector(".top"); const lights = [...document.querySelectorAll(".light")];
  if (!top || !lights.length) return;
  const check = () => { const y = 40; top.classList.toggle("on-light", lights.some((s) => { const r = s.getBoundingClientRect(); return r.top <= y && r.bottom > y; })); };
  addEventListener("scroll", check, { passive: true }); check();
})();

// Schritte rotieren automatisch (Klick wählt), Zitate wechseln
(() => {
  const tabs = [...document.querySelectorAll("#stepTabs li")], shots = [...document.querySelectorAll("#stepShots .shot")];
  if (tabs.length) {
    let i = 0, timer;
    const show = (n) => { i = n % tabs.length; tabs.forEach((t, k) => t.classList.toggle("on", k === i)); shots.forEach((s, k) => s.classList.toggle("on", k === i)); };
    const loop = () => { clearInterval(timer); timer = setInterval(() => show(i + 1), 4500); };
    tabs.forEach((t, k) => t.querySelector("button").addEventListener("click", () => { show(k); loop(); }));
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) loop();
  }
  const q = [...document.querySelectorAll("#quotes .voice")], dots = [...document.querySelectorAll("#quotes .dots i")];
  if (q.length > 1 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    let j = 0; setInterval(() => { j = (j + 1) % q.length; q.forEach((x, k) => x.classList.toggle("on", k === j)); dots.forEach((d, k) => d.classList.toggle("on", k === j)); }, 6000);
  }
})();

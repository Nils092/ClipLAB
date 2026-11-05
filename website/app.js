// Imakio – Scroll-Story als technischer Zeichentisch, monochrom auf Schwarz.
// Der Scroll ist der Stift: 0 Idee (ein Funke) → 1 Think (Linien verbinden Punkte zu einem Gedankennetz) → 2 Make (die Punkte rasten auf die
// Ecken eines Würfels, ein Plotter-Stift zeichnet Kante für Kante) → 3 Create (Flächen werden schraffiert, Maßlinien erscheinen)
// → 4 Live (Flächen füllen sich, der Körper hebt vom Blatt ab und spiegelt sich im Boden). Keine Dauerbewegung – nur Scroll und ein leichtes Kippen zur Maus.
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
  // Zeichenreihenfolge des Stifts: ein zusammenhängender Weg über alle 12 Kanten (Boden, Säulen, Deckel)
  const E = [[0,1],[1,2],[2,3],[3,0],[0,4],[4,5],[5,1],[5,6],[6,2],[6,7],[7,3],[7,4]];
  const F = [{ v: [4,5,6,7], n: [0,0,1] }, { v: [0,1,2,3], n: [0,0,-1] }, { v: [1,2,6,5], n: [1,0,0] }, { v: [0,3,7,4], n: [-1,0,0] }, { v: [3,2,6,7], n: [0,1,0] }, { v: [0,1,5,4], n: [0,-1,0] }];
  const S = 0.72;
  // Gedankennetz in Phase 1: 14 Punkte, die ersten 8 wandern später auf die Würfelecken
  const NODES = 14, ideas = [];
  for (let i = 0; i < NODES; i++) { const a = rnd() * Math.PI * 2, r = 0.55 + rnd() * 0.9; ideas.push([Math.cos(a) * r * 1.5, Math.sin(a) * r, (rnd() - 0.5) * 0.6, rnd()]); }
  // Verbindungen des Netzes: jeder Punkt an den Funken und an 1–2 Nachbarn
  const LINKS = [];
  for (let i = 0; i < NODES; i++) { LINKS.push([-1, i]); if (i > 0) LINKS.push([i, Math.floor(rnd() * i)]); }

  function blueprint(ox, oy) {
    // Ruhiges Raster wie Millimeterpapier, keine Bewegung
    const step = W > 760 ? 44 : 34, big = step * 4;
    ctx.beginPath();
    for (let x = ox % step; x <= W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = oy % step; y <= H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.strokeStyle = `rgba(${INK},.035)`; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath();
    for (let x = ox % big; x <= W; x += big) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = oy % big; y <= H; y += big) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.strokeStyle = `rgba(${INK},.06)`; ctx.stroke();
  }
  function cross(x, y, r, a) { // Stift-Fadenkreuz
    ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
    ctx.strokeStyle = `rgba(${INK},${a})`; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.stroke();
  }
  function arrowLine(ax, ay, bx, by, a) { // Maßlinie mit Endstrichen
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, nx = -dy / L * 6, ny = dx / L * 6;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
    ctx.moveTo(ax + nx, ay + ny); ctx.lineTo(ax - nx, ay - ny); ctx.moveTo(bx + nx, by + ny); ctx.lineTo(bx - nx, by - ny);
    ctx.strokeStyle = `rgba(${INK},${a})`; ctx.lineWidth = 1; ctx.stroke();
  }

  // ---- Zeichnen ----
  let shown = 0, last = performance.now(), T = 0;
  function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now; T += dt;
    shown += (progress - shown) * Math.min(1, dt * 6);
    const k = Math.min(3.999, shown), seg = Math.floor(k), t = ease(k - seg);
    const sparkT = Math.min(1, shown);            // Phase 0→1: Netz wächst
    const snapT = clamp01(shown - 1);             // Phase 1→2: Punkte rasten ein, Stift zeichnet
    const hatchT = clamp01(shown - 2);            // Phase 2→3: Schraffur, Maße
    const liveT = clamp01(shown - 3);             // Phase 3→4: fester Körper, hebt ab

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#070707"; ctx.fillRect(0, 0, W, H);
    if (smx < 0 && mx >= 0) { smx = mx; smy = my; } else { smx += (mx - smx) * Math.min(1, dt * 6); smy += (my - smy) * Math.min(1, dt * 6); }
    if (mx < 0) smx = -1;
    const px = (smx >= 0 && !reduce) ? (smx / W - 0.5) : 0, py = (smy >= 0 && !reduce) ? (smy / H - 0.5) : 0;

    const cx = W * 0.5, cy = H * (W > 760 ? 0.5 : 0.34);
    const scale = (W > 760 ? Math.min(W * 0.15, H * 0.23) : Math.min(W, H) * 0.22);
    blueprint(cx, cy);

    // Projektion: fest eingestellte Ansicht (kein Drehen), nur ein leichtes Kippen zur Maus
    const yaw = 0.62 + px * 0.18, pitch = -0.38 + py * 0.12;
    const cr = Math.cos(yaw), sr = Math.sin(yaw), ct = Math.cos(pitch), st = Math.sin(pitch);
    const lift = -liveT * scale * 0.28;
    const proj = (x, y, z) => {
      let X = x * cr - z * sr, Z = x * sr + z * cr;
      let Y = y * ct - Z * st; Z = y * st + Z * ct;
      const persp = 3.4 / (3.4 + Z);
      return [cx + X * scale * persp, cy + lift + Y * scale * persp, Z, persp];
    };
    const corner = (i) => proj(V[i][0] * S, V[i][1] * S, V[i][2] * S);
    const C = V.map((_, i) => corner(i));

    // Boden und Spiegelung in der Live-Phase
    if (liveT > 0.01) {
      const floorY = cy + scale * 1.05;
      const g = ctx.createLinearGradient(0, floorY - scale * 0.2, 0, floorY + scale * 1.2);
      g.addColorStop(0, `rgba(${INK},${(0.05 * liveT).toFixed(3)})`); g.addColorStop(1, `rgba(${INK},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, floorY - scale * 0.2, W, scale * 1.4);
      ctx.beginPath(); ctx.moveTo(cx - scale * 2.6, floorY); ctx.lineTo(cx + scale * 2.6, floorY);
      ctx.strokeStyle = `rgba(${INK},${(0.25 * liveT).toFixed(3)})`; ctx.lineWidth = 1; ctx.stroke();
      ctx.save(); ctx.globalAlpha = 0.16 * liveT;
      ctx.beginPath();
      for (const [a, b] of E) { const A = C[a], B = C[b]; ctx.moveTo(A[0], 2 * floorY - A[1]); ctx.lineTo(B[0], 2 * floorY - B[1]); }
      const rg = ctx.createLinearGradient(0, floorY, 0, floorY + scale * 1.6);
      rg.addColorStop(0, `rgba(${INK},.9)`); rg.addColorStop(1, `rgba(${INK},0)`);
      ctx.strokeStyle = rg; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
    }

    // ---- Phase 0/1: Funke und Gedankennetz ----
    const netA = sparkT * (1 - snapT);                    // Sichtbarkeit des Netzes
    const sparkA = 1 - snapT;
    if (sparkA > 0.01) {
      // Funke: kleiner Kern mit ruhigem Atmen und zwei feinen Ringen
      const pulse = reduce ? 0 : Math.sin(T * 2.2) * 0.5 + 0.5;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 0.5);
      g.addColorStop(0, `rgba(${INK},${(0.35 * sparkA * (1 - sparkT * 0.6)).toFixed(3)})`); g.addColorStop(1, `rgba(${INK},0)`);
      ctx.fillStyle = g; ctx.fillRect(cx - scale, cy - scale, scale * 2, scale * 2);
      ctx.beginPath(); ctx.arc(cx, cy, 3 + pulse * 1.2, 0, Math.PI * 2); ctx.fillStyle = `rgba(${INK},${sparkA.toFixed(3)})`; ctx.fill();
      for (let r = 0; r < 2; r++) {
        const rr = scale * (0.14 + r * 0.12) * (1 - sparkT * 0.5), ra = (0.35 - r * 0.15) * sparkA * (1 - sparkT);
        ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI * 2); ctx.strokeStyle = `rgba(${INK},${ra.toFixed(3)})`; ctx.lineWidth = 1; ctx.stroke();
      }
    }
    // Punkte des Netzes: wandern beim Einrasten (Phase 2) auf die Würfelecken; überzählige verblassen
    const P = ideas.map((n, i) => {
      const from = [cx + n[0] * scale * sparkT, cy + n[1] * scale * sparkT];
      if (i < 8) { const s = ease(clamp01((snapT - n[3] * 0.4) / 0.6)); return [from[0] + (C[i][0] - from[0]) * s, from[1] + (C[i][1] - from[1]) * s, 1]; }
      return [from[0], from[1], 1 - snapT];
    });
    if (netA > 0.01 || snapT < 1) {
      ctx.lineWidth = 1;
      LINKS.forEach(([a, b], j) => {
        const A = a < 0 ? [cx, cy] : P[a], B = P[b];
        const grow = ease(clamp01((sparkT - (j / LINKS.length) * 0.7) / 0.3));   // Linien schießen nacheinander heraus
        if (grow <= 0) return;
        const alpha = 0.5 * grow * Math.min(A[2] ?? 1, B[2]) * (1 - snapT);
        if (alpha < 0.005) return;
        ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(A[0] + (B[0] - A[0]) * grow, A[1] + (B[1] - A[1]) * grow);
        ctx.strokeStyle = `rgba(${INK},${alpha.toFixed(3)})`; ctx.stroke();
      });
      P.forEach((p, i) => {
        const a = (i < 8 ? 1 : p[2]) * sparkT;
        if (a < 0.01) return;
        ctx.beginPath(); ctx.arc(p[0], p[1], i < 8 ? 2.4 : 1.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${INK},${(0.9 * a).toFixed(3)})`; ctx.fill();
        if (i < 8 && snapT > 0.2 && liveT < 1) cross(p[0], p[1], 7, 0.35 * clamp01((snapT - 0.2) / 0.3) * (1 - liveT));
      });
    }

    // ---- Phase 2: Der Stift zeichnet die 12 Kanten nacheinander ----
    const drawn = ease(snapT) * E.length;         // 0..12 gezeichnete Kanten
    let pen = null;
    const edgeA = 0.9 - liveT * 0.25;
    ctx.beginPath();
    E.forEach(([a, b], i) => {
      const f = clamp01(drawn - i); if (f <= 0) return;
      const A = C[a], B = C[b], X = A[0] + (B[0] - A[0]) * f, Y = A[1] + (B[1] - A[1]) * f;
      ctx.moveTo(A[0], A[1]); ctx.lineTo(X, Y);
      if (f < 1) pen = [X, Y];
    });
    if (drawn > 0) {
      ctx.save(); if (liveT > 0) { ctx.shadowColor = `rgba(${INK},${liveT})`; ctx.shadowBlur = 14 * liveT; }
      ctx.strokeStyle = `rgba(${INK},${edgeA.toFixed(3)})`; ctx.lineWidth = 1.2; ctx.stroke(); ctx.restore();
    }
    if (pen) cross(pen[0], pen[1], 12, 0.9);

    // ---- Phase 3/4: Schraffur, Maße, dann feste Flächen ----
    const light = [0.5, -0.7, 0.5];
    const faces = F.map((f) => {
      const n = f.n; let nx = n[0] * cr - n[2] * sr, nz = n[0] * sr + n[2] * cr; let ny = n[1] * ct - nz * st; nz = n[1] * st + nz * ct;
      return { f, nz, shade: Math.max(0, nx * light[0] + ny * light[1] + nz * light[2]) };
    }).filter((x) => x.nz < 0).sort((a, b) => b.nz - a.nz); // sichtbare Flächen, hintere zuerst
    if (hatchT > 0.01) {
      faces.forEach((x, fi) => {
        const pts = x.f.v.map((i) => C[i]);
        ctx.save(); ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.clip();
        // fester Körper: Füllung nach Lichteinfall
        if (liveT > 0.01) { ctx.fillStyle = `rgba(${INK},${(liveT * (0.12 + x.shade * 0.42)).toFixed(3)})`; ctx.fill(); }
        // Schraffur: Linien laufen nacheinander von einer Seite ein
        const ha = (1 - liveT) * 0.45, gap = W > 760 ? 9 : 7;
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        const span = (maxX - minX) + (maxY - minY), nLines = Math.floor(span / gap), vis = Math.floor(nLines * ease(clamp01((hatchT - fi * 0.15) / 0.7)));
        if (vis > 0 && ha > 0.01) {
          ctx.beginPath();
          for (let i = 0; i < vis; i++) { const d = minX - (maxY - minY) + i * gap + (fi % 2 ? gap / 2 : 0); ctx.moveTo(d, maxY); ctx.lineTo(d + (maxY - minY), minY); }
          ctx.strokeStyle = `rgba(${INK},${ha.toFixed(3)})`; ctx.lineWidth = 0.8; ctx.stroke();
        }
        ctx.restore();
      });
      // Maßlinien: Breite unten, Höhe rechts – nur solange es eine Zeichnung ist
      const ma = 0.6 * ease(clamp01((hatchT - 0.4) / 0.5)) * (1 - liveT);
      if (ma > 0.01) {
        const bot = C.filter((_, i) => V[i][1] === 1), xs = C.map((p) => p[0]), maxX = Math.max(...xs), maxY = Math.max(...bot.map((p) => p[1]));
        const l = C.reduce((m, p) => (p[0] < m[0] ? p : m)), r = C.reduce((m, p) => (p[0] > m[0] ? p : m));
        const top = C.reduce((m, p) => (p[1] < m[1] ? p : m));
        arrowLine(l[0], maxY + 26, r[0], maxY + 26, ma);
        arrowLine(maxX + 26, top[1], maxX + 26, maxY, ma);
        ctx.fillStyle = `rgba(${INK},${ma.toFixed(3)})`; ctx.font = `500 10px ui-monospace, Menlo, monospace`; ctx.textAlign = "center";
        ctx.fillText("B", (l[0] + r[0]) / 2, maxY + 40); ctx.save(); ctx.translate(maxX + 40, (top[1] + maxY) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText("H", 0, 0); ctx.restore();
        ctx.textAlign = "start";
      }
      // Vordere Kanten noch einmal kräftig über die Füllung
      if (liveT > 0.01) {
        ctx.beginPath(); for (const [a, b] of E) { ctx.moveTo(C[a][0], C[a][1]); ctx.lineTo(C[b][0], C[b][1]); }
        ctx.strokeStyle = `rgba(${INK},${(0.85 * liveT).toFixed(3)})`; ctx.lineWidth = 1.2; ctx.stroke();
      }
    }
    // Live: kleine Lichtpunkte an den Ecken und ein weicher Schein
    if (liveT > 0.01) {
      const g = ctx.createRadialGradient(cx, cy + lift, 0, cx, cy + lift, scale * 2.2);
      g.addColorStop(0, `rgba(${INK},${(0.07 * liveT).toFixed(3)})`); g.addColorStop(1, `rgba(${INK},0)`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      C.forEach((p, i) => { const tw = reduce ? 1 : 0.7 + 0.3 * Math.sin(T * 1.6 + i); ctx.beginPath(); ctx.arc(p[0], p[1], 2.2, 0, Math.PI * 2); ctx.fillStyle = `rgba(${INK},${(liveT * tw).toFixed(3)})`; ctx.fill(); });
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

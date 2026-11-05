// Imakio – Scroll-Story im "digitalen Raum": Perspektiv-Raster als Boden und Decke, Lichtstreifen, Spotlight an der Maus.
// Die Punkte liegen anfangs als Raster auf dem Boden; eine elektrische Scan-Linie "druckt" sie zur nächsten Form – der Baukasten in der Bildmitte,
// mit Neon-Kanten und Orbit-Ringen. Drumherum schweben Glas-Panels mit ClipLab-Ansichten (HTML, Parallax zur Maus).
// Phasen: 0 Idee (Punktraster auf der Fläche) → 1 Think (Kugel) → 2 Make (Drahtgitter-Würfel) → 3 Create (fester Würfel) → 4 Live (leuchtend).
// Drumherum: Headlines wechseln links/rechts, Kapitelnummer unten links, schwebende Labels am Objekt.
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

  const N = innerWidth < 760 ? 700 : 1300;
  const rnd = (() => { let s = 42; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();

  // ---- Zielformen (Einheitsraum ca. -1..1) ----
  const cloud = [], sphere = [], wire = [], solid = [];
  for (let i = 0; i < N; i++) {
    // Punktraster: flach auf der Zeichenfläche, leicht gestört
    const cols = 40, gx = (i % cols) / (cols - 1) * 2 - 1, gz = Math.floor(i / cols) / Math.ceil(N / cols) * 2 - 1;
    cloud.push([gx * 2.1 + (rnd() - 0.5) * 0.03, 0.95 + (rnd() - 0.5) * 0.02, gz * 1.6 + (rnd() - 0.5) * 0.03, 0]);
    // Kugel: Fibonacci-Verteilung
    const y = 1 - (i / (N - 1)) * 2, rr = Math.sqrt(1 - y * y), th = i * 2.399963;
    sphere.push([Math.cos(th) * rr * 0.95, y * 0.95, Math.sin(th) * rr * 0.95, 0]);
  }
  const E = [[[-1,-1,-1],[1,-1,-1]],[[1,-1,-1],[1,1,-1]],[[1,1,-1],[-1,1,-1]],[[-1,1,-1],[-1,-1,-1]],
             [[-1,-1,1],[1,-1,1]],[[1,-1,1],[1,1,1]],[[1,1,1],[-1,1,1]],[[-1,1,1],[-1,-1,1]],
             [[-1,-1,-1],[-1,-1,1]],[[1,-1,-1],[1,-1,1]],[[1,1,-1],[1,1,1]],[[-1,1,-1],[-1,1,1]]];
  const S = 0.72;
  for (let i = 0; i < N; i++) {
    const [p, q] = E[i % 12], t = rnd();
    wire.push([(p[0] + (q[0] - p[0]) * t) * S, (p[1] + (q[1] - p[1]) * t) * S, (p[2] + (q[2] - p[2]) * t) * S, 0]);
    const f = i % 6, u = rnd() * 2 - 1, v = rnd() * 2 - 1;
    const pt = [[1,u,v],[-1,u,v],[u,1,v],[u,-1,v],[u,v,1],[u,v,-1]][f];
    solid.push([pt[0] * S, pt[1] * S, pt[2] * S, f + 1]);
  }
  const shapes = [cloud, sphere, wire, solid, solid];
  const FACE_N = [null,[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];

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
    panels.forEach((p) => p.classList.toggle("on", step >= Number(p.dataset.from)));
  }
  const panels = [...document.querySelectorAll(".panel")];
  function parallax() {
    if (smx >= 0 && !reduce) { const dx = (smx / W - 0.5), dy = (smy / H - 0.5);
      panels.forEach((p, i) => { const k = 18 + i * 8; p.style.setProperty("--px", (-dx * k).toFixed(1) + "px"); p.style.setProperty("--py", (-dy * k + Math.sin(performance.now() / 1200 + i) * 6).toFixed(1) + "px"); }); }
    else panels.forEach((p, i) => p.style.setProperty("--py", (Math.sin(performance.now() / 1200 + i) * 6).toFixed(1) + "px"));
    requestAnimationFrame(parallax);
  }
  requestAnimationFrame(parallax);
  addEventListener("scroll", readScroll, { passive: true }); readScroll();

  const ease = (t) => t * t * (3 - 2 * t);
  const light = [0.45, 0.6, 0.66];
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  let mx = -1, my = -1, smx = -1, smy = -1;
  addEventListener("pointermove", (e) => { mx = e.clientX; my = e.clientY; }, { passive: true });
  addEventListener("pointerleave", () => { mx = my = -1; });

  const ACC = "77,178,255";
  // Lichtstreifen: dünne Linien, die aus der Tiefe nach außen schießen
  const streaks = []; for (let i = 0; i < (innerWidth < 760 ? 10 : 22); i++) streaks.push({ a: rnd() * Math.PI * 2, r: rnd(), sp: 0.25 + rnd() * 0.5, len: 60 + rnd() * 140, warm: rnd() < 0.25 });
  function room(T, cx, cy) {
    // Boden und Decke in Perspektive: Linien laufen auf den Fluchtpunkt zu, Querlinien wandern auf den Betrachter zu
    const hz = cy, vp = cx, rows = 9, cols = 14;
    const band = (sign) => {
      const yEdge = sign > 0 ? H : 0;
      ctx.beginPath();
      for (let i = 0; i <= cols; i++) { const x = (i / cols) * W * 1.6 - W * 0.3; ctx.moveTo(vp + (x - vp) * 0.18, hz + sign * 60); ctx.lineTo(x, yEdge); }
      ctx.strokeStyle = `rgba(${ACC},.10)`; ctx.lineWidth = 1; ctx.stroke();
      for (let j = 0; j < rows; j++) {
        const k = ((j / rows) + (T * 0.06)) % 1, d = Math.pow(k, 2.2);
        const y = hz + sign * (60 + d * Math.abs(yEdge - hz - 60));
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y);
        ctx.strokeStyle = `rgba(${ACC},${(0.04 + d * 0.16).toFixed(3)})`; ctx.stroke();
      }
    };
    band(1); band(-1);
    // Horizontlinie mit Schein
    const g = ctx.createLinearGradient(0, hz - 70, 0, hz + 70); g.addColorStop(0, "rgba(30,111,255,0)"); g.addColorStop(0.5, "rgba(30,111,255,.10)"); g.addColorStop(1, "rgba(30,111,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, hz - 70, W, 140);
    // Lichtstreifen
    for (const st of streaks) {
      st.r = Math.max(0, st.r + dtGlobal * st.sp * (reduce ? 0 : 1)); if (st.r > 1) { st.r = 0; st.a = rnd() * Math.PI * 2; }
      const rr = Math.pow(st.r, 1.8) * Math.max(W, H) * 0.75, x = cx + Math.cos(st.a) * rr, y = cy + Math.sin(st.a) * rr * 0.7;
      const x2 = x + Math.cos(st.a) * st.len * st.r, y2 = y + Math.sin(st.a) * st.len * st.r * 0.7;
      const lg = ctx.createLinearGradient(x, y, x2, y2); const col = st.warm ? "255,179,107" : ACC;
      lg.addColorStop(0, `rgba(${col},0)`); lg.addColorStop(1, `rgba(${col},${(0.5 * st.r).toFixed(2)})`);
      ctx.strokeStyle = lg; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    }
  }
  let dtGlobal = 0;
  // Spotlight um die Maus: ein weicher blauer Schein
  function grid(offset) {
    const step = W > 760 ? 40 : 32, big = step * 5, ox = (offset * 0.15) % step, oy = (offset * 0.3) % step;
    const draw = (alphaFine, alphaBig) => {
      ctx.beginPath();
      for (let x = -ox; x <= W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = -oy; y <= H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.strokeStyle = `rgba(${ACC},${alphaFine})`; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath();
      for (let x = -(offset * 0.15) % big; x <= W; x += big) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = -(offset * 0.3) % big; y <= H; y += big) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.strokeStyle = `rgba(${ACC},${alphaBig})`; ctx.stroke();
    };
    draw(0.03, 0.06);
    if (smx >= 0) {
      const R = Math.min(W, H) * 0.3, g = ctx.createRadialGradient(smx, smy, 0, smx, smy, R);
      g.addColorStop(0, `rgba(${ACC},.14)`); g.addColorStop(1, `rgba(${ACC},0)`);
      ctx.fillStyle = g; ctx.fillRect(smx - R, smy - R, R * 2, R * 2);
    }
  }

  // ---- Zeichnen ----
  let rot = 0.6, shown = 0, last = performance.now();
  function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
    shown += (progress - shown) * Math.min(1, dt * 6); // weich nachziehen
    if (!reduce) rot += dt * (0.12 + 0.05 * Math.min(shown, 2));
    const k = Math.min(3.999, shown), seg = Math.floor(k), t = ease(k - seg);
    const A = shapes[seg], B = shapes[seg + 1];
    const live = Math.max(0, shown - 3);              // 0..1 in der letzten Phase
    const wireAlpha = Math.max(0, 1 - Math.abs(shown - 2) * 1.4); // Kanten um Phase 2

    dtGlobal = dt;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0A0E16"; ctx.fillRect(0, 0, W, H);
    if (smx < 0 && mx >= 0) { smx = mx; smy = my; } else { smx += (mx - smx) * Math.min(1, dt * 8); smy += (my - smy) * Math.min(1, dt * 8); }
    if (mx < 0) { smx = -1; }
    ctx.save(); ctx.globalCompositeOperation = "source-over";
    grid(scrollY);
    room(rot * 2, W / 2, H * (W > 760 ? 0.5 : 0.33));
    ctx.restore();
    // Scan-Linie: Punkte oben werden zuerst in die neue Form "gedruckt", unten zuletzt
    const scanU = (t - 0.25) / 0.5;             // -0.5..1.5: Position der Linie von oben nach unten

    const cx = W * 0.5, cy = H * (W > 760 ? 0.5 : 0.33);
    const scale = (W > 760 ? Math.min(W * 0.15, H * 0.23) : Math.min(W, H) * 0.22) * (1 + live * 0.06);
    const cr = Math.cos(rot), sr = Math.sin(rot), tilt = -0.42, ct = Math.cos(tilt), st = Math.sin(tilt);
    const proj = (x, y, z) => {
      let X = x * cr - z * sr, Z = x * sr + z * cr;          // um Y drehen
      let Y = y * ct - Z * st; Z = y * st + Z * ct;           // kippen
      const persp = 3.2 / (3.2 + Z);
      return [cx + X * scale * persp, cy + Y * scale * persp, Z, persp];
    };

    // Würfelkanten als Linien
    if (wireAlpha > 0.01 || shown > 2.5) {
      const ea = Math.max(wireAlpha * 0.9, (shown > 2.5 ? 0.35 + live * 0.5 : 0));
      ctx.beginPath();
      for (const [p, q] of E) {
        const a = proj(p[0] * S, p[1] * S, p[2] * S), b = proj(q[0] * S, q[1] * S, q[2] * S);
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      }
      ctx.save(); ctx.shadowColor = `rgba(${ACC},.9)`; ctx.shadowBlur = 18; ctx.lineWidth = 1.5; ctx.strokeStyle = `rgba(${ACC},${ea})`; ctx.stroke(); ctx.restore();
      ctx.lineWidth = 1; ctx.strokeStyle = `rgba(244,246,250,${(ea * 0.6).toFixed(2)})`; ctx.stroke();
    }

    for (let i = 0; i < N; i++) {
      const a = A[i], b = B[i];
      const ti = (seg === 0 || seg === 2 || seg === 1) ? ease(clamp01((t - ((b[1] + 1) / 2) * 0.5) / 0.5)) : t;
      const x = a[0] + (b[0] - a[0]) * ti, y = a[1] + (b[1] - a[1]) * ti, z = a[2] + (b[2] - a[2]) * ti;
      const [px, py, pz, persp] = proj(x, y, z);
      let lum = 0.35 + 0.65 * (1 - (pz + 1.5) / 3);
      const face = ti > 0.5 ? b[3] : a[3];
      if (face && shown > 2.4) {
        const n = FACE_N[face];
        let nx = n[0] * cr - n[2] * sr, nz = n[0] * sr + n[2] * cr;
        let ny = n[1] * ct - nz * st; nz = n[1] * st + nz * ct;
        const shade = Math.max(0.08, nx * light[0] + -ny * light[1] + -nz * light[2]);
        lum = lum * 0.4 + shade * 0.9;
      }
      lum = Math.min(1, lum + live * 0.25);
      const size = (shown < 1 ? 1.6 : 1.3) * Math.min(persp, 1.25) * (face && shown > 3 ? 1.5 : 1);
      ctx.fillStyle = lum > 0.8 ? `rgba(244,246,250,${(0.25 + lum * 0.75).toFixed(3)})` : `rgba(${ACC},${(0.2 + lum * 0.8).toFixed(3)})`;
      ctx.fillRect(px, py, size, size);
    }

    // Die Scan-Linie selbst, mit weichem Schein
    if (seg < 3 && scanU > -0.1 && scanU < 1.1 && t > 0.001 && t < 0.999) {
      const ly = cy + (scanU * 2 - 1) * scale * 1.05, x0 = cx - scale * 1.9, x1 = cx + scale * 1.9;
      const gg = ctx.createLinearGradient(0, ly - 50, 0, ly + 50);
      gg.addColorStop(0, "rgba(30,111,255,0)"); gg.addColorStop(0.5, "rgba(30,111,255,.16)"); gg.addColorStop(1, "rgba(30,111,255,0)");
      ctx.fillStyle = gg; ctx.fillRect(x0, ly - 50, x1 - x0, 100);
      // Blitz: gezackte Linie, die jedes Bild leicht anders flackert
      ctx.save(); ctx.beginPath(); ctx.moveTo(x0, ly);
      const segs = 28; for (let i = 1; i <= segs; i++) { const x = x0 + (x1 - x0) * i / segs, env = Math.sin(Math.PI * i / segs); ctx.lineTo(x, ly + (Math.sin(i * 12.9898 + rot * 40) * 0.5 + Math.sin(i * 7.3 + rot * 90) * 0.5) * 7 * env); }
      ctx.shadowColor = `rgba(${ACC},1)`; ctx.shadowBlur = 16; ctx.strokeStyle = `rgba(${ACC},.95)`; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.shadowBlur = 0; ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 0.8; ctx.stroke(); ctx.restore();
    }
    // Orbit-Ringe ab der Create-Phase, voll in der Live-Phase
    const orbit = Math.max(0, Math.min(1, (shown - 2.6) / 1.2));
    if (orbit > 0.01) {
      ctx.save(); ctx.translate(cx, cy);
      [[1.75, 0.42, 0.5, 1], [1.95, 0.3, -0.6, -0.7]].forEach(([rx, ry, tiltR, dir], i) => {
        ctx.save(); ctx.rotate(tiltR + Math.sin(rot * 0.3 + i) * 0.08);
        ctx.beginPath(); ctx.ellipse(0, 0, scale * rx, scale * rx * ry, 0, 0, Math.PI * 2);
        ctx.shadowColor = `rgba(${ACC},.9)`; ctx.shadowBlur = 14; ctx.lineWidth = 1.2; ctx.strokeStyle = `rgba(${ACC},${(0.35 * orbit).toFixed(2)})`; ctx.stroke();
        // Laufender Lichtpunkt auf dem Ring
        const a = rot * 1.4 * dir + i * 2, px = Math.cos(a) * scale * rx, py = Math.sin(a) * scale * rx * ry;
        ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,255,255,${orbit})`; ctx.shadowBlur = 22; ctx.fill();
        ctx.restore();
      });
      ctx.restore();
    }
    // Leuchten in der Live-Phase
    if (live > 0) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 2.4);
      g.addColorStop(0, `rgba(77,178,255,${0.16 * live})`); g.addColorStop(1, "rgba(77,178,255,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
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
  // Anhalten, solange jemand eine Karte liest oder per Tastatur darin ist
  ring.addEventListener("mouseenter", () => { paused = true; });
  ring.addEventListener("mouseleave", () => { paused = false; });
  ring.addEventListener("focusin", () => { paused = true; });
  ring.addEventListener("focusout", () => { paused = false; });
  if ("IntersectionObserver" in window) new IntersectionObserver((e) => { visible = e[0].isIntersecting; }, { threshold: 0.3 }).observe(ringBox);
  // Wischen auf dem Handy
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

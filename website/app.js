// Imakio – Scroll-Story: Aus verstreuten Punkten (Ideen) wird Schritt für Schritt eine fertige Form – der Baukasten in der Bildmitte.
// Phasen: 0 Idee (Wolke) → 1 Think (Kugel) → 2 Make (Drahtgitter-Würfel) → 3 Create (fester Würfel) → 4 Live (leuchtend).
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
    // Wolke: weit verstreut
    const a = rnd() * Math.PI * 2, b = Math.acos(2 * rnd() - 1), r = 1.4 + rnd() * 2.2;
    cloud.push([Math.sin(b) * Math.cos(a) * r * 1.6, Math.cos(b) * r * 0.8, Math.sin(b) * Math.sin(a) * r, 0]);
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
  }
  addEventListener("scroll", readScroll, { passive: true }); readScroll();

  const ease = (t) => t * t * (3 - 2 * t);
  const light = [0.45, 0.6, 0.66];

  // ---- Zeichnen ----
  let rot = 0.6, shown = 0, last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    shown += (progress - shown) * Math.min(1, dt * 6); // weich nachziehen
    if (!reduce) rot += dt * (0.12 + 0.05 * Math.min(shown, 2));
    const k = Math.min(3.999, shown), seg = Math.floor(k), t = ease(k - seg);
    const A = shapes[seg], B = shapes[seg + 1];
    const live = Math.max(0, shown - 3);              // 0..1 in der letzten Phase
    const wireAlpha = Math.max(0, 1 - Math.abs(shown - 2) * 1.4); // Kanten um Phase 2

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0A0A0A"; ctx.fillRect(0, 0, W, H);

    const cx = W * 0.5, cy = H * (W > 760 ? 0.5 : 0.33);
    const scale = (W > 760 ? Math.min(W * 0.17, H * 0.26) : Math.min(W, H) * 0.22) * (1 + live * 0.06);
    const cr = Math.cos(rot), sr = Math.sin(rot), tilt = -0.42, ct = Math.cos(tilt), st = Math.sin(tilt);
    const proj = (x, y, z) => {
      let X = x * cr - z * sr, Z = x * sr + z * cr;          // um Y drehen
      let Y = y * ct - Z * st; Z = y * st + Z * ct;           // kippen
      const persp = 3.2 / (3.2 + Z);
      return [cx + X * scale * persp, cy + Y * scale * persp, Z, persp];
    };

    // Würfelkanten als Linien
    if (wireAlpha > 0.01 || shown > 2.5) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(244,244,244,${Math.max(wireAlpha * 0.55, (shown > 2.5 ? 0.18 + live * 0.25 : 0))})`;
      ctx.beginPath();
      for (const [p, q] of E) {
        const a = proj(p[0] * S, p[1] * S, p[2] * S), b = proj(q[0] * S, q[1] * S, q[2] * S);
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
    }

    for (let i = 0; i < N; i++) {
      const a = A[i], b = B[i];
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
      const [px, py, pz, persp] = proj(x, y, z);
      let lum = 0.35 + 0.65 * (1 - (pz + 1.5) / 3);
      const face = t > 0.5 ? b[3] : a[3];
      if (face && shown > 2.4) {
        const n = FACE_N[face];
        let nx = n[0] * cr - n[2] * sr, nz = n[0] * sr + n[2] * cr;
        let ny = n[1] * ct - nz * st; nz = n[1] * st + nz * ct;
        const shade = Math.max(0.08, nx * light[0] + -ny * light[1] + -nz * light[2]);
        lum = lum * 0.4 + shade * 0.9;
      }
      lum = Math.min(1, lum + live * 0.25);
      const size = (shown < 1 ? 1.6 : 1.3) * persp * (face && shown > 3 ? 1.5 : 1);
      ctx.fillStyle = `rgba(244,244,244,${(0.25 + lum * 0.75).toFixed(3)})`;
      ctx.fillRect(px, py, size, size);
    }

    // Leuchten in der Live-Phase
    if (live > 0) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 2.2);
      g.addColorStop(0, `rgba(255,255,255,${0.07 * live})`); g.addColorStop(1, "rgba(255,255,255,0)");
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

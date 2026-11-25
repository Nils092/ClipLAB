// imakio – Scroll-Story "Vom Traum zum Produkt". Ein Schwarm aus Lichtpunkten verwandelt sich Kapitel für Kapitel:
// 0 Traum (Sternenstaub, treibende Wörter für "Idee" in vielen Sprachen) → 1 Funke (die Punkte finden sich zur Glühbirne)
// → 2 Welt (gepunktete Erdkugel dreht sich, Ideen reisen als Lichtbögen von Ort zu Ort) → 3 Bauen (der Baukasten: ein Würfel)
// → 4 Live (der Würfel leuchtet, Funken steigen auf). Die Leinwand ist durchsichtig, dahinter liegt der Himmel aus style.css.
(() => {
  "use strict";
  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d");
  const story = document.getElementById("story");
  const heads = [...document.querySelectorAll(".head")];
  const phases = [...document.querySelectorAll(".phases li")];
  const bar = document.getElementById("bar");
  const stStep = document.getElementById("stStep"), stPct = document.getElementById("stPct"), stName = document.getElementById("stName");
  const NAMES = ["Traum", "Funke", "Welt", "Bauen", "Live"];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rnd = (() => { let s = 11; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const ease = (t) => t * t * (3 - 2 * t);
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const sm = (x, a, b) => ease(clamp01((x - a) / (b - a)));
  const TAU = Math.PI * 2;
  // Palette: warmes Weiß, Lavendel, Polarlicht-Türkis, Pfirsich, Rosé
  const COLS = ["255,250,240", "255,250,240", "196,186,255", "140,236,214", "255,190,150", "255,150,196"];

  // ---- Größe ----
  let W = 0, H = 0, dpr = 1, mobile = false;
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight; mobile = W < 760;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  }
  addEventListener("resize", resize); resize();

  // ---- Scroll-Fortschritt 0..4 ----
  let progress = 0;
  function readScroll() {
    const r = story.getBoundingClientRect();
    const total = story.offsetHeight - innerHeight;
    const p = clamp01(-r.top / Math.max(1, total));
    progress = p * 4;
    const step = Math.min(4, Math.max(0, Math.round(progress - 0.1)));
    heads.forEach((h, i) => h.classList.toggle("on", i === step));
    phases.forEach((li, i) => li.classList.toggle("on", i <= step));
    bar.style.width = (p * 100).toFixed(1) + "%";
    stStep.textContent = String(step + 1).padStart(2, "0");
    stPct.textContent = Math.round(p * 100) + "%";
    stName.textContent = NAMES[step];
  }
  addEventListener("scroll", readScroll, { passive: true }); readScroll();

  let mx = 0, my = 0, smx = 0, smy = 0;                       // Maus als -0.5..0.5, geglättet
  addEventListener("pointermove", (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });

  // ---- Landkarte: grobe Kontinente als Längen-Bereiche je 10°-Breitenband (nur für die gepunktete Erdkugel) ----
  const LAND = [
    [80, [[-70, -20]]], [70, [[-125, -70], [-55, -22], [60, 145]]],
    [60, [[-165, -60], [-50, -40], [5, 180]]], [50, [[-128, -58], [-8, 140], [155, 162]]],
    [40, [[-124, -70], [-9, 48], [52, 128], [136, 142]]], [30, [[-116, -80], [-9, 60], [62, 122], [130, 132]]],
    [20, [[-106, -96], [-90, -86], [-17, 52], [72, 88], [96, 110]]], [10, [[-88, -60], [-16, 48], [76, 80], [98, 108], [122, 126]]],
    [0, [[-80, -50], [9, 43], [98, 118], [130, 142]]], [-10, [[-78, -36], [13, 40], [120, 150]]],
    [-20, [[-72, -40], [13, 36], [44, 50], [118, 148]]], [-30, [[-71, -50], [16, 32], [115, 153]]],
    [-40, [[-73, -62], [143, 148], [172, 177]]], [-50, [[-74, -68]]]
  ];
  const isLand = (lat, lon) => { for (const [la, rs] of LAND) if (Math.abs(lat - la) <= 5) return rs.some(([a, b]) => lon >= a && lon <= b); return false; };
  const ll = (lat, lon, r = 1) => { const a = lat * Math.PI / 180, o = lon * Math.PI / 180; return [Math.cos(a) * Math.sin(o) * r, -Math.sin(a) * r, -Math.cos(a) * Math.cos(o) * r]; };

  // ---- Formen: jede ist eine Liste aus N Punkten [x, y, z, Helligkeit] ----
  const N = innerWidth < 760 ? 900 : 1500;
  const P = [];                                             // feste Eigenschaften je Punkt
  for (let i = 0; i < N; i++) P.push({ col: COLS[Math.floor(rnd() * COLS.length)], ph: rnd() * TAU, sp: 0.3 + rnd() * 0.9, size: 0.8 + rnd() * 1.5, lag: rnd(), bright: rnd() < 0.07 });
  // 0 Traum: weiter Sternenstaub
  const dream = P.map(() => { const a = rnd() * TAU, b = Math.acos(2 * rnd() - 1), r = 1.3 + rnd() * 2.4; return [Math.sin(b) * Math.cos(a) * r * 1.7, Math.cos(b) * r * 0.9, Math.sin(b) * Math.sin(a) * r, 0.35 + rnd() * 0.65]; });
  // 1 Funke: Glühbirne (Glas, Fassung, Glühfaden, Strahlen)
  const bulb = P.map((_, i) => {
    const k = i / N, j = () => (rnd() - 0.5) * 0.025;
    if (k < 0.5) { const a = (-222 + rnd() * 264) * Math.PI / 180; return [Math.cos(a) * 0.62 + j(), -0.22 + Math.sin(a) * 0.62 + j(), j() * 3, 1]; }
    if (k < 0.62) { const t = rnd(), side = rnd() < 0.5 ? -1 : 1; return [side * (0.41 - t * 0.14) + j(), 0.24 + t * 0.2 + j(), j() * 3, 0.9]; }
    if (k < 0.76) { const row = Math.floor(rnd() * 3), t = rnd() * 2 - 1; return [t * (0.27 - row * 0.03), 0.5 + row * 0.085 + j(), j() * 3, 0.8]; }
    if (k < 0.86) { const t = rnd(), z = Math.abs(((t * 4) % 2) - 1); return [(t - 0.5) * 0.44, -0.18 - z * 0.16 + j(), j() * 3, 1]; }
    const ray = Math.floor(rnd() * 9), a = (-200 + ray * 27.5) * Math.PI / 180, r = 0.8 + rnd() * 0.22; return [Math.cos(a) * r, -0.22 + Math.sin(a) * r, j() * 3, 0.55];
  });
  // 2 Welt: Erdkugel, Land dicht und hell, Meer nur als Hauch
  const globe = []; { let tries = 0;
    while (globe.length < N && tries++ < 200000) {
      const lat = Math.asin(2 * rnd() - 1) * 180 / Math.PI, lon = rnd() * 360 - 180, land = isLand(lat, lon);
      if (!land && globe.length % 5 !== 0) continue;        // vier von fünf Punkten müssen auf Land liegen
      if (land === (globe.length % 5 === 0)) continue;
      const p = ll(lat, lon, 0.95); globe.push([p[0], p[1], p[2], land ? 1 : 0.3]);
    }
    while (globe.length < N) { const p = ll(Math.asin(2 * rnd() - 1) * 180 / Math.PI, rnd() * 360 - 180, 0.95); globe.push([p[0], p[1], p[2], 0.2]); }
  }
  // 3 + 4 Bauen/Live: der Baukasten – Würfel aus Kanten und Flächen
  const S = 0.7, E = [[[-1,-1,-1],[1,-1,-1]],[[1,-1,-1],[1,1,-1]],[[1,1,-1],[-1,1,-1]],[[-1,1,-1],[-1,-1,-1]],[[-1,-1,1],[1,-1,1]],[[1,-1,1],[1,1,1]],[[1,1,1],[-1,1,1]],[[-1,1,1],[-1,-1,1]],[[-1,-1,-1],[-1,-1,1]],[[1,-1,-1],[1,-1,1]],[[1,1,-1],[1,1,1]],[[-1,1,-1],[-1,1,1]]];
  const cube = P.map((_, i) => {
    if (i % 5 < 2) { const [p, q] = E[i % 12], t = rnd(); return [(p[0] + (q[0] - p[0]) * t) * S, (p[1] + (q[1] - p[1]) * t) * S, (p[2] + (q[2] - p[2]) * t) * S, 1]; }
    const u = rnd() * 2 - 1, v = rnd() * 2 - 1, f = [[1,u,v],[-1,u,v],[u,1,v],[u,-1,v],[u,v,1],[u,v,-1]][i % 6]; return [f[0] * S, f[1] * S, f[2] * S, 0.55];
  });
  const shapes = [dream, bulb, globe, cube, cube];

  // Orte, zwischen denen Ideen reisen (Breite, Länge): Mainz, Lagos, Osaka, New York, São Paulo, Sydney, Mumbai, Reykjavík
  const PLACES = [[50, 8.3], [6.5, 3.4], [34.7, 135.5], [40.7, -74], [-23.5, -46.6], [-33.9, 151.2], [19, 72.8], [64.1, -21.9]];
  const ROUTES = [[0, 1], [0, 2], [0, 3], [3, 4], [1, 6], [6, 5], [2, 5], [7, 3], [0, 6], [4, 1]].map((r, i) => ({ a: PLACES[r[0]], b: PLACES[r[1]], off: i / 10 }));
  const slerp = (A, B, t) => { const d = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]))), s = Math.sin(d) || 1; const ka = Math.sin((1 - t) * d) / s, kb = Math.sin(t * d) / s; return [A[0] * ka + B[0] * kb, A[1] * ka + B[1] * kb, A[2] * ka + B[2] * kb]; };

  // Treibende Wörter: "Idee" und "Traum" rund um die Welt
  const WORDS = ["Idee", "idea", "idée", "アイデア", "sueño", "ιδέα", "dream", "فكرة", "Traum", "아이디어", "rêve", "wazo", "sogno", "ideia", "мечта", "विचार", "fikir", "idé"]
    .map((t, i) => ({ t, x: rnd(), y: rnd(), s: 0.7 + rnd() * 1.1, v: 0.004 + rnd() * 0.008, ph: rnd() * TAU, col: COLS[2 + (i % 4)] }));
  // Hintergrundsterne und aufsteigende Funken
  const STARS = Array.from({ length: mobile ? 70 : 150 }, () => ({ x: rnd(), y: rnd(), r: 0.4 + rnd() * 1.1, tw: 0.4 + rnd() * 1.6, ph: rnd() * TAU, d: 0.2 + rnd() * 0.8 }));
  const SPARKS = Array.from({ length: 46 }, () => ({ x: rnd() * 2 - 1, t: rnd(), v: 0.05 + rnd() * 0.09, w: rnd() * TAU, col: COLS[2 + Math.floor(rnd() * 4)] }));
  let shoot = { t: 9, x: 0, y: 0 };

  // ---- Bild für Bild ----
  let shown = 0, T = 0, spin = 0, last = performance.now();
  function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
    shown += (progress - shown) * Math.min(1, dt * 5);
    if (!reduce) { T += dt; spin += dt * 0.16; }
    smx += (mx - smx) * Math.min(1, dt * 4); smy += (my - smy) * Math.min(1, dt * 4);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);

    const cx = W / 2 - smx * 26, cy = H * (mobile ? 0.29 : 0.31) - smy * 16;
    const scale = Math.min(W * (mobile ? 0.36 : 0.2), H * (mobile ? 0.19 : 0.225));
    const k = Math.min(3.999, shown), seg = Math.floor(k), t = k - seg;
    const dreamK = 1 - sm(shown, 0.15, 1), globeK = sm(shown, 1.35, 2) * (1 - sm(shown, 2.25, 2.95)), liveK = sm(shown, 3.1, 4);
    const turn = sm(shown, 1.1, 1.9);                        // ab der Welt dreht sich das Objekt; davor wiegt es nur sanft
    const rot = (Math.sin(T * 0.35) * 0.28) * (1 - turn) + (spin + 0.3) * turn + smx * 0.5;
    const tilt = -0.36 * turn + smy * 0.2;
    const cr = Math.cos(rot), sr = Math.sin(rot), ct = Math.cos(tilt), st = Math.sin(tilt);
    const proj = (x, y, z) => { const X = x * cr - z * sr; let Z = x * sr + z * cr; const Y = y * ct - Z * st; Z = y * st + Z * ct; const p = 3.4 / Math.max(0.9, 3.4 + Z); return [cx + X * scale * p, cy + Y * scale * p, Z, p]; };

    // Hintergrundsterne (funkeln, leichter Parallax) – verblassen, je weiter es Richtung "Live" geht
    const starA = 1 - sm(shown, 2.6, 4) * 0.5;
    for (const s of STARS) {
      const a = (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(T * s.tw + s.ph))) * 0.7 * starA;
      ctx.fillStyle = `rgba(255,250,240,${a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(s.x * W - smx * 40 * s.d, s.y * H - smy * 30 * s.d, s.r, 0, TAU); ctx.fill();
    }
    // Sternschnuppe im Traum-Kapitel
    if (!reduce && dreamK > 0.3) {
      shoot.t += dt; if (shoot.t > 7) shoot = { t: 0, x: 0.15 + rnd() * 0.6, y: 0.05 + rnd() * 0.25 };
      if (shoot.t < 0.9) { const q = shoot.t / 0.9, x = (shoot.x + q * 0.22) * W, y = (shoot.y + q * 0.12) * H, g = ctx.createLinearGradient(x - 120, y - 65, x, y);
        g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, `rgba(255,240,220,${(Math.sin(q * Math.PI) * 0.9 * dreamK).toFixed(3)})`);
        ctx.strokeStyle = g; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(x - 120, y - 65); ctx.lineTo(x, y); ctx.stroke(); }
    }
    // Treibende Wörter
    const wordA = 0.2 * (1 - sm(shown, 0.6, 1.6) * 0.6) * (1 - sm(shown, 2.6, 3.4) * 0.6);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const w of WORDS) {
      const y = ((w.y - T * w.v) % 1 + 1) % 1, edge = Math.sin(y * Math.PI), x = w.x * W + Math.sin(T * 0.2 + w.ph) * 26 - smx * 60 * w.s;
      const dc = Math.hypot((x - cx) / W, (y * H - cy) / H), clear = clamp01((dc - 0.12) / 0.18);   // Mitte bleibt frei für das Objekt
      ctx.font = `italic 800 ${Math.round((mobile ? 17 : 26) * w.s)}px "Bodoni Moda", "Noto Serif", "Hiragino Mincho ProN", serif`;
      ctx.fillStyle = `rgba(${w.col},${(wordA * edge * clear * (0.6 + 0.4 * w.s / 1.8)).toFixed(3)})`;
      ctx.fillText(w.t, x, y * H);
    }

    // Lichtschein hinter dem Objekt
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 2.4);
    halo.addColorStop(0, `rgba(170,150,255,${(0.10 + 0.08 * globeK + 0.14 * liveK).toFixed(3)})`); halo.addColorStop(0.5, `rgba(255,170,190,${(0.03 + 0.07 * liveK).toFixed(3)})`); halo.addColorStop(1, "rgba(255,170,190,0)");
    ctx.fillStyle = halo; ctx.fillRect(cx - scale * 2.4, cy - scale * 2.4, scale * 4.8, scale * 4.8);
    // Erdkugel: zarter Rand
    if (globeK > 0.01) { const R = scale * 0.95, gg = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      gg.addColorStop(0, `rgba(120,150,255,${(0.22 * globeK).toFixed(3)})`); gg.addColorStop(1, `rgba(40,30,110,${(0.30 * globeK).toFixed(3)})`);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fillStyle = gg; ctx.fill(); ctx.strokeStyle = `rgba(170,225,255,${(0.35 * globeK).toFixed(3)})`; ctx.lineWidth = 1; ctx.stroke(); }

    // Würfelkanten (Bauen/Live)
    const edgeA = sm(shown, 2.7, 3.3) * 0.5 + liveK * 0.35;
    if (edgeA > 0.01) {
      ctx.beginPath();
      for (const [p, q] of E) { const a = proj(p[0] * S, p[1] * S, p[2] * S), b = proj(q[0] * S, q[1] * S, q[2] * S); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      ctx.strokeStyle = `rgba(210,200,255,${edgeA.toFixed(3)})`; ctx.lineWidth = 1; ctx.stroke();
    }

    // Der Schwarm
    const A = shapes[seg], B = shapes[seg + 1];
    for (let i = 0; i < N; i++) {
      const a = A[i], b = B[i], p = P[i];
      const ti = ease(clamp01(t * 1.45 - p.lag * 0.45));    // jeder Punkt bricht etwas später auf – der Schwarm fließt
      const wob = (0.05 * dreamK + 0.006) * (reduce ? 0 : 1);
      const x = a[0] + (b[0] - a[0]) * ti + Math.sin(T * p.sp + p.ph) * wob, y = a[1] + (b[1] - a[1]) * ti + Math.cos(T * p.sp * 0.8 + p.ph) * wob, z = a[2] + (b[2] - a[2]) * ti;
      const q = proj(x, y, z), w = a[3] + (b[3] - a[3]) * ti;
      const depth = clamp01(1 - (q[2] + 1) / 2);              // vorne hell, hinten dunkel – so bleibt die Kugel lesbar
      const backFade = 1 - (1 - (0.12 + 0.88 * depth)) * Math.max(globeK, sm(shown, 2.6, 3.2) * 0.6);
      const tw = 0.72 + 0.28 * Math.sin(T * (1 + p.sp) + p.ph);
      const al = Math.min(1, w * backFade * tw * (0.75 + liveK * 0.35));
      const r = p.size * q[3] * (p.bright ? 1.5 : 1) * (mobile ? 0.9 : 1);
      if (p.bright) { ctx.fillStyle = `rgba(${p.col},${(al * 0.14).toFixed(3)})`; ctx.beginPath(); ctx.arc(q[0], q[1], r * 4, 0, TAU); ctx.fill(); }
      ctx.fillStyle = `rgba(${p.col},${al.toFixed(3)})`; ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, TAU); ctx.fill();
    }

    // Ideen reisen um die Welt: Lichtbögen von Ort zu Ort
    if (globeK > 0.02) {
      for (const rt of ROUTES) {
        const A3 = ll(rt.a[0], rt.a[1]), B3 = ll(rt.b[0], rt.b[1]), head = ((T * 0.16 + rt.off) % 1);
        ctx.beginPath(); let pen = false;
        for (let s2 = 0; s2 <= 26; s2++) {
          const u = s2 / 26; if (u > head) break; if (u < head - 0.45) continue;
          const m = slerp(A3, B3, u), lift = 0.95 * (1 + Math.sin(u * Math.PI) * 0.28), q = proj(m[0] * lift, m[1] * lift, m[2] * lift);
          if (q[2] > 0.25) { pen = false; continue; }
          pen ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); pen = true;
        }
        ctx.strokeStyle = `rgba(255,196,160,${(0.55 * globeK).toFixed(3)})`; ctx.lineWidth = 1.1; ctx.stroke();
        const m = slerp(A3, B3, head), lift = 0.95 * (1 + Math.sin(head * Math.PI) * 0.28), q = proj(m[0] * lift, m[1] * lift, m[2] * lift);
        if (q[2] < 0.25) { ctx.fillStyle = `rgba(255,236,214,${globeK.toFixed(3)})`; ctx.beginPath(); ctx.arc(q[0], q[1], 2.4, 0, TAU); ctx.fill();
          ctx.fillStyle = `rgba(255,170,150,${(0.25 * globeK).toFixed(3)})`; ctx.beginPath(); ctx.arc(q[0], q[1], 8, 0, TAU); ctx.fill(); }
      }
      for (const pl of PLACES) { const m = ll(pl[0], pl[1], 0.96), q = proj(m[0], m[1], m[2]); if (q[2] > 0.1) continue;
        const pulse = (T * 0.6 + pl[1] * 0.01) % 1;
        ctx.strokeStyle = `rgba(255,214,190,${((1 - pulse) * 0.7 * globeK).toFixed(3)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(q[0], q[1], 3 + pulse * 12, 0, TAU); ctx.stroke();
        ctx.fillStyle = `rgba(255,240,225,${globeK.toFixed(3)})`; ctx.beginPath(); ctx.arc(q[0], q[1], 2.2, 0, TAU); ctx.fill(); }
    }

    // Live: Funken steigen aus dem Baukasten auf – der nächste Traum ist schon unterwegs
    if (liveK > 0.02 && !reduce) {
      for (const sp of SPARKS) {
        const u = (sp.t + T * sp.v) % 1, x = cx + sp.x * scale * 0.7 + Math.sin(T * 0.9 + sp.w) * 14 * u, y = cy - scale * 0.6 - u * H * 0.42;
        ctx.fillStyle = `rgba(${sp.col},${(Math.sin(u * Math.PI) * 0.85 * liveK).toFixed(3)})`; ctx.beginPath(); ctx.arc(x, y, 1.2 + (1 - u) * 1.3, 0, TAU); ctx.fill();
      }
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

})();

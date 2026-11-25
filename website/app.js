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
    stName.textContent = (window.imakioLang ? window.imakioLang.phases() : NAMES)[step];
  }
  addEventListener("scroll", readScroll, { passive: true }); readScroll();

  let mx = 0, my = 0, smx = 0, smy = 0;                       // Maus als -0.5..0.5, geglättet
  let mpx = -999, mpy = -999, touch = matchMedia("(hover: none)").matches;
  addEventListener("pointermove", (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; const r = canvas.getBoundingClientRect(); mpx = e.clientX - r.left; mpy = e.clientY - r.top; }, { passive: true });
  document.addEventListener("pointerleave", () => { mpx = mpy = -999; });
  const lang = () => (document.documentElement.lang === "en" ? 1 : 0);

  // ---- Erdkugel anfassen: waagerecht ziehen dreht sie, ein Klick auf einen Ort zeigt dessen Gedanken ----
  let userRot = 0, vel = 0, dragging = false, lastX = 0, moved = 0, globeNow = 0, placeXY = [], pinned = -1, pinnedAt = -99, objR = 0, objX = 0, objY = 0;
  canvas.addEventListener("pointerdown", (e) => {
    if (globeNow < 0.5) return; const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (Math.hypot(x - objX, y - objY) > objR * 1.25) return;
    dragging = true; lastX = e.clientX; moved = 0; vel = 0; try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  });
  canvas.addEventListener("pointermove", (e) => { if (!dragging) return; const dx = e.clientX - lastX; lastX = e.clientX; moved += Math.abs(dx); userRot -= dx * 0.008; vel = -dx * 0.008; });
  const release = (e) => {
    if (!dragging) return; dragging = false;
    if (moved < 6) { const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let best = -1, bd = 30;
      placeXY.forEach((p, i) => { if (!p) return; const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = i; } });
      if (best >= 0) { pinned = best; pinnedAt = T; } }
  };
  canvas.addEventListener("pointerup", release); canvas.addEventListener("pointercancel", release);

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
  const PLACE_TXT = [
    ["Mainz", "Hier fing alles an.", "Where it all began."], ["Lagos", "Eine Idee für Händler auf dem Markt.", "An idea for market traders."],
    ["Osaka", "Eine Idee für Pendler.", "An idea for commuters."], ["New York", "Eine Idee für Nachbarn.", "An idea for neighbours."],
    ["São Paulo", "Eine Idee für Musiker.", "An idea for musicians."], ["Sydney", "Eine Idee für Frühaufsteher.", "An idea for early risers."],
    ["Mumbai", "Eine Idee für kleine Läden.", "An idea for small shops."], ["Reykjavík", "Eine Idee für lange Winternächte.", "An idea for long winter nights."]
  ];
  // Sternbilder im Traum-Kapitel: Punkte relativ zur Mitte (Einheit: kürzere Bildschirmseite), Linien als Punktpaare
  const CONS = [
    { de: "Papierflieger", en: "Paper plane", x: 0.15, y: 0.3, mx: 0.2, my: 0.13, pts: [[-0.08, 0], [0.08, -0.06], [0, 0.07], [-0.01, 0.015]], ln: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 1]], k: 0 },
    { de: "Rakete", en: "Rocket", x: 0.86, y: 0.27, mx: 0.82, my: 0.12, pts: [[0, -0.09], [-0.03, -0.02], [0.03, -0.02], [-0.03, 0.05], [0.03, 0.05], [-0.06, 0.08], [0.06, 0.08], [0, 0.1]], ln: [[0, 1], [0, 2], [1, 3], [2, 4], [3, 4], [3, 5], [4, 6], [3, 7], [4, 7]], k: 0 },
    { de: "Herzblut", en: "Heart and soul", x: 0.84, y: 0.66, mx: -1, my: -1, pts: [[0, 0.07], [-0.07, -0.01], [-0.04, -0.06], [0, -0.03], [0.04, -0.06], [0.07, -0.01]], ln: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]], k: 0 }
  ];
  // Traum-Schau im ersten Bild: ohne Scrollen findet sich der Schwarm reihum zu Figuren und zerstiebt wieder
  const fromLines = (c, sc) => P.map(() => { const [a, b] = c.ln[Math.floor(rnd() * c.ln.length)], t = rnd(), j = () => (rnd() - 0.5) * 0.03;
    return [(c.pts[a][0] + (c.pts[b][0] - c.pts[a][0]) * t) * sc + j(), (c.pts[a][1] + (c.pts[b][1] - c.pts[a][1]) * t) * sc + j(), j() * 3, 0.95]; });
  const SHOW = [{ sh: bulb, spin: 0 }, { sh: fromLines(CONS[0], 9), spin: 0 }, { sh: globe, spin: 1, globe: 1 }, { sh: fromLines(CONS[1], 8.5), spin: 0 }, { sh: cube, spin: 1, cube: 1 }, { sh: fromLines(CONS[2], 10), spin: 0 }];
  const CYCLE = 7.6;                                          // Sekunden je Figur: sammeln 1,7 · halten 3,1 · zerstieben 1,5 · Pause 1,3
  const tagBox = (x, y, a, l1, l2) => {                      // kleines Glas-Schild mit zwei Zeilen
    ctx.font = '500 13px Poppins, sans-serif'; const w = Math.max(ctx.measureText(l2).width, 90) + 24, hgt = 46;
    const bx = Math.min(W - w - 10, Math.max(10, x + 16)), by = Math.max(10, y - hgt - 12);
    ctx.globalAlpha = a; ctx.strokeStyle = "rgba(255,214,190,.6)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(bx + 10, by + hgt); ctx.stroke();
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, w, hgt, 10) : ctx.rect(bx, by, w, hgt); ctx.fillStyle = "rgba(14,15,44,.82)"; ctx.fill(); ctx.strokeStyle = "rgba(200,195,255,.35)"; ctx.stroke();
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = "#FFC79E"; ctx.font = '500 10px ui-monospace, Menlo, monospace'; ctx.fillText(l1.toUpperCase().split("").join("\u200a"), bx + 12, by + 18);
    ctx.fillStyle = "#F6F3FF"; ctx.font = '500 13px Poppins, sans-serif'; ctx.fillText(l2, bx + 12, by + 36); ctx.globalAlpha = 1;
  };
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
    if (!reduce) { T += dt; if (!dragging) spin += dt * 0.16; }
    if (!dragging) { userRot += vel; vel *= 0.93; }
    smx += (mx - smx) * Math.min(1, dt * 4); smy += (my - smy) * Math.min(1, dt * 4);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);

    const cx = W / 2 - smx * 26, cy = H * (mobile ? 0.29 : 0.31) - smy * 16;
    const scale = Math.min(W * (mobile ? 0.36 : 0.2), H * (mobile ? 0.19 : 0.225));
    const k = Math.min(3.999, shown), seg = Math.floor(k), t = k - seg;
    // Traum-Schau: läuft nur ganz oben, blendet beim Scrollen aus
    const ct0 = (T + CYCLE - 1.0) % CYCLE, show = SHOW[Math.floor((T + CYCLE - 1.0) / CYCLE - 1 + SHOW.length * 99) % SHOW.length];
    const autoRaw = reduce ? 0 : (ct0 < 1.7 ? ct0 / 1.7 : ct0 < 4.8 ? 1 : ct0 < 6.3 ? 1 - (ct0 - 4.8) / 1.5 : 0) * (T > 0.6 ? 1 : 0);
    const auto = autoRaw * (1 - sm(shown, 0.04, 0.5));
    const dreamK = (1 - sm(shown, 0.15, 1)) * (1 - ease(auto) * 0.85);
    const globeK = Math.max(sm(shown, 1.35, 2) * (1 - sm(shown, 2.25, 2.95)), show.globe ? ease(auto) : 0), liveK = sm(shown, 3.1, 4);
    const turn = Math.max(sm(shown, 1.1, 1.9), show.spin ? ease(auto) : 0);   // Kugel und Würfel drehen sich; alles andere wiegt nur sanft
    const rot = (Math.sin(T * 0.35) * 0.28) * (1 - turn) + (spin + 0.3 + userRot) * turn + smx * 0.5 * (dragging ? 0 : 1);
    globeNow = globeK; objR = scale; objX = cx; objY = cy; canvas.style.cursor = globeK > 0.5 && Math.hypot(mpx - cx, mpy - cy) < scale * 1.25 ? (dragging ? "grabbing" : "grab") : "";
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
    if (!reduce && shown < 0.7) {
      shoot.t += dt; if (shoot.t > 3.4) shoot = { t: 0, x: 0.1 + rnd() * 0.65, y: 0.04 + rnd() * 0.3 };
      if (shoot.t < 0.9) { const q = shoot.t / 0.9, x = (shoot.x + q * 0.22) * W, y = (shoot.y + q * 0.12) * H, g = ctx.createLinearGradient(x - 120, y - 65, x, y);
        g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, `rgba(255,240,220,${(Math.sin(q * Math.PI) * 0.9 * (1 - sm(shown, 0.3, 0.7))).toFixed(3)})`);
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

    // Sternbilder: Maus in der Nähe zeichnet die Linien; auf dem Handy leuchtet reihum eines auf
    if (dreamK > 0.02) {
      const u = Math.min(W, H), en = lang();
      CONS.forEach((c, ci) => {
        const ox = (mobile ? c.mx : c.x) * W, oy = (mobile ? c.my : c.y) * H; if (ox < 0) return;
        const near = touch || mobile ? (Math.floor(T / 4) % 2 === ci % 2) : Math.hypot(mpx - ox, mpy - oy) < u * 0.17;
        c.k += ((near ? 1 : 0) - c.k) * Math.min(1, dt * 2.5);
        const pts = c.pts.map((p) => [ox + p[0] * u * (mobile ? 0.8 : 1) - smx * 30, oy + p[1] * u * (mobile ? 0.8 : 1) - smy * 20]);
        const prog = c.k * c.ln.length;
        ctx.strokeStyle = `rgba(255,214,190,${(0.75 * dreamK).toFixed(3)})`; ctx.lineWidth = 1; ctx.beginPath();
        c.ln.forEach(([a, b], li) => { const f = clamp01(prog - li); if (f <= 0) return; ctx.moveTo(pts[a][0], pts[a][1]); ctx.lineTo(pts[a][0] + (pts[b][0] - pts[a][0]) * f, pts[a][1] + (pts[b][1] - pts[a][1]) * f); });
        ctx.stroke();
        pts.forEach((p, pi) => { const tw = 0.6 + 0.4 * Math.sin(T * 1.7 + pi + ci);
          ctx.fillStyle = `rgba(255,236,214,${((0.45 + 0.55 * c.k) * tw * dreamK).toFixed(3)})`; ctx.beginPath(); ctx.arc(p[0], p[1], 1.6 + c.k * 1.2, 0, TAU); ctx.fill(); });
        if (c.k > 0.5) { ctx.font = '500 10px ui-monospace, Menlo, monospace'; ctx.textAlign = "center"; ctx.fillStyle = `rgba(255,214,190,${((c.k - 0.5) * 2 * dreamK).toFixed(3)})`;
          ctx.fillText((en ? c.en : c.de).toUpperCase().split("").join("\u200a"), ox - smx * 30, oy + u * 0.125 - smy * 20); }
      });
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
    const edgeA = sm(shown, 2.7, 3.3) * 0.5 + liveK * 0.35 + (show.cube ? ease(clamp01(auto * 2 - 1)) * 0.5 : 0);
    if (edgeA > 0.01) {
      ctx.beginPath();
      for (const [p, q] of E) { const a = proj(p[0] * S, p[1] * S, p[2] * S), b = proj(q[0] * S, q[1] * S, q[2] * S); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      ctx.strokeStyle = `rgba(210,200,255,${edgeA.toFixed(3)})`; ctx.lineWidth = 1; ctx.stroke();
    }

    // Der Schwarm
    const A = shapes[seg], B = shapes[seg + 1];
    for (let i = 0; i < N; i++) {
      let a = A[i]; const b = B[i], p = P[i];
      const ti = ease(clamp01(t * 1.45 - p.lag * 0.45));    // jeder Punkt bricht etwas später auf – der Schwarm fließt
      if (seg === 0 && auto > 0.001) { const g = show.sh[i], ai = ease(clamp01(auto * 1.5 - p.lag * 0.5)); a = [a[0] + (g[0] - a[0]) * ai, a[1] + (g[1] - a[1]) * ai, a[2] + (g[2] - a[2]) * ai, a[3] + (g[3] - a[3]) * ai]; }
      const wob = (0.05 * dreamK + 0.006) * (reduce ? 0 : 1);
      const x = a[0] + (b[0] - a[0]) * ti + Math.sin(T * p.sp + p.ph) * wob, y = a[1] + (b[1] - a[1]) * ti + Math.cos(T * p.sp * 0.8 + p.ph) * wob, z = a[2] + (b[2] - a[2]) * ti;
      const q = proj(x, y, z), w = a[3] + (b[3] - a[3]) * ti;
      { const ddx = q[0] - mpx, ddy = q[1] - mpy, d2 = ddx * ddx + ddy * ddy;                       // Sternenstaub weicht dem Zeiger aus
        if (d2 < 19600 && !dragging) { const d = Math.sqrt(d2) || 1, f = 1 - d / 140, push = f * f * 46; q[0] += ddx / d * push; q[1] += ddy / d * push; } }
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
      placeXY = []; let front = -1, fz = 0.05;
      PLACES.forEach((pl, pi) => { const m = ll(pl[0], pl[1], 0.96), q = proj(m[0], m[1], m[2]); placeXY[pi] = q[2] > 0.1 ? null : q; if (q[2] < fz) { fz = q[2]; front = pi; } });
      if (pinned >= 0 && (T - pinnedAt > 7 || !placeXY[pinned])) pinned = -1;
      const showP = pinned >= 0 ? pinned : front;
      for (const pl of PLACES) { const m = ll(pl[0], pl[1], 0.96), q = proj(m[0], m[1], m[2]); if (q[2] > 0.1) continue;
        const pulse = (T * 0.6 + pl[1] * 0.01) % 1;
        ctx.strokeStyle = `rgba(255,214,190,${((1 - pulse) * 0.7 * globeK).toFixed(3)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(q[0], q[1], 3 + pulse * 12, 0, TAU); ctx.stroke();
        ctx.fillStyle = `rgba(255,240,225,${globeK.toFixed(3)})`; ctx.beginPath(); ctx.arc(q[0], q[1], 2.2, 0, TAU); ctx.fill(); }
      if (showP >= 0 && placeXY[showP] && globeK > 0.6 && !mobile) { const tx = PLACE_TXT[showP]; tagBox(placeXY[showP][0], placeXY[showP][1], (globeK - 0.6) / 0.4, tx[0], tx[1 + lang()]); }
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
})();

// Imakio – Scroll-Story: Ein Objekt in der Mitte verwandelt sich Kapitel für Kapitel.
// 01 Idee (Punktwolke) → 02 Think (Punkte formen ein Breitbild-Video mit Tonspur) → 03 Make (Schnitt ins Hochformat)
// → 04 Create (Titel und Untertitel) → 05 Live (drei Clips für TikTok, Reels, Shorts).
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
  const INK = "244,244,244";

  const rnd = (() => { let s = 42; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const ease = (t) => t * t * (3 - 2 * t);
  const sm = (x, a, b) => ease(clamp((x - a) / (b - a), 0, 1));
  const bell = (x, c, w) => Math.max(0, 1 - Math.abs(x - c) / w);
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---- Punkte (Ideen) und ihre Ziele auf dem Video-Rahmen ----
  const N = innerWidth < 760 ? 520 : 900;
  const BARS = 48, HI = [13, 14, 15, 16, 17, 18, 19, 31, 32, 33];
  const barH = []; for (let j = 0; j < BARS; j++) barH.push(HI.includes(j) ? 0.62 + rnd() * 0.18 : 0.1 + rnd() * 0.28);
  const dots = [];
  for (let i = 0; i < N; i++) {
    const onEdge = i % 3 === 0;
    dots.push({ cx: rnd() - 0.5, cy: rnd() - 0.5, ph: rnd() * Math.PI * 2, sp: 0.4 + rnd() * 0.8,
      edge: onEdge, u: rnd(), bar: i % BARS, v: rnd() - 0.5, a: 0.3 + rnd() * 0.7 });
  }

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
    const p = clamp(-r.top / Math.max(1, total), 0, 1);
    progress = p * 4;
    const step = clamp(Math.round(progress - 0.1), 0, 4);
    heads.forEach((h, i) => h.classList.toggle("on", i === step));
    labels.forEach((l) => l.classList.toggle("on", Number(l.dataset.step) === step));
    phases.forEach((li, i) => li.classList.toggle("on", i <= step));
    bar.style.width = (p * 100).toFixed(1) + "%";
    stStep.textContent = String(step + 1).padStart(2, "0");
    stPct.textContent = Math.round(p * 100) + "%";
    stName.textContent = NAMES[step];
  }
  addEventListener("scroll", readScroll, { passive: true }); readScroll();

  // ---- Zeichenhelfer ----
  function rr(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  // Ein Clip-Rahmen mit Person, Tonspur und (optional) Titel/Untertiteln
  function drawFrame(x, y, w, h, o) {
    const { alpha, radius, person = 0, strip = 0, caps = 0, wave = 0, waveT = 0 } = o;
    if (alpha <= 0.005) return;
    ctx.save(); ctx.globalAlpha = alpha;
    rr(x, y, w, h, radius); ctx.fillStyle = "#0D0D0D"; ctx.fill();
    ctx.lineWidth = 1.25; ctx.strokeStyle = `rgba(${INK},.9)`; ctx.stroke();
    ctx.save(); rr(x, y, w, h, radius); ctx.clip();
    // Person (Silhouette), der Ausschnitt folgt ihr
    if (person > 0) {
      ctx.globalAlpha = alpha * person;
      const bw = w * 0.46, bh = h * 0.36, bx = x + w / 2 - bw / 2 + Math.sin(waveT) * w * 0.03, by = y + h * 0.78 - bh * 0.1;
      ctx.fillStyle = "#2B2B2B"; rr(bx, by, bw, bh * 2, bw * 0.42); ctx.fill();
      ctx.beginPath(); ctx.arc(bx + bw / 2, by - w * 0.13, w * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = alpha;
    }
    // Tonspur: breit in der Mitte (wave) → Streifen am unteren Rand (strip)
    if (wave > 0 || strip > 0) {
      const k = strip;                             // 0 = Mitte des Breitbilds, 1 = Streifen unten
      const baseY = lerp(y + h / 2, y + h * 0.9, k), amp = lerp(h * 0.48, h * 0.06, k);
      const first = Math.round(lerp(0, 10, k)), count = Math.round(lerp(BARS, 15, k)); // im Hochformat nur der gewählte Ausschnitt
      const gap = w / count;
      for (let j = 0; j < count; j++) {
        const idx = first + j; if (idx >= BARS) break;
        const hi = HI.includes(idx), hh = barH[idx] * amp * 2;
        ctx.globalAlpha = alpha * Math.max(wave, strip) * (hi ? 1 : 0.55);
        ctx.fillStyle = hi ? `rgb(${INK})` : "#3A3A3A";
        rr(x + gap * (j + 0.22), baseY - hh / 2, gap * 0.56, hh, 2); ctx.fill();
      }
      ctx.globalAlpha = alpha;
    }
    // Titelbox oben und Untertitel Wort für Wort
    if (caps > 0) {
      ctx.globalAlpha = alpha * caps;
      const th = h * 0.08, tw = w * 0.76, tx = x + w / 2 - tw / 2, ty = y + h * 0.1 - (1 - caps) * 10;
      ctx.fillStyle = "#fff"; rr(tx, ty, tw, th, th * 0.3); ctx.fill();
      ctx.fillStyle = "#0A0A0A"; ctx.font = `700 ${th * 0.46}px Poppins, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("Warte aufs Ende", x + w / 2, ty + th / 2);
      const fs = h * 0.055, sy = y + h * 0.66 + (1 - caps) * 10; ctx.font = `700 ${fs}px Poppins, sans-serif`;
      const words = ["DAS", "WAR", "SO", "GUT"], widths = words.map((t) => ctx.measureText(t).width), sp = fs * 0.35;
      let tx2 = x + w / 2 - (widths.reduce((p, c) => p + c, 0) + sp * 3) / 2;
      ctx.textAlign = "left";
      words.forEach((t, i) => {
        if (i === 1) { ctx.fillStyle = `rgb(${INK})`; rr(tx2 - sp * 0.4, sy - fs * 0.62, widths[i] + sp * 0.8, fs * 1.24, 4); ctx.fill(); ctx.fillStyle = "#0A0A0A"; }
        else ctx.fillStyle = `rgb(${INK})`;
        ctx.fillText(t, tx2, sy); tx2 += widths[i] + sp;
      });
    }
    ctx.restore(); ctx.restore();
  }

  // ---- Bild für Bild ----
  let shown = 0, last = performance.now(), T = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    shown += (progress - shown) * Math.min(1, dt * 6);
    if (!reduce) T += dt;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0A0A0A"; ctx.fillRect(0, 0, W, H);

    const cx = W / 2, cy = mobile ? H * 0.33 : H * 0.5 + Math.sin(T * 0.7) * 3;
    const w0 = mobile ? W * 0.82 : Math.min(W * 0.32, H * 0.58, 540), h0 = w0 * 9 / 16;   // Breitbild
    const hv = mobile ? Math.min(H * 0.32, 300) : Math.min(H * 0.62, 460, W * 0.32), wv = hv * 9 / 16; // Hochformat

    const k0 = sm(shown, 0, 1);            // Wolke → Rahmen
    const dotA = 1 - sm(shown, 1.0, 1.45); // Punkte verschwinden, wenn der Rahmen steht
    const frameA = sm(shown, 0.85, 1.2);
    const k1 = sm(shown, 1.25, 2.0);       // Breitbild → Hochformat
    const crop = bell(shown, 1.35, 0.38);  // Schnittmarken
    const k2 = sm(shown, 2.25, 3.0);       // Titel + Untertitel
    const k3 = sm(shown, 3.15, 3.95);      // drei Clips

    // Punkte
    if (dotA > 0.005) {
      const fx = cx - w0 / 2, fy = cy - h0 / 2;
      for (const d of dots) {
        const drift = reduce ? 0 : 1;
        const sx = cx + d.cx * W * 1.25 + Math.sin(T * d.sp + d.ph) * 18 * drift;
        const sy = cy + d.cy * H * 1.15 + Math.cos(T * d.sp * 0.8 + d.ph) * 14 * drift;
        let tx, ty;
        if (d.edge) { // auf der Rahmenkante entlang
          const per = 2 * (w0 + h0), s = d.u * per;
          if (s < w0) { tx = fx + s; ty = fy; } else if (s < w0 + h0) { tx = fx + w0; ty = fy + (s - w0); }
          else if (s < 2 * w0 + h0) { tx = fx + w0 - (s - w0 - h0); ty = fy + h0; } else { tx = fx; ty = fy + h0 - (s - 2 * w0 - h0); }
        } else { // in der Tonspur
          const gap = w0 / BARS, hh = barH[d.bar] * h0 * 0.48 * 2;
          tx = fx + gap * (d.bar + 0.5) + (rnd() - 0.5) * 0; ty = cy + d.v * hh;
        }
        const x = lerp(sx, tx, k0), y = lerp(sy, ty, k0);
        const size = lerp(2.1, 1.4, k0);
        ctx.fillStyle = `rgba(${INK},${(d.a * dotA * (d.edge || k0 < 0.5 || HI.includes(d.bar) ? 1 : 0.55)).toFixed(3)})`;
        ctx.fillRect(x, y, size, size);
      }
    }

    // Rahmen: Maße zwischen Breitbild und Hochformat
    const shrink = lerp(1, mobile ? 0.62 : 0.7, k3);        // für drei Clips nebeneinander kleiner
    const w = lerp(w0, wv, k1) * shrink, h = lerp(h0, hv, k1) * shrink, rad = lerp(14, 26, k1) * shrink;
    const stripK = k1, waveK = 1;
    const spread = (wv * shrink + (mobile ? 12 : 18)) * k3, side = 0.85;

    // Leuchten in der Live-Phase
    if (k3 > 0) {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, hv * 1.6);
      g.addColorStop(0, `rgba(255,255,255,${0.08 * k3})`); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    if (k3 > 0.01) {
      for (const dir of [-1, 1]) {
        const sw = w * side, sh = h * side;
        drawFrame(cx + dir * spread - sw / 2, cy - sh / 2, sw, sh, { alpha: frameA * k3, radius: rad, person: 1, strip: 1, wave: 1, caps: 1, waveT: T + dir });
      }
    }
    drawFrame(cx - w / 2, cy - h / 2, w, h, { alpha: frameA, radius: rad, person: k1, strip: stripK, wave: waveK, caps: k2, waveT: T });

    // Schnittmarken: der Hochformat-Ausschnitt im Breitbild
    if (crop > 0.01) {
      const cw = h0 * 9 / 16, ch = h0, x = cx - cw / 2, y = cy - ch / 2, L = 16;
      ctx.save(); ctx.globalAlpha = crop; ctx.strokeStyle = `rgb(${INK})`; ctx.lineWidth = 2; ctx.beginPath();
      [[x, y, 1, 1], [x + cw, y, -1, 1], [x, y + ch, 1, -1], [x + cw, y + ch, -1, -1]].forEach(([px, py, dx, dy]) => {
        ctx.moveTo(px + dx * L, py); ctx.lineTo(px, py); ctx.lineTo(px, py + dy * L);
      });
      ctx.stroke();
      ctx.fillStyle = `rgba(0,0,0,${0.45 * crop})`; ctx.fillRect(cx - w0 / 2, cy - h0 / 2, x - (cx - w0 / 2), h0); ctx.fillRect(x + cw, cy - h0 / 2, cx + w0 / 2 - x - cw, h0);
      ctx.restore();
    }

    // Plattformen unter den drei Clips
    if (k3 > 0.01) {
      ctx.save(); ctx.globalAlpha = k3; ctx.fillStyle = `rgba(${INK},.75)`; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.font = `500 ${mobile ? 9 : 10}px ui-monospace, Menlo, monospace`;
      [["TIKTOK", -1], ["REELS", 0], ["SHORTS", 1]].forEach(([t, d]) => ctx.fillText(t.split("").join(String.fromCharCode(8202)), cx + d * spread, cy + (d ? h * side : h) / 2 + 18));
      ctx.restore();
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

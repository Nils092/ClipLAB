// Imakio – Bewegung außerhalb der Bühne: Einblenden beim Scrollen, lebendige Funktions-Kacheln, schwebende Kopfzeile,
// Zähler, ClipLab-Schritte, Ideen-Funke, Rechner und die Morgendämmerung am Seitenende. Läuft ohne Bibliothek; ohne JavaScript bleibt alles sichtbar.
(() => {
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Hero-Überschrift: jedes Wort bekommt seinen eigenen Auftritt ----
  const splitHero = () => { const h1 = document.querySelector('.head[data-step="0"] h1'); if (!h1 || h1.querySelector(".w")) return; let i = 0;
    const wrap = (node) => { [...node.childNodes].forEach((ch) => {
      if (ch.nodeType === 3) { const frag = document.createDocumentFragment(); ch.textContent.split(/(\s+)/).forEach((part) => { if (!part) return; if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(" ")); return; }
          const sp = document.createElement("span"); sp.className = "w"; sp.style.setProperty("--i", i++); sp.textContent = part; frag.appendChild(sp); }); node.replaceChild(frag, ch); }
      else if (ch.nodeType === 1 && ch.tagName === "EM") { ch.classList.add("w"); ch.style.setProperty("--i", i++); } }); };
    wrap(h1); };
  splitHero(); addEventListener("langchange", () => setTimeout(splitHero, 0));

  // ---- Kopfzeile: schrumpft zur Glas-Leiste, sobald gescrollt wird ----
  const top = document.querySelector(".top");
  if (top) { const f = () => top.classList.toggle("scrolled", scrollY > 30); addEventListener("scroll", f, { passive: true }); f(); }

  // ---- Clip-Wand: nur im ersten Kapitel der Story sichtbar ----
  const wall = document.getElementById("clipwall"), first = document.querySelector('.head[data-step="0"]');
  if (wall && first) new MutationObserver(() => wall.classList.toggle("on", first.classList.contains("on"))).observe(first, { attributes: true, attributeFilter: ["class"] });

  // ---- Einblenden beim Scrollen: Überschriften gleiten hoch, Karten folgen gestaffelt ----
  const groups = [
    ".facts .statline > div", ".manifest .center > *", ".tri article", ".journey .center > *", ".spark .wrap > *", ".ideasky .center > *", ".ways-head > *", ".flow-col, .flow-core", ".product-head > *", ".stage-shots", ".row-head", ".bento article", ".case",
    ".usecases h2, .usecases .eyebrow", ".use", ".beta-box", ".prices .center > *", ".calc", ".price",
    ".post", ".faq > *", ".ring-stage > .center > *", ".numbers.strip > div", ".finale > *:not(.giant)"
  ];
  const items = [];
  groups.forEach((sel) => { const els = [...document.querySelectorAll(sel)]; els.forEach((el, i) => { el.style.setProperty("--d", Math.min(i, 7) * 70 + "ms"); items.push(el); }); });
  const live = [...document.querySelectorAll(".bento article, .case")];           // Kacheln mit eigener Mini-Animation
  if (reduce || !("IntersectionObserver" in window)) { live.forEach((el) => el.classList.add("in")); }
  else {
    items.forEach((el) => el.classList.add("rv"));
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target; io.unobserve(el); el.classList.add("in");
      setTimeout(() => el.classList.remove("rv"), 1500);                            // danach gelten wieder die normalen Hover-Übergänge
    }), { threshold: 0.15, rootMargin: "0px 0px -6% 0px" });
    items.forEach((el) => io.observe(el));
  }

  // ---- Rechner ----
  const $ = (id) => document.getElementById(id);
  const len = $("cLen"), vid = $("cVid"), min = $("cMin");
  if (len && vid && min) {
    const fmt = (n) => n.toLocaleString("de-DE", { maximumFractionDigits: 1 });
    const calc = () => {
      const L = +len.value, V = +vid.value, M = +min.value;
      const clips = Math.max(1, Math.round((L / 60) * 6 * V)), hours = clips * M / 60;
      $("oLen").textContent = L + " min"; $("oVid").textContent = V; $("oMin").textContent = M + " min";
      $("rClips").textContent = "≈ " + clips; $("rHours").textContent = "≈ " + fmt(hours) + " h";
      [len, vid, min].forEach((r) => r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min)) * 100 + "%"));
    };
    [len, vid, min].forEach((r) => r.addEventListener("input", calc)); calc();
  }
  // ---- Zahlen zählen hoch, sobald sie sichtbar werden ----
  const nums = [...document.querySelectorAll("[data-count]")];
  if (!reduce && "IntersectionObserver" in window) {
    const cio = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return; cio.unobserve(e.target);
      const el = e.target, end = Number(el.dataset.count), suf = el.dataset.suffix || "", t0 = performance.now();
      const tick = (now) => { const k = Math.min(1, (now - t0) / 1400); el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3))) + suf; if (k < 1) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }), { threshold: 0.6 });
    nums.forEach((n) => cio.observe(n));
  }

  // ---- ClipLab-Schritte rotieren automatisch (Klick wählt) ----
  const tabs = [...document.querySelectorAll("#stepTabs li")], shots = [...document.querySelectorAll("#stepShots .shot")];
  if (tabs.length) {
    let i = 0, timer;
    const show = (n) => { i = n % tabs.length; tabs.forEach((t, k) => t.classList.toggle("on", k === i)); shots.forEach((s, k) => s.classList.toggle("on", k === i)); };
    const loop = () => { clearInterval(timer); timer = setInterval(() => show(i + 1), 4500); };
    tabs.forEach((t, k) => t.querySelector("button").addEventListener("click", () => { show(k); loop(); }));
    if (!reduce) loop();
  }

  // ---- Ideen-Funke: "Was wäre, wenn …" zum Durchklicken; der alte Satz zerfällt in Lichtpunkte ----
  const L = () => (window.imakioLang && window.imakioLang.get() === "en" ? 1 : 0);
  const line = $("sparkLine"), note = $("sparkNote"), next = $("sparkNext"), mail = $("sparkMail"), fxc = $("sparkFx");
  if (line && next) {
    const IDEAS = [
      [["… jede gute Idee in einer Woche einen Prototyp hätte?", ""], ["… every good idea had a prototype within a week?", ""]],
      [["… ein Stream sich selbst in Clips schneiden würde?", "Gibt es schon: ClipLab, unser erstes Projekt."], ["… a stream could cut itself into clips?", "Already exists: ClipLab, our first project."]],
      [["… dein Kalender wüsste, wann du wirklich Zeit hast?", ""], ["… your calendar knew when you really have time?", ""]],
      [["… aus jeder Sprachnachricht von selbst eine To-do-Liste würde?", ""], ["… every voice message turned itself into a to-do list?", ""]],
      [["… dein Kühlschrank dir sagt, was du heute daraus kochen kannst?", ""], ["… your fridge told you what you can cook from it today?", ""]],
      [["… ein Verein seine Helfer in einer Minute organisiert?", ""], ["… a club could organise its volunteers in one minute?", ""]],
      [["… Rechnungen sich selbst sortieren?", ""], ["… invoices sorted themselves?", ""]],
      [["… ein Stadtplan zeigt, wo gerade etwas los ist?", ""], ["… a city map showed where something is happening right now?", ""]],
      [["… Lernen sich anfühlt wie ein Spiel, das man nicht weglegen will?", ""], ["… learning felt like a game you can’t put down?", ""]],
      [["… Nachbarn Werkzeug so leicht teilen wie Fotos?", ""], ["… neighbours shared tools as easily as photos?", ""]],
      [["… ein Laden in Mainz so einfach online verkauft wie ein Konzern?", ""], ["… a small shop sold online as easily as a corporation?", ""]],
      [["… deine Idee die nächste auf dieser Seite wäre?", "Schreib sie uns – genau dafür gibt es imakio."], ["… your idea was the next one on this page?", "Send it to us – that’s what imakio is for."]]
    ];
    let n = 0, parts = [], raf = 0;
    const burst = () => {                                       // Lichtpunkte fliegen aus dem alten Satz heraus
      if (!fxc || reduce) return;
      const sec = fxc.parentElement.getBoundingClientRect(), r = line.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      fxc.width = sec.width * dpr; fxc.height = sec.height * dpr;
      const cols = ["255,199,158", "255,143,189", "167,149,255", "127,240,218", "255,250,240"];
      for (let i = 0; i < 130; i++) { const a = Math.random() * 6.283, v = 40 + Math.random() * 220;
        parts.push({ x: r.left - sec.left + Math.random() * r.width, y: r.top - sec.top + Math.random() * r.height, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0, max: 0.7 + Math.random() * 0.7, s: 1 + Math.random() * 2.2, c: cols[i % 5] }); }
      const ctx = fxc.getContext("2d"); let last = performance.now();
      cancelAnimationFrame(raf);
      const step = (now) => { const dt = Math.min(0.05, (now - last) / 1000); last = now; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, sec.width, sec.height);
        parts = parts.filter((p) => (p.life += dt) < p.max);
        for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy = p.vy * 0.96 + 30 * dt; const k = 1 - p.life / p.max;
          ctx.fillStyle = `rgba(${p.c},${k.toFixed(3)})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (0.4 + k), 0, 6.283); ctx.fill(); }
        if (parts.length) raf = requestAnimationFrame(step); else ctx.clearRect(0, 0, sec.width, sec.height); };
      raf = requestAnimationFrame(step);
    };
    const set = (i, fx) => {
      n = (i + IDEAS.length) % IDEAS.length; const [txt, hint] = IDEAS[n][L()];
      if (fx) burst();
      line.classList.remove("show"); void line.offsetWidth;
      line.textContent = txt; note.textContent = hint || " "; line.classList.add("show");
      if (mail) mail.href = "mailto:info@imakio.de?subject=" + encodeURIComponent(L() ? "Idea for imakio" : "Idee für imakio") + "&body=" + encodeURIComponent((L() ? "What if " : "Was wäre, wenn ") + txt.replace(/^…\s*/, "") + "\n\n");
    };
    next.addEventListener("click", () => set(n + 1, true));
    addEventListener("langchange", () => set(n, false));
    set(0, false);
  }

  // ---- Himmel: richtet sich nach der Ortszeit des Besuchers; Richtung Seitenende zieht die Dämmerung auf; Wolken ziehen mit dem Scrollen ----
  const sky = document.querySelector(".sky");
  if (sky) {
    const hNow = new Date().getHours(), mode = hNow >= 5 && hNow < 9 ? "morning" : hNow >= 9 && hNow < 17 ? "day" : hNow >= 17 && hNow < 21 ? "evening" : "night";
    document.body.dataset.sky = mode;
    const base = { morning: 0.35, day: 0, evening: 0.2, night: 0 }[mode];
    const names = { morning: ["Morgenhimmel", "Morning sky"], day: ["Taghimmel", "Daytime sky"], evening: ["Abendhimmel", "Evening sky"], night: ["Nachthimmel", "Night sky"] }[mode];
    const brand = document.querySelector(".foot-brand");
    if (brand) { const chip = document.createElement("span"); chip.className = "skychip"; brand.appendChild(chip);
      const paint = () => { chip.textContent = "✦ " + names[L()] + (L() ? " · set to your local time" : " · nach deiner Ortszeit"); }; paint(); addEventListener("langchange", paint); }
    const day = () => { const max = document.documentElement.scrollHeight - innerHeight, p = max > 0 ? scrollY / max : 0;
      sky.style.setProperty("--day", Math.min(1, base + Math.max(0, (p - 0.55) / 0.45)).toFixed(3)); sky.style.setProperty("--sy", scrollY.toFixed(0)); };
    addEventListener("scroll", day, { passive: true }); addEventListener("resize", day); day();
  }

  // ---- Überschriften schreiben sich mit Licht: das kursive Akzentwort deckt sich von links nach rechts auf ----
  const ems = [...document.querySelectorAll("main section h2 em, main section h1 em")];
  if (!reduce && "IntersectionObserver" in window) {
    ems.forEach((e) => e.classList.add("unlit"));
    // beobachtet wird die Überschrift selbst – ein per clip-path verdecktes Wort zählt für den Browser nicht als sichtbar
    const eio = new IntersectionObserver((en) => en.forEach((e) => { if (e.isIntersecting) { eio.unobserve(e.target); e.target.querySelectorAll("em").forEach((m) => m.classList.add("lit")); } }), { threshold: 0.5 });
    [...new Set(ems.map((e) => e.closest("h1, h2")))].forEach((hd) => eio.observe(hd));
  }

  // ---- Reise-Zeitstrahl: die Route zeichnet sich mit dem Scrollen, der Papierflieger fliegt voraus ----
  const route = $("route"), rl = $("routeLine"), plane = $("routePlane");
  if (route && rl && rl.getTotalLength) {
    const len = rl.getTotalLength(), stops = [...route.querySelectorAll(".stops li")];
    rl.style.strokeDasharray = len;
    const draw = () => { const r = route.getBoundingClientRect(), p = reduce ? 1 : Math.min(1, Math.max(0, (innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.35)));
      rl.style.strokeDashoffset = (len * (1 - p)).toFixed(1);
      const pt = rl.getPointAtLength(len * p), pt2 = rl.getPointAtLength(Math.min(len, len * p + 4)), ang = Math.atan2((pt2.y - pt.y) * r.height / 300, (pt2.x - pt.x) * r.width / 1000) * 180 / Math.PI;
      plane.style.transform = `translate(${(pt.x / 1000 * r.width).toFixed(1)}px, ${(pt.y / 300 * r.height).toFixed(1)}px) rotate(${(ang + 45).toFixed(1)}deg)`;
      stops.forEach((s, i) => s.classList.toggle("on", p >= [0.02, 0.24, 0.5, 0.74, 0.97][i])); };
    addEventListener("scroll", draw, { passive: true }); addEventListener("resize", draw); draw();
  }

  // ---- Ideen-Himmel: jede freigegebene Idee aus ideen.json ist ein Stern ----
  const field = $("starfield"), read = $("starRead");
  if (field && read) {
    fetch("ideen.json").then((r) => r.json()).then((list) => {
      let seed = 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const show = (it, el) => { field.querySelectorAll(".on").forEach((x) => x.classList.remove("on")); el.classList.add("on");
        read.querySelector("b").textContent = (L() && it.text_en) ? it.text_en : it.text; read.querySelector("span").textContent = [it.name, it.ort].filter(Boolean).join(" · "); read.classList.remove("show"); void read.offsetWidth; read.classList.add("show"); };
      list.forEach((it, i) => { const b = document.createElement("button"); b.type = "button"; b.className = "star"; b.setAttribute("aria-label", it.text);
        b.style.left = (6 + ((i + 0.5) / list.length) * 88 + (rnd() - 0.5) * 5).toFixed(1) + "%"; b.style.top = (12 + rnd() * 72).toFixed(1) + "%"; b.style.setProperty("--s", (0.7 + rnd() * 0.9).toFixed(2)); b.style.animationDelay = (-rnd() * 4).toFixed(1) + "s";
        b.addEventListener("pointerenter", () => show(it, b)); b.addEventListener("focus", () => show(it, b)); b.addEventListener("click", () => show(it, b)); field.appendChild(b); });
      for (let i = 0; i < 46; i++) { const d = document.createElement("i"); d.style.left = (rnd() * 100).toFixed(1) + "%"; d.style.top = (rnd() * 100).toFixed(1) + "%"; d.style.animationDelay = (-rnd() * 5).toFixed(1) + "s"; field.appendChild(d); }
    }).catch(() => { field.parentElement.parentElement.hidden = true; });
  }

  // ---- Was wir bauen: Scroll-Showcase ----
  const waysPin = document.querySelector(".ways-pin"), wItems = [...document.querySelectorAll(".ways-list li")], wPanels = [...document.querySelectorAll(".wp")];
  if (waysPin && wItems.length) {
    const desk = matchMedia("(min-width: 861px)"); let cur = -1, timer = null, t0 = 0;
    const show = (i, p) => { if (i !== cur) { cur = i; wItems.forEach((li, k) => li.classList.toggle("on", k === i)); wPanels.forEach((pn, k) => pn.classList.toggle("on", k === i)); } if (wItems[i]) wItems[i].style.setProperty("--p", (p * 100).toFixed(1) + "%"); };
    const onScroll = () => { if (!desk.matches) return; const r = waysPin.getBoundingClientRect(), total = waysPin.offsetHeight - innerHeight, pr = Math.min(0.9999, Math.max(0, -r.top / Math.max(1, total))) * wItems.length; show(Math.floor(pr), pr % 1); };
    const auto = () => { clearInterval(timer); if (desk.matches || reduce) return; t0 = performance.now(); timer = setInterval(() => { const p = (performance.now() - t0) / 5000; if (p >= 1) { t0 = performance.now(); show((cur + 1) % wItems.length, 0); } else show(cur, p); }, 50); };
    wItems.forEach((li, k) => li.querySelector("button").addEventListener("click", () => {
      if (desk.matches) { const top = waysPin.getBoundingClientRect().top + scrollY, total = waysPin.offsetHeight - innerHeight; scrollTo({ top: top + total * (k + 0.15) / wItems.length, behavior: reduce ? "auto" : "smooth" }); }
      else { show(k, 0); auto(); li.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); }
    }));
    addEventListener("scroll", onScroll, { passive: true }); desk.addEventListener("change", () => { onScroll(); auto(); });
    show(0, 0); onScroll(); auto();
  }
})();

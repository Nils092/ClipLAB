// Imakio – Bewegung außerhalb der Bühne: Einblenden beim Scrollen, lebendige Funktions-Kacheln, schwebende Kopfzeile,
// Zähler, ClipLab-Schritte, Ideen-Funke, Rechner und die Morgendämmerung am Seitenende. Läuft ohne Bibliothek; ohne JavaScript bleibt alles sichtbar.
(() => {
  "use strict";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- Kopfzeile: schrumpft zur Glas-Leiste, sobald gescrollt wird ----
  const top = document.querySelector(".top");
  if (top) { const f = () => top.classList.toggle("scrolled", scrollY > 30); addEventListener("scroll", f, { passive: true }); f(); }

  // ---- Clip-Wand: nur im ersten Kapitel der Story sichtbar ----
  const wall = document.getElementById("clipwall"), first = document.querySelector('.head[data-step="0"]');
  if (wall && first) new MutationObserver(() => wall.classList.toggle("on", first.classList.contains("on"))).observe(first, { attributes: true, attributeFilter: ["class"] });

  // ---- Einblenden beim Scrollen: Überschriften gleiten hoch, Karten folgen gestaffelt ----
  const groups = [
    ".facts .statline > div", ".manifest .center > *", ".tri article", ".spark .wrap > *", ".product-head > *", ".stage-shots", ".row-head", ".bento article", ".case",
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

  // ---- Ideen-Funke: "Was wäre, wenn …" zum Durchklicken ----
  const line = $("sparkLine"), note = $("sparkNote"), next = $("sparkNext"), mail = $("sparkMail");
  if (line && next) {
    const IDEAS = [
      ["… jede gute Idee in einer Woche einen Prototyp hätte?", ""],
      ["… ein Stream sich selbst in Clips schneiden würde?", "Gibt es schon: ClipLab, unser erstes Projekt."],
      ["… dein Kalender wüsste, wann du wirklich Zeit hast?", ""],
      ["… aus jeder Sprachnachricht von selbst eine To-do-Liste würde?", ""],
      ["… dein Kühlschrank dir sagt, was du heute daraus kochen kannst?", ""],
      ["… ein Verein seine Helfer in einer Minute organisiert?", ""],
      ["… Rechnungen sich selbst sortieren?", ""],
      ["… ein Stadtplan zeigt, wo gerade etwas los ist?", ""],
      ["… Lernen sich anfühlt wie ein Spiel, das man nicht weglegen will?", ""],
      ["… Nachbarn Werkzeug so leicht teilen wie Fotos?", ""],
      ["… ein Laden in Mainz so einfach online verkauft wie ein Konzern?", ""],
      ["… deine Idee die nächste auf dieser Seite wäre?", "Schreib sie uns – genau dafür gibt es imakio."]
    ];
    let n = 0;
    const set = (i) => {
      n = (i + IDEAS.length) % IDEAS.length; const [txt, hint] = IDEAS[n];
      line.classList.remove("show"); void line.offsetWidth;
      line.textContent = txt; note.textContent = hint || " "; line.classList.add("show");
      if (mail) mail.href = "mailto:info@imakio.de?subject=" + encodeURIComponent("Idee für imakio") + "&body=" + encodeURIComponent("Was wäre, wenn " + txt.replace(/^…\s*/, "") + "\n\nMeine Gedanken dazu:\n");
    };
    next.addEventListener("click", () => set(n + 1)); line.classList.add("show");
    if (mail) set(0);
  }

  // ---- Himmel: Richtung Seitenende zieht die Morgendämmerung auf ----
  const sky = document.querySelector(".sky");
  if (sky) { const day = () => { const max = document.documentElement.scrollHeight - innerHeight; const p = max > 0 ? scrollY / max : 0; sky.style.setProperty("--day", Math.max(0, (p - 0.55) / 0.45).toFixed(3)); };
    addEventListener("scroll", day, { passive: true }); addEventListener("resize", day); day(); }
})();

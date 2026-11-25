// Imakio – Bewegung außerhalb der Bühne: Einblenden beim Scrollen, lebendige Funktions-Kacheln, schwebende Kopfzeile,
// Clip-Wand im ersten Kapitel und der Rechner. Läuft ohne Bibliothek; ohne JavaScript bleibt alles sichtbar.
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
    ".facts .statline > div", ".product-head > *", ".stage-shots", ".row-head", ".bento article", ".case",
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
})();

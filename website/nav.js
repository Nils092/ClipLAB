// Kopfzeile auf allen Seiten: Burger-Menü auf dem Handy (Vollbild-Overlay) und aktiver Menüpunkt beim Scrollen.
(() => {
  "use strict";
  const top = document.querySelector(".top"), nav = top && top.querySelector(".nav");
  if (!top || !nav) return;

  // ---- Burger-Knopf: öffnet die Navigation als Overlay ----
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "burger"; btn.setAttribute("aria-label", "Menü öffnen"); btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = "<i></i><i></i><i></i>";
  nav.id = nav.id || "mainnav"; btn.setAttribute("aria-controls", nav.id);
  top.insertBefore(btn, nav);
  const open = (on) => {
    document.body.classList.toggle("nav-open", on);
    btn.setAttribute("aria-expanded", String(on)); btn.setAttribute("aria-label", on ? "Menü schließen" : "Menü öffnen");
    if (on) (nav.querySelector("a") || btn).focus({ preventScroll: true });
  };
  btn.addEventListener("click", () => open(!document.body.classList.contains("nav-open")));
  nav.addEventListener("click", (e) => { if (e.target.closest("a")) open(false); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("nav-open")) { open(false); btn.focus(); } });
  matchMedia("(min-width: 761px)").addEventListener("change", (e) => { if (e.matches) open(false); });

  // ---- Aktiver Menüpunkt: der Abschnitt, der gerade im Bild ist ----
  const links = [...nav.querySelectorAll('a[href^="#"]')];
  const targets = links.map((a) => document.getElementById(a.getAttribute("href").slice(1))).filter(Boolean);
  if (!targets.length) return;
  const mark = () => {
    const y = innerHeight * 0.35; let cur = null;
    for (const t of targets) { const r = t.getBoundingClientRect(); if (r.top <= y && r.bottom > y) cur = t; }
    links.forEach((a) => a.classList.toggle("on", !!cur && a.getAttribute("href") === "#" + cur.id));
  };
  addEventListener("scroll", mark, { passive: true }); mark();
})();

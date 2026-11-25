// imakio – Atelier: Gestaltungsvarianten live ausprobieren (Farbwelt, Akzent, Schrift, Bildsprache, Aufbau, Cursor, Klang).
// Jede Wahl landet als data-Attribut auf <body>; style.css und app.js reagieren darauf. Gemerkt wird sie im Browser des Besuchers.
// Standard = die aktuelle Seite. ?atelier=0 blendet den Knopf aus, ?atelier=1 öffnet das Feld direkt.
(() => {
  "use strict";
  const body = document.body, btn = document.getElementById("atelierBtn"), box = document.getElementById("atelier");
  if (!btn || !box) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DEF = { theme: "nacht", accent: "verlauf", font: "serif", fig: "punkte", world: "kugel", map: true, lower: false, illu: false, foto: false, split: false, big: false, tilt: false, cursor: false, sound: false };
  let st = { ...DEF };
  try { st = { ...DEF, ...JSON.parse(localStorage.getItem("imakio-atelier") || "{}") }; } catch (e) {}
  const q = new URLSearchParams(location.search);
  if (q.get("atelier") === "0") { btn.hidden = true; }

  const apply = () => {
    Object.entries(st).forEach(([k, v]) => { if (typeof v === "boolean") { v ? (body.dataset[k] = "") : delete body.dataset[k]; } else body.dataset[k] = v; });
    box.querySelectorAll("input").forEach((i) => { i.checked = i.type === "radio" ? st[i.name] === i.value : !!st[i.name]; });
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = { nacht: "#06071A", morgen: "#FFF1E4", tiefsee: "#03202A", papier: "#F4EEDF", blau: "#050505", weiss: "#FFFFFF", silber: "#050505", eis: "#04060C", gold: "#05070F", cyan: "#030508", elfenbein: "#070707", lime: "#050505", petrol: "#1C1F22" }[st.theme];
    try { localStorage.setItem("imakio-atelier", JSON.stringify(st)); } catch (e) {}
  };
  box.addEventListener("change", (e) => { const i = e.target; st[i.name] = i.type === "radio" ? i.value : i.checked; apply(); if (i.name === "sound" && i.checked) chime(660); });
  const open = (on) => { box.hidden = !on; btn.setAttribute("aria-expanded", String(on)); body.classList.toggle("atelier-open", on); if (on) box.querySelector("input:checked, input").focus({ preventScroll: true }); };
  btn.addEventListener("click", () => open(box.hidden));
  document.getElementById("atelierX").addEventListener("click", () => { open(false); btn.focus(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !box.hidden) { open(false); btn.focus(); } });
  document.getElementById("atelierReset").addEventListener("click", () => { st = { ...DEF }; apply(); note("Zurück auf den Ausgangszustand."); });
  const note = (t) => { const n = document.getElementById("atelierNote"); n.textContent = t; clearTimeout(note.t); note.t = setTimeout(() => (n.textContent = ""), 3500); };
  document.getElementById("atelierCopy").addEventListener("click", () => {
    const names = { theme: "Farbwelt", accent: "Akzent", font: "Überschriften", fig: "Bildsprache", world: "Welt-Kapitel" };
    const txt = Object.entries(st).filter(([k, v]) => v !== DEF[k] || names[k]).map(([k, v]) => (names[k] ? `${names[k]}: ${v}` : `${k}: ${v ? "an" : "aus"}`)).join(" · ");
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => note("Kopiert – schick mir das einfach in den Chat."), () => note(txt));
  });
  apply();
  if (q.get("atelier") === "1") open(true);

  // ---- Karten kippen zur Maus, mit Lichtreflex ----
  const TILT = ".tri article, .note, .price, .use, .bento article, .post, .pf";
  document.addEventListener("pointermove", (e) => {
    if (!("tilt" in body.dataset) || reduce) return;
    const card = e.target.closest && e.target.closest(TILT); if (!card) return;
    const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    card.style.setProperty("--tx", (y * -9).toFixed(2) + "deg"); card.style.setProperty("--ty", (x * 11).toFixed(2) + "deg");
    card.style.setProperty("--gx", ((x + 0.5) * 100).toFixed(1) + "%"); card.style.setProperty("--gy", ((y + 0.5) * 100).toFixed(1) + "%"); card.classList.add("tilting");
  }, { passive: true });
  document.addEventListener("pointerout", (e) => { const card = e.target.closest && e.target.closest(TILT); if (card && !card.contains(e.relatedTarget)) { card.classList.remove("tilting"); card.style.removeProperty("--tx"); card.style.removeProperty("--ty"); } });

  // ---- Licht-Cursor: ein Punkt mit Schweif aus kleinen Funken ----
  const lc = document.querySelector(".lightcursor"), dot = lc && lc.querySelector("i");
  if (lc && !matchMedia("(hover: none)").matches) {
    const trail = []; let x = -99, y = -99, sx = -99, sy = -99;
    for (let i = 0; i < 10; i++) { const t = document.createElement("b"); lc.appendChild(t); trail.push({ el: t, x: -99, y: -99 }); }
    addEventListener("pointermove", (e) => { x = e.clientX; y = e.clientY; }, { passive: true });
    const loop = () => {
      if ("cursor" in body.dataset) {
        sx += (x - sx) * 0.35; sy += (y - sy) * 0.35; dot.style.transform = `translate(${sx}px, ${sy}px)`;
        let px = sx, py = sy; trail.forEach((t, i) => { t.x += (px - t.x) * (0.42 - i * 0.025); t.y += (py - t.y) * (0.42 - i * 0.025); t.el.style.transform = `translate(${t.x}px, ${t.y}px) scale(${1 - i / 11})`; px = t.x; py = t.y; });
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    document.addEventListener("pointerover", (e) => lc.classList.toggle("hot", !!(e.target.closest && e.target.closest("a, button, label, input, .star, canvas"))));
  }

  // ---- Klang: weiche Glockentöne, nur wenn eingeschaltet ----
  let ac = null;
  function chime(freq = 880, len = 0.9, vol = 0.12) {
    if (!("sound" in body.dataset)) return;
    try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    const t = ac.currentTime, g = ac.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + len); g.connect(ac.destination);
    [1, 2.01, 3.02].forEach((m, i) => { const o = ac.createOscillator(); o.type = "sine"; o.frequency.value = freq * m; const og = ac.createGain(); og.gain.value = [1, 0.35, 0.12][i]; o.connect(og); og.connect(g); o.start(t); o.stop(t + len); });
  }
  const NOTES = [523, 587, 659, 784, 880, 988, 1047];
  document.addEventListener("click", (e) => { if (e.target.closest("#sparkNext")) chime(NOTES[Math.floor(Math.random() * 7)], 1.2); else if (e.target.closest(".pill, .lang")) chime(784, 0.5, 0.06); });
  document.addEventListener("pointerover", (e) => { const s = e.target.closest && e.target.closest(".star"); if (s && s !== chime.last) { chime.last = s; chime(NOTES[[...s.parentNode.children].indexOf(s) % 7] * 2, 0.8, 0.07); } });
})();

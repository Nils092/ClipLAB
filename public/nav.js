// ClipLab App-Rahmen: Seitenleiste mit Werkzeugen (Desktop) bzw. Tab-Leiste unten (Handy).
// Wird von allen Seiten eingebunden; angemeldete Nutzer sehen die Werkzeuge, Gäste nur das Logo.
(() => {
  const TOOLS = [
    ["/start", "Start", "M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z"],
    ["/auto", "Auto-Clips", "M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zm3 5v6l5-3z"],
    ["/studio", "Studio", "M4 6h16v12H4zM8 6v12M16 6v12M4 10h4M4 14h4M16 10h4M16 14h4"],
    ["/posten", "Direkt posten", "M12 3v12m0-12 4 4m-4-4-4 4M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4"],
    ["/", "Protokoll", "M4 5h16M4 12h16M4 19h10"],
  ];
  const BOTTOM = [["/einstellungen", "Einstellungen", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7-3 2-1-1-3-2.3.4a7 7 0 0 0-1.5-1.5L16.5 4h-3l-.4 2.3a7 7 0 0 0-1.5.1L9 4H6L5 7l1.7 1.6A7 7 0 0 0 5.2 10L3 10v3l2.2.4a7 7 0 0 0 1.5 1.5L5 17l3 2 .4-2.3a7 7 0 0 0 2.1 0L11 19l3-2-1.7-2.1"]];
  const here = location.pathname.replace(/\.html$/, "").replace(/\/index$/, "/") || "/";

  const css = document.createElement("style");
  css.textContent = `
  :root { --cl-side: 232px; }
  body.cl-shell { padding-left: calc(var(--cl-side) + 28px) !important; }
  .clside { position: fixed; left: 0; top: 0; bottom: 0; width: var(--cl-side); z-index: 60; display: flex; flex-direction: column; gap: 6px;
    padding: calc(18px + env(safe-area-inset-top, 0px)) 14px calc(16px + env(safe-area-inset-bottom, 0px)) max(14px, env(safe-area-inset-left, 0px));
    background: rgba(14,14,14,.78); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); border-right: 1px solid rgba(255,255,255,.12); font: 500 14px/1 "Poppins", "Avenir Next", "Segoe UI", system-ui, sans-serif; color: #F4F4F4; }
  .clside .logo { display: flex; align-items: center; gap: 8px; font: 700 22px/1 "Poppins", system-ui, sans-serif; letter-spacing: -0.045em; color: #F4F4F4; text-decoration: none; padding: 6px 10px 18px; }
  .clside .logo b { border-bottom: 3px solid currentColor; padding-bottom: 1px; }
  .clside .test { font: 700 10px/1 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .12em; color: #0A0A0A; background: #E8C37A; padding: 5px 7px; border-radius: 999px; }
  .clside.is-test { border-right-color: #E8C37A; }
  .clside .sec { font: 500 10.5px/1 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .14em; text-transform: uppercase; color: #6F6F6F; padding: 10px 12px 6px; }
  .clside a.t { display: flex; align-items: center; gap: 12px; color: #BDBDBD; text-decoration: none; padding: 11px 12px; border-radius: 10px; }
  .clside a.t svg { width: 20px; height: 20px; flex: none; }
  .clside a.t:hover { color: #F4F4F4; background: rgba(255,255,255,.06); }
  .clside a.t[aria-current="page"] { background: #F4F4F4; color: #0A0A0A; }
  .clside .grow { flex: 1; }
  .clside .who { font-size: 12.5px; color: #8F8F8F; padding: 8px 12px 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .clside button { font: inherit; color: #BDBDBD; background: transparent; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; padding: 9px 14px; cursor: pointer; margin: 4px 8px 0; }
  .clside button:hover { color: #F4F4F4; border-color: #F4F4F4; }
  .clside :focus-visible { outline: 2px solid #F4F4F4; outline-offset: 2px; }
  .clside .guest { display: none; }
  .clside.is-guest { width: 100%; position: sticky; bottom: auto; height: auto; flex-direction: row; align-items: center; border-right: 0; border-bottom: 1px solid rgba(255,255,255,.12); padding: calc(10px + env(safe-area-inset-top, 0px)) 16px 10px; }
  .clside.is-guest .logo { padding: 0; }
  .clside.is-guest .sec, .clside.is-guest a.t, .clside.is-guest .who, .clside.is-guest button { display: none; }
  body.cl-guest { padding-left: max(16px, env(safe-area-inset-left, 0px)) !important; }
  @media (max-width: 760px) {
    body.cl-shell { padding-left: max(16px, env(safe-area-inset-left, 0px)) !important; padding-bottom: calc(86px + env(safe-area-inset-bottom, 0px)) !important; }
    .clside { top: auto; width: 100%; height: auto; flex-direction: row; align-items: stretch; gap: 0; padding: 6px 6px calc(6px + env(safe-area-inset-bottom, 0px));
      border-right: 0; border-top: 1px solid rgba(255,255,255,.12); background: rgba(10,10,10,.92); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
    .clside .logo, .clside .sec, .clside .who, .clside .grow, .clside button { display: none; }
    .clside a.t { flex: 1; flex-direction: column; gap: 5px; padding: 8px 4px; font-size: 10.5px; text-align: center; border-radius: 10px; }
    .clside a.t svg { width: 22px; height: 22px; }
    .clside.is-guest { top: 0; bottom: auto; border-top: 0; border-bottom: 1px solid rgba(255,255,255,.12); }
    .clside.is-guest .logo { display: flex; }
    body.cl-guest { padding-bottom: 56px !important; }
  }`;
  document.head.append(css);

  const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const side = document.createElement("nav");
  side.className = "clside is-guest";
  side.setAttribute("aria-label", "Hauptnavigation");
  const link = ([href, label, d]) => `<a class="t" href="${href}"${here === href ? ' aria-current="page"' : ""}>${icon(d)}<span>${label}</span></a>`;
  side.innerHTML = `
    <a class="logo" href="/start" aria-label="ClipLab Startseite">Clip<b>Lab</b></a>
    <div class="sec">Werkzeuge</div>
    ${TOOLS.map(link).join("")}
    <div class="grow"></div>
    ${BOTTOM.map(link).join("")}
    <div class="who"></div>
    <button type="button" class="out">Abmelden</button>`;
  side.querySelector(".out").onclick = async () => { await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {}); location.href = "/"; };

  const place = () => { document.body.prepend(side); document.body.classList.add("cl-guest"); };
  if (document.body) place(); else document.addEventListener("DOMContentLoaded", place);

  const apply = (s) => {
    const on = Boolean(s && s.user);
    side.classList.toggle("is-guest", !on);
    document.body.classList.toggle("cl-shell", on);
    document.body.classList.toggle("cl-guest", !on);
    if (on) side.querySelector(".who").textContent = s.user.name;
    if (s && s.env === "test" && !side.querySelector(".test")) {
      side.classList.add("is-test");
      const t = document.createElement("span"); t.className = "test"; t.textContent = "TEST"; t.title = "Testversion";
      side.querySelector(".logo").append(t);
      document.title = "TEST · " + document.title;
    }
  };
  // Neue Version erkannt → Seite einmal neu laden, damit alle Teile zusammenpassen
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.type === "cliplab-updated" && !sessionStorage.getItem("cl-reloaded-" + e.data.cache)) {
        sessionStorage.setItem("cl-reloaded-" + e.data.cache, "1"); location.reload();
      }
    });
    navigator.serviceWorker.getRegistration().then((r) => r && r.update().catch(() => {}));
  }
  const load = () => fetch("/api/session", { credentials: "same-origin" }).then((r) => r.json()).then(apply).catch(() => {});
  load();
  window.clipLabNav = { refresh: load };
})();

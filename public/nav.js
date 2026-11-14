// ClipLab App-Rahmen: Kopfleiste mit Menü in der Mitte (Desktop) bzw. Tab-Leiste unten (Handy).
// Rechts: laufender Scan (Prozent) und das Konto-Menü mit Kampagnen, Protokoll, Accounts.
// Wird von allen Seiten eingebunden; angemeldete Nutzer sehen das Menü, Gäste nur das Logo.
(() => {
  const TOOLS = [
    ["/home", "Home", "M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"],
    ["/streams", "Streams", "M4 6h16v10H4zM9 20h6M12 16v4M10 9v4l4-2z"],
    ["/auto", "Clips", "M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zm3 5v6l5-3z"],
  ];
  const MENU = [
    ["/auto#kampagnen", "Kampagnen"],
    ["/auto#agent", "Clip-Agent"],
    ["/", "Protokoll"],
    ["/einstellungen", "Accounts"],
  ];
  const here = location.pathname.replace(/\.html$/, "").replace(/\/index$/, "/") || "/";

  const css = document.createElement("style");
  css.textContent = `
  :root { --cl-top: 68px; }
  body.cl-shell { padding-top: calc(var(--cl-top) + 22px + env(safe-area-inset-top, 0px)) !important; }
  [data-pid] { scroll-margin-top: calc(var(--cl-top) + 16px); }
  .cltop { position: fixed; left: 0; right: 0; top: 0; z-index: 60; height: calc(var(--cl-top) + env(safe-area-inset-top, 0px)); display: flex; align-items: center; gap: 12px;
    padding: env(safe-area-inset-top, 0px) max(18px, env(safe-area-inset-right, 0px)) 0 max(18px, env(safe-area-inset-left, 0px));
    background: rgba(10,10,10,.84); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); border-bottom: 1px solid rgba(255,255,255,.07); font: 500 14px/1 "Poppins", "Avenir Next", "Segoe UI", system-ui, sans-serif; color: #F4F4F4; pointer-events: none; }
  .cltop > * { pointer-events: auto; }
  .cltop .logo { display: flex; align-items: center; gap: 8px; font: 700 21px/1 "Poppins", system-ui, sans-serif; letter-spacing: -0.045em; color: #F4F4F4; text-decoration: none; flex: 1 1 0; min-width: 0; }
  .cltop .logo b { border-bottom: 3px solid currentColor; padding-bottom: 1px; }
  .cltop .test { font: 700 10px/1 ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: .12em; color: #0A0A0A; background: #E8C37A; padding: 5px 7px; border-radius: 999px; }
  .cltop .tabs { display: flex; gap: 2px; padding: 5px; border-radius: 999px; background: rgba(20,20,20,.82); border: 1px solid rgba(255,255,255,.12); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
  .cltop a.t { display: flex; align-items: center; gap: 8px; color: #BDBDBD; text-decoration: none; padding: 10px 18px; border-radius: 999px; white-space: nowrap; }
  .cltop a.t svg { display: none; width: 22px; height: 22px; flex: none; }
  .cltop a.t:hover { color: #F4F4F4; }
  .cltop a.t[aria-current="page"] { background: #F4F4F4; color: #0A0A0A; }
  .cltop .right { flex: 1 1 0; display: flex; justify-content: flex-end; align-items: center; gap: 8px; min-width: 0; }
  .cltop .scan { display: none; align-items: center; gap: 8px; text-decoration: none; color: #F4F4F4; font: 500 12.5px/1 ui-monospace, "SF Mono", Menlo, monospace; padding: 9px 13px; border-radius: 999px; border: 1px solid rgba(255,255,255,.35); background: rgba(20,20,20,.82); white-space: nowrap; }
  .cltop .scan.on { display: inline-flex; }
  .cltop .scan i { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(255,255,255,.25); border-top-color: #F4F4F4; animation: clspin 1s linear infinite; }
  @keyframes clspin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .cltop .scan i { animation: none; } }
  .cltop .me { font: inherit; color: #F4F4F4; background: rgba(20,20,20,.82); border: 1px solid rgba(255,255,255,.12); border-radius: 999px; padding: 6px 12px 6px 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; max-width: 200px; }
  .cltop .me:hover { border-color: #F4F4F4; }
  .cltop .me .av { width: 28px; height: 28px; border-radius: 50%; background: #F4F4F4; color: #0A0A0A; display: grid; place-items: center; font-weight: 700; font-size: 13px; flex: none; }
  .cltop .me .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cltop .menu { position: absolute; right: max(18px, env(safe-area-inset-right, 0px)); top: calc(var(--cl-top) - 6px + env(safe-area-inset-top, 0px)); min-width: 220px; padding: 8px; border-radius: 14px; background: rgba(18,18,18,.97); border: 1px solid rgba(255,255,255,.14); box-shadow: 0 18px 50px rgba(0,0,0,.6); display: none; flex-direction: column; gap: 2px; }
  .cltop .menu.open { display: flex; }
  .cltop .menu a, .cltop .menu button { font: inherit; text-align: left; display: block; width: 100%; white-space: nowrap; color: #D8D8D8; text-decoration: none; background: transparent; border: 0; padding: 11px 12px; border-radius: 9px; cursor: pointer; }
  .cltop .menu a:hover, .cltop .menu button:hover { background: rgba(255,255,255,.07); color: #fff; }
  .cltop .menu a[aria-current="page"] { color: #fff; background: rgba(255,255,255,.07); }
  .cltop .menu hr { border: 0; border-top: 1px solid rgba(255,255,255,.1); margin: 6px 4px; }
  .cltop .menu .by { font-size: 12px; color: #8F8F8F; }
  .cltop :focus-visible { outline: 2px solid #F4F4F4; outline-offset: 2px; }
  .cltop.is-guest .tabs, .cltop.is-guest .right { display: none; }
  .cltop.is-guest { position: sticky; background: transparent; border-bottom: 0; -webkit-backdrop-filter: none; backdrop-filter: none; }
  body.cl-guest { padding-top: 0 !important; }
  @media (max-width: 760px) {
    :root { --cl-top: 54px; }
    body.cl-shell { padding-bottom: calc(86px + env(safe-area-inset-bottom, 0px)) !important; }
    .cltop .tabs { position: fixed; left: 0; right: 0; bottom: 0; border-radius: 0; border: 0; border-top: 1px solid rgba(255,255,255,.12); background: rgba(10,10,10,.94); padding: 6px 6px calc(6px + env(safe-area-inset-bottom, 0px)); gap: 0; }
    .cltop a.t { flex: 1; flex-direction: column; gap: 5px; padding: 8px 4px; font-size: 10.5px; border-radius: 10px; justify-content: center; }
    .cltop a.t svg { display: block; }
    .cltop .me .nm { display: none; }
    .cltop .me { padding: 5px; }
  }`;
  document.head.append(css);

  const icon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const top = document.createElement("nav");
  top.className = "cltop is-guest";
  top.setAttribute("aria-label", "Hauptnavigation");
  const link = ([href, label, d]) => `<a class="t" href="${href}"${here === href ? ' aria-current="page"' : ""}>${icon(d)}<span>${label}</span></a>`;
  top.innerHTML = `
    <a class="logo" href="/home" aria-label="ClipLab Startseite">Clip<b>Lab</b></a>
    <div class="tabs">${TOOLS.map(link).join("")}</div>
    <div class="right">
      <a class="scan" href="/streams" aria-live="polite"><i aria-hidden="true"></i><span></span></a>
      <button type="button" class="me" aria-haspopup="true" aria-expanded="false" aria-label="Konto-Menü"><span class="av"></span><span class="nm"></span></button>
    </div>
    <div class="menu" role="menu">
      ${MENU.map(([href, label]) => `<a role="menuitem" href="${href}"${here === href ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
      <hr>
      <button type="button" role="menuitem" class="out">Abmelden</button>
      <a class="by" href="https://imakio.de">ein Projekt von imakio</a>
    </div>`;
  const menu = top.querySelector(".menu"), me = top.querySelector(".me");
  const openMenu = (on) => { menu.classList.toggle("open", on); me.setAttribute("aria-expanded", String(on)); };
  me.onclick = (e) => { e.stopPropagation(); openMenu(!menu.classList.contains("open")); };
  document.addEventListener("click", (e) => { if (!menu.contains(e.target)) openMenu(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") openMenu(false); });
  top.querySelector(".out").onclick = async () => { await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {}); location.href = "/"; };

  const place = () => { document.body.prepend(top); document.body.classList.add("cl-guest"); };
  if (document.body) place(); else document.addEventListener("DOMContentLoaded", place);

  // ---------- Laufender Scan: kleine Prozent-Anzeige oben rechts ----------
  const RUNNING = ["upload", "wartet", "download", "transkription", "analyse", "rendern"];
  const WEIGHT = { upload: [0, 0.05], wartet: [0, 0.02], download: [0.02, 0.4], transkription: [0.4, 0.6], analyse: [0.6, 0.66], rendern: [0.66, 1] };
  const overall = (p) => { const w = WEIGHT[p.status]; if (!w) return p.status === "fertig" ? 1 : 0; return w[0] + (w[1] - w[0]) * Math.min(1, Math.max(0, p.progress || 0)); };
  const scan = top.querySelector(".scan");
  let scanTimer = null;
  const pollScan = async () => {
    clearTimeout(scanTimer);
    let next = 30000;
    try {
      const r = await fetch("/api/projects", { credentials: "same-origin" });
      if (r.ok) {
        const run = ((await r.json()).projects || []).filter((p) => RUNNING.includes(p.status));
        scan.classList.toggle("on", run.length > 0);
        if (run.length) {
          const p = run[run.length - 1];   // ältestes läuft zuerst
          scan.querySelector("span").textContent = `${Math.round(overall(p) * 100)} % · ${p.step}${run.length > 1 ? ` · +${run.length - 1}` : ""}`;
          scan.href = `/streams#scan=${encodeURIComponent(p.id)}`;
          scan.title = p.name;
          next = 5000;
        }
      }
    } catch {}
    if (!document.hidden) scanTimer = setTimeout(pollScan, next);
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden && document.body.classList.contains("cl-shell")) pollScan(); });

  const apply = (s) => {
    const on = Boolean(s && s.user);
    top.classList.toggle("is-guest", !on);
    document.body.classList.toggle("cl-shell", on);
    document.body.classList.toggle("cl-guest", !on);
    if (on) {
      top.querySelector(".nm").textContent = s.user.name;
      top.querySelector(".av").textContent = String(s.user.name || "?").trim().charAt(0).toUpperCase();
      pollScan();
    }
    if (on && s.user.role === "admin" && !menu.querySelector('a[href="/admin"]')) {
      const a = document.createElement("a"); a.href = "/admin"; a.textContent = "Admin"; a.setAttribute("role", "menuitem");
      if (here === "/admin") a.setAttribute("aria-current", "page");
      menu.querySelector("hr").before(a);
    }
    if (s && s.env === "test" && !top.querySelector(".test")) {
      const t = document.createElement("span"); t.className = "test"; t.textContent = "TEST"; t.title = "Testversion";
      top.querySelector(".logo").append(t);
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
  // Kampagnen-Einladung: nach der Anmeldung automatisch beitreten
  const joinPending = (s) => {
    const m = document.cookie.match(/(?:^|; )cl_join=([^;]+)/); if (!s || !s.user || !m) return;
    fetch("/api/campaigns/join", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: decodeURIComponent(m[1]) }) })
      .then((r) => r.json()).then((j) => { document.cookie = "cl_join=; Max-Age=0; path=/"; if (j.campaign) location.href = `/auto?${new URLSearchParams({ meldung: `Du bist jetzt Clipper in der Kampagne „${j.campaign.name}“.` })}#kampagnen`; }).catch(() => {});
  };
  const load = () => fetch("/api/session", { credentials: "same-origin" }).then((r) => r.json()).then((s) => { apply(s); joinPending(s); }).catch(() => {});
  load();
  window.clipLabNav = { refresh: load, overall, pollScan };
})();

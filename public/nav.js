// Einheitliche Navigationsleiste oben auf allen ClipLab-Seiten (bleibt beim Scrollen stehen).
(() => {
  const LINKS = [["/", "Dashboard"], ["/auto", "Auto-Clips"], ["/studio", "Studio"]];
  const here = location.pathname.replace(/\.html$/, "").replace(/\/index$/, "/") || "/";

  const css = document.createElement("style");
  css.textContent = `
  .clnav { position: sticky; top: 0; z-index: 60; display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    padding: calc(10px + env(safe-area-inset-top, 0px)) max(16px, env(safe-area-inset-right, 0px)) 10px max(16px, env(safe-area-inset-left, 0px));
    background: rgba(10,10,10,.86); -webkit-backdrop-filter: saturate(140%) blur(14px); backdrop-filter: saturate(140%) blur(14px);
    border-bottom: 1px solid rgba(255,255,255,.12); font: 500 14px/1 "Poppins", "Avenir Next", "Segoe UI", system-ui, sans-serif; color: #F4F4F4; }
  .clnav .in { max-width: 1120px; margin: 0 auto; width: 100%; display: flex; align-items: center; gap: 14px; }
  .clnav .logo { font: 700 22px/1 "Poppins", system-ui, sans-serif; letter-spacing: -0.045em; color: #F4F4F4; text-decoration: none; margin-right: auto; white-space: nowrap; }
  .clnav .logo b { border-bottom: 3px solid currentColor; padding-bottom: 1px; }
  .clnav .links { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
  .clnav .links::-webkit-scrollbar { display: none; }
  .clnav a.l { color: #BDBDBD; text-decoration: none; padding: 8px 14px; border-radius: 999px; white-space: nowrap; border: 1px solid transparent; }
  .clnav a.l:hover { color: #F4F4F4; border-color: rgba(255,255,255,.2); }
  .clnav a.l[aria-current="page"] { background: #F4F4F4; color: #0A0A0A; }
  .clnav button { font: inherit; color: #BDBDBD; background: transparent; border: 1px solid rgba(255,255,255,.2); border-radius: 999px; padding: 8px 14px; cursor: pointer; white-space: nowrap; }
  .clnav button:hover { color: #F4F4F4; border-color: #F4F4F4; }
  .clnav :focus-visible { outline: 2px solid #F4F4F4; outline-offset: 2px; }
  @media (max-width: 560px) {
    .clnav .in { flex-wrap: wrap; row-gap: 10px; }
    .clnav .links { order: 3; width: 100%; }
    .clnav a.l { flex: 1; text-align: center; padding: 9px 8px; }
  }`;
  document.head.append(css);

  const nav = document.createElement("nav");
  nav.className = "clnav";
  nav.setAttribute("aria-label", "Hauptnavigation");
  const inner = document.createElement("div"); inner.className = "in";
  const logo = document.createElement("a"); logo.className = "logo"; logo.href = "/"; logo.innerHTML = "Clip<b>Lab</b>"; logo.setAttribute("aria-label", "ClipLab Startseite");
  const links = document.createElement("div"); links.className = "links"; links.hidden = true;
  for (const [href, label] of LINKS) {
    const a = document.createElement("a"); a.className = "l"; a.href = href; a.textContent = label;
    if (here === href) a.setAttribute("aria-current", "page");
    links.append(a);
  }
  const out = document.createElement("button"); out.type = "button"; out.textContent = "Abmelden"; out.hidden = true;
  out.onclick = async () => { await fetch("/api/logout", { method: "POST", credentials: "same-origin" }).catch(() => {}); location.href = "/"; };
  inner.append(logo, links, out);
  nav.append(inner);

  // Leiste ganz oben einsetzen und über den Seitenrand ziehen
  // (Abstände erst nach dem Laden der Seiten-Styles messen)
  const fit = () => {
    const cs = getComputedStyle(document.body);
    nav.style.margin = `-${cs.paddingTop} -${cs.paddingRight} 18px -${cs.paddingLeft}`;
  };
  const place = () => { document.body.prepend(nav); fit(); };
  if (document.body) place(); else document.addEventListener("DOMContentLoaded", place);
  document.addEventListener("DOMContentLoaded", fit);
  addEventListener("load", fit);

  // Links und Abmelden nur zeigen, wenn jemand angemeldet ist
  fetch("/api/session", { credentials: "same-origin" }).then((r) => r.json()).then((s) => {
    const on = Boolean(s && s.user);
    links.hidden = !on; out.hidden = !on;
    if (on) out.title = `Angemeldet als ${s.user.name}`;
  }).catch(() => {});
  window.clipLabNav = { refresh: () => fetch("/api/session", { credentials: "same-origin" }).then((r) => r.json()).then((s) => { links.hidden = out.hidden = !(s && s.user); }) };
})();

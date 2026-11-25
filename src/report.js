// Wochenbericht: fasst jeden Montagmorgen die letzten sieben Tage eines Clippers zusammen –
// was gepostet wurde, was lief, was der Agent gemacht hat, und was sich daraus ableiten lässt.
// Ohne KI: alle Aussagen kommen direkt aus den gespeicherten Zahlen.
const config = require("./config");
const { db, save, id, now } = require("./store");
const push = require("./push");
const mail = require("./mail");
const autopilot = require("./autopilot");

const DAY = 24 * 3600_000;
const TZ = "Europe/Berlin";
const PF = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };
const DEFAULTS = { enabled: true, email: false };
const settings = (user) => ({ ...DEFAULTS, ...(user.report || {}) });
const nf = (n) => Math.round(n).toLocaleString("de-DE");
const esc = (s) => String(s || "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

// Montag 00:00 deutscher Zeit der Woche, in der t liegt
function weekStart(t = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.weekday);
  return t - dow * DAY - Number(p.hour) * 3600_000 - Number(p.minute) * 60_000 - Number(p.second) * 1000 - (t % 1000);
}
const dateDe = (t) => new Intl.DateTimeFormat("de-DE", { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(new Date(t));

function build(user, to = Date.now()) {
  const from = to - 7 * DAY, prevFrom = from - 7 * DAY;
  const mine = db.posts.filter((p) => p.userId === user.id);
  const inRange = (p, a, b) => p.status === "veröffentlicht" && p.publishedAt && new Date(p.publishedAt).getTime() >= a && new Date(p.publishedAt).getTime() < b;
  const week = mine.filter((p) => inRange(p, from, to)), prev = mine.filter((p) => inRange(p, prevFrom, from));
  const views = (ps) => ps.reduce((a, p) => a + (Number(p.stats?.views) || 0), 0);
  const sum = (ps, k) => ps.reduce((a, p) => a + (Number(p.stats?.[k]) || 0), 0);
  const clipOf = (p) => db.clips.find((c) => c.id === p.clipId) || {};
  const title = (p) => (clipOf(p).caption || "").split("\n")[0].slice(0, 90) || "Ohne Titel";
  const measured = week.filter((p) => typeof p.stats?.views === "number");
  const top = [...measured].sort((a, b) => (b.stats.views || 0) - (a.stats.views || 0)).slice(0, 3)
    .map((p) => ({ title: title(p), platform: PF[p.platform] || p.platform, views: p.stats.views || 0, likes: p.stats.likes || 0, permalink: p.permalink || null }));
  const byPlatform = Object.entries(week.reduce((g, p) => { (g[p.platform] = g[p.platform] || []).push(p); return g; }, {}))
    .map(([k, ps]) => ({ platform: PF[k] || k, posts: ps.length, views: views(ps) })).sort((a, b) => b.views - a.views);
  const failed = mine.filter((p) => p.status === "fehler" && new Date(p.updatedAt || p.scheduledAt || 0).getTime() >= from).length;
  const planned = mine.filter((p) => p.status === "geplant" && new Date(p.scheduledAt).getTime() >= to).length;

  // Scans und Clips der Woche; welcher Creator am meisten Clips geliefert hat
  const projs = db.projects.filter((p) => p.userId === user.id && new Date(p.createdAt).getTime() >= from && new Date(p.createdAt).getTime() < to);
  const clips = projs.reduce((n, p) => n + p.clips.filter((c) => c.status === "bereit").length, 0);
  const byCreator = Object.entries(projs.reduce((g, p) => { const k = (p.opts?.origin?.creator || "").trim(); if (k) g[k] = (g[k] || 0) + p.clips.filter((c) => c.status === "bereit").length; return g; }, {})).sort((a, b) => b[1] - a[1]);
  const agentScans = projs.filter((p) => p.agent).length;
  const unposted = db.projects.filter((p) => p.userId === user.id).reduce((n, p) => n + p.clips.filter((c) => c.status === "bereit" && !c.posted).length, 0);

  const totals = { posts: week.length, views: views(week), likes: sum(week, "likes"), comments: sum(week, "comments"), prevPosts: prev.length, prevViews: views(prev), scans: projs.length, clips, agentScans, failed, planned, unposted };

  // Empfehlungen: nur, was die Zahlen hergeben
  const tips = [];
  const best = autopilot.bestHours(user);
  const ap = autopilot.settings(user);
  if (!week.length && clips) tips.push(`Du hast ${clips} ${clips === 1 ? "Clip" : "Clips"} geschnitten, aber nichts gepostet. Unter „Clips“ liegen sie bereit.`);
  if (!week.length && !clips) tips.push("Diese Woche ist nichts passiert. Hefte unter „Streams“ ein, zwei Creator an und schalte den Clip-Agenten ein, dann kommen die Clips von selbst.");
  if (totals.prevViews > 0 && totals.views > 0) {
    const d = Math.round(((totals.views - totals.prevViews) / totals.prevViews) * 100);
    if (Math.abs(d) >= 15) tips.push(d > 0 ? `Aufrufe ${d} % über der Vorwoche. Bleib bei dem, was du diese Woche gemacht hast.` : `Aufrufe ${Math.abs(d)} % unter der Vorwoche${week.length < prev.length ? ` – du hast auch weniger gepostet (${week.length} statt ${prev.length})` : ""}.`);
  }
  if (best.source === "daten") tips.push(`Deine stärkste Uhrzeit ist ${best.detail[0].hour} Uhr (Ø ${nf(best.detail[0].avg)} Aufrufe).${ap.enabled && !ap.smart ? " Schalte beim Autopiloten „Zur besten Uhrzeit posten“ ein." : ""}`);
  if (byPlatform.length > 1 && byPlatform[0].views > 2 * (byPlatform[1].views || 1) && byPlatform[1].posts >= 2) tips.push(`${byPlatform[0].platform} bringt deutlich mehr Aufrufe als ${byPlatform[1].platform} (${nf(byPlatform[0].views)} gegen ${nf(byPlatform[1].views)}).`);
  if (top.length && measured.length >= 3) { const avg = views(measured) / measured.length; if (top[0].views > 3 * avg) tips.push(`„${top[0].title}“ lief dreimal so gut wie dein Schnitt. Mehr Clips in dieser Art lohnen sich.`); }
  if (failed) tips.push(`${failed} ${failed === 1 ? "Post ist" : "Posts sind"} fehlgeschlagen. Sieh im Protokoll nach, ob ein Account neu verbunden werden muss.`);
  if (unposted >= 5 && week.length) tips.push(`${unposted} fertige Clips sind noch nicht gepostet.`);
  if (week.length && !measured.length) tips.push("Für die Posts dieser Woche liegen noch keine Aufrufzahlen vor. Sie werden stündlich nachgeladen.");

  return { id: id("rep"), createdAt: now(), from: new Date(from).toISOString(), to: new Date(to).toISOString(), label: `${dateDe(from)} – ${dateDe(to - 1)}`, totals, top, byPlatform, byCreator: byCreator.slice(0, 3).map(([creator, n]) => ({ creator, clips: n })), tips };
}

const headline = (r) => (r.totals.posts ? `${r.totals.posts} ${r.totals.posts === 1 ? "Post" : "Posts"}, ${nf(r.totals.views)} Aufrufe` : r.totals.clips ? `${r.totals.clips} Clips geschnitten, nichts gepostet` : "keine Aktivität");

function text(user, r) {
  const t = r.totals, L = [`Hallo ${user.name || ""},`, "", `dein ClipLab-Wochenbericht für ${r.label}:`, "",
    `Gepostet: ${t.posts} (Vorwoche ${t.prevPosts})`, `Aufrufe: ${nf(t.views)} (Vorwoche ${nf(t.prevViews)})`, `Likes: ${nf(t.likes)} · Kommentare: ${nf(t.comments)}`,
    `Scans: ${t.scans}${t.agentScans ? ` (davon ${t.agentScans} vom Agenten)` : ""} · Clips geschnitten: ${t.clips}`, `Geplant für die nächsten Tage: ${t.planned}`];
  if (r.top.length) L.push("", "Beste Clips:", ...r.top.map((x, i) => `${i + 1}. ${x.title} – ${nf(x.views)} Aufrufe (${x.platform})`));
  if (r.tips.length) L.push("", "Was du daraus machen kannst:", ...r.tips.map((x) => "- " + x));
  L.push("", `Zum Bericht: ${config.baseUrl}/bericht`, "", "ClipLab · ein Projekt von imakio", `Abbestellen: ${config.baseUrl}/bericht`);
  return L.join("\n");
}
function html(user, r) {
  const t = r.totals, cell = (v, l) => `<td style="padding:10px 14px 10px 0"><div style="font-size:24px;font-weight:700;letter-spacing:-.5px">${v}</div><div style="font-size:11px;color:#8F8F8F;text-transform:uppercase;letter-spacing:1px">${l}</div></td>`;
  return `<!doctype html><html><body style="margin:0;background:#0A0A0A;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;color:#F4F4F4">
<div style="max-width:520px;margin:0 auto;background:#121212;border:1px solid #2a2a2a;border-radius:14px;padding:28px">
<p style="font-size:22px;font-weight:700;margin:0 0 4px;letter-spacing:-.5px">Clip<span style="border-bottom:3px solid #F4F4F4">Lab</span></p>
<p style="font-size:13px;color:#8F8F8F;margin:0 0 20px">Wochenbericht ${esc(r.label)}</p>
<table role="presentation" style="border-collapse:collapse;margin:0 0 16px"><tr>${cell(t.posts, "Posts")}${cell(nf(t.views), "Aufrufe")}${cell(t.clips, "Clips")}${cell(t.planned, "geplant")}</tr></table>
<p style="font-size:13px;color:#8F8F8F;margin:0 0 18px">Vorwoche: ${t.prevPosts} Posts, ${nf(t.prevViews)} Aufrufe</p>
${r.top.length ? `<p style="font-size:14px;font-weight:700;margin:0 0 8px">Beste Clips</p><ol style="margin:0 0 18px;padding-left:20px;font-size:14px;line-height:1.6">${r.top.map((x) => `<li>${esc(x.title)} – ${nf(x.views)} Aufrufe (${esc(x.platform)})</li>`).join("")}</ol>` : ""}
${r.tips.length ? `<p style="font-size:14px;font-weight:700;margin:0 0 8px">Was du daraus machen kannst</p><ul style="margin:0 0 20px;padding-left:20px;font-size:14px;line-height:1.6">${r.tips.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
<p style="margin:0 0 22px"><a href="${config.baseUrl}/bericht" style="display:inline-block;background:#F4F4F4;color:#0A0A0A;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">Bericht öffnen</a></p>
<p style="font-size:12px;line-height:1.5;color:#8F8F8F;margin:0">Du bekommst diese Mail, weil du den Wochenbericht per E-Mail eingeschaltet hast. Abschalten kannst du ihn unter <a href="${config.baseUrl}/bericht" style="color:#8F8F8F">${esc(config.baseUrl.replace(/^https?:\/\//, ""))}/bericht</a>.<br>ClipLab ist ein Projekt von imakio.</p>
</div></body></html>`;
}

// Bericht erstellen, speichern und zustellen
async function deliver(user, { manual = false } = {}) {
  const r = build(user);
  const s = settings(user);
  r.manual = manual;
  user.reports = [r, ...(user.reports || [])].slice(0, 12);
  save();
  if (!manual) {
    push.notify(user.id, { title: "Dein Wochenbericht ist da", body: headline(r), url: "/bericht" });
    if (s.email && mail.enabled() && user.email) {
      try { await mail.send({ to: user.email, subject: `ClipLab-Wochenbericht ${r.label}: ${headline(r)}`, text: text(user, r), html: html(user, r) }); r.mailed = true; }
      catch (e) { r.mailError = e.message.slice(0, 160); console.error("Wochenbericht: Mail an", user.id, "fehlgeschlagen –", e.message); }
      save();
    }
  }
  return r;
}

// Montags ab 8 Uhr deutscher Zeit, einmal je Woche und Nutzer; nur wer in den letzten 30 Tagen etwas gemacht hat
let ticking = false;
async function tick(t = Date.now()) {
  if (ticking) return 0;
  ticking = true;
  let n = 0;
  try {
    const ws = weekStart(t);
    if (t - ws < 8 * 3600_000 || t - ws > 2 * DAY) return 0;   // Montag 8 Uhr bis Dienstagabend (falls der Server montags aus war)
    const key = new Date(ws).toISOString().slice(0, 10);
    for (const user of db.users.slice()) {
      if (user.reportWeek === key || !settings(user).enabled) continue;
      user.reportWeek = key;
      const active = db.projects.some((p) => p.userId === user.id && t - new Date(p.createdAt).getTime() < 30 * DAY) || db.posts.some((p) => p.userId === user.id && t - new Date(p.publishedAt || p.scheduledAt || 0).getTime() < 30 * DAY);
      if (!active) { save(); continue; }
      await deliver(user).catch((e) => console.error("Wochenbericht", user.id, e.message));
      n++;
    }
  } finally { ticking = false; }
  return n;
}

function register(app, auth) {
  app.get("/api/report", auth.requireUser, (req, res) => res.json({ settings: settings(req.user), reports: req.user.reports || [], mail: mail.enabled(), email: req.user.email || "" }));
  app.put("/api/report", auth.requireUser, (req, res) => {
    const cur = settings(req.user), b = req.body || {};
    req.user.report = { enabled: typeof b.enabled === "boolean" ? b.enabled : cur.enabled, email: typeof b.email === "boolean" ? b.email : cur.email };
    save();
    res.json({ settings: settings(req.user) });
  });
  // Sofort einen Bericht über die letzten sieben Tage (höchstens alle zwei Minuten)
  const last = new Map();
  app.post("/api/report/now", auth.requireUser, async (req, res) => {
    if (Date.now() - (last.get(req.user.id) || 0) < 2 * 60_000) return res.status(429).json({ error: "Gerade erst erstellt – bitte in zwei Minuten nochmal" });
    last.set(req.user.id, Date.now());
    res.json({ report: await deliver(req.user, { manual: true }), reports: req.user.reports });
  });
}

function start() {
  setInterval(() => tick().catch((e) => console.error("Wochenbericht", e)), 10 * 60_000);
  setTimeout(() => tick().catch((e) => console.error("Wochenbericht", e)), 90_000);
}

module.exports = { register, start, tick, build, weekStart, settings, text, html };

// Autopilot: fertige Auto-Clips werden automatisch in festen Abständen eingeplant –
// nur innerhalb eines Zeitfensters (deutsche Zeit), die lustigsten zuerst.
const { db, save } = require("./store");

const TZ = "Europe/Berlin";
const DEFAULTS = { enabled: false, accountIds: [], everyHours: 3, from: 10, to: 22, minScore: 1 };

const settings = (user) => ({ ...DEFAULTS, ...(user.autopilot || {}) });

function berlinHour(d) {
  const p = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(d);
  return Number(p.find((x) => x.type === "hour").value) + Number(p.find((x) => x.type === "minute").value) / 60;
}
// In das Zeitfenster schieben (in 5-Minuten-Schritten, funktioniert auch bei Zeitumstellung)
function intoWindow(d, from, to) {
  const inside = (h) => (from <= to ? h >= from && h < to : h >= from || h < to);
  let t = new Date(d);
  for (let i = 0; i < 2000 && !inside(berlinHour(t)); i++) t = new Date(t.getTime() + 5 * 60_000);
  return t;
}

// Nächster freier Termin: nach dem letzten geplanten Autopilot-Post + Abstand
function nextSlot(user, s) {
  const gap = s.everyHours * 3600_000;
  const times = db.posts.filter((p) => p.userId === user.id && p.auto && ["geplant", "läuft", "verarbeitung", "veröffentlicht", "entwurf"].includes(p.status))
    .map((p) => new Date(p.scheduledAt).getTime());
  const last = times.length ? Math.max(...times) : 0;
  const base = Math.max(Date.now() + 2 * 60_000, last ? last + gap : 0);
  return intoWindow(new Date(base), s.from, s.to);
}

// Alle noch nicht eingeplanten, fertigen Clips eines Projekts einplanen
async function planProject(p, schedulePosts, fileFor) {
  const user = db.users.find((u) => u.id === p.userId);
  if (!user || !p.autopost) return 0;
  const s = settings(user);
  const accountIds = s.accountIds.filter((idx) => db.accounts.some((a) => a.id === idx && a.userId === user.id));
  if (!s.enabled || !accountIds.length) return 0;
  const clips = p.clips.filter((c) => c.status === "bereit" && !c.autoPlanned && (c.score || 0) >= s.minScore).sort((a, b) => (b.score || 0) - (a.score || 0));
  let n = 0;
  for (const c of clips) {
    const tags = (c.hashtags || []).map((h) => "#" + h).join(" ");
    const out = await schedulePosts({
      user, srcFile: fileFor(c), copy: true, originalName: `${p.name}-${c.id}.mp4`,
      caption: [c.caption, tags].filter(Boolean).join("\n\n"), accountIds, scheduledAt: nextSlot(user, s).toISOString(), auto: true, campaign: p.opts && p.opts.campaign,
    });
    c.autoPlanned = true; c.posted = (c.posted || 0) + out.posts.length; n++;
  }
  save();
  return n;
}

function register(app, auth) {
  app.get("/api/autopilot", auth.requireUser, (req, res) => res.json({ autopilot: settings(req.user) }));
  app.put("/api/autopilot", auth.requireUser, (req, res) => {
    const b = req.body || {}, cur = settings(req.user);
    const n = (v, d, a, z) => (v == null ? d : Math.min(z, Math.max(a, Math.round(Number(v)) || 0)));
    req.user.autopilot = {
      enabled: typeof b.enabled === "boolean" ? b.enabled : cur.enabled,
      accountIds: Array.isArray(b.accountIds) ? b.accountIds.filter((x) => db.accounts.some((a) => a.id === x && a.userId === req.user.id)) : cur.accountIds,
      everyHours: n(b.everyHours, cur.everyHours, 1, 48), from: n(b.from, cur.from, 0, 23), to: n(b.to, cur.to, 1, 24), minScore: n(b.minScore, cur.minScore, 1, 10),
    };
    save();
    res.json({ autopilot: settings(req.user) });
  });
}

module.exports = { register, planProject, settings, nextSlot, intoWindow, berlinHour };

// Clip-Agent: beobachtet die Quellen (Kanäle, Playlists, einzelne Videos) der Kampagnen eines Clippers,
// legt für jedes neue Video von selbst ein Projekt an und gibt die fertigen Clips an den Autopilot.
// Ablauf je Durchgang: Quellen auflisten → Neues erkennen → Projekt starten → Ergebnis ins Protokoll (+ Push).
const config = require("./config");
const { db, save, id, now } = require("./store");
const yt = require("./download");
const projects = require("./projects");
const autopilot = require("./autopilot");
const push = require("./push");
const streams = require("./streams");

// favorites: auch die angehefteten Creator der Streams-Seite beobachten
// windows: 0 = ganzes Video; 1–3 = so viele 20-Minuten-Fenster je Video, über die Länge verteilt (spart Zeit und Mitschreib-Kontingent)
const DEFAULTS = { enabled: false, campaigns: [], favorites: false, windows: 1, perDay: 2, count: 5, goal: "funny", minLen: 20, maxLen: 60, layout: "crop", quality: "balanced" };
const WINDOW = 1200;             // Sekunden je Fenster
const MAX_SOURCES = 10;          // Quellen je Kampagne
const MIN_SECONDS = 120;         // kürzere Videos lohnen sich nicht zum Clippen
const MAX_SECONDS = 4 * 3600;    // längere nimmt die Verarbeitung nicht an
const DAY = 24 * 3600_000;

const settings = (user) => {
  const s = { ...DEFAULTS, ...(user.agent || {}) };
  s.campaigns = (s.campaigns || []).filter((cid) => access(cid, user.id));
  return s;
};
const isMember = (c, userId) => c.userId === userId || (c.members || []).some((m) => m.userId === userId);
const access = (campaignId, userId) => { const c = db.campaigns.find((x) => x.id === campaignId); return c && isMember(c, userId) ? c : null; };
const expired = (c) => Boolean(c.deadline) && new Date(c.deadline + "T23:59:59").getTime() < Date.now();

function log(user, kind, text) {
  user.agentLog = [{ t: now(), kind, text: String(text).slice(0, 300) }, ...(user.agentLog || [])].slice(0, 40);
  save();
}

// ---------- Quellen auflisten (mit Zwischenspeicher, damit ein Kanal nicht für jeden Clipper neu abgefragt wird) ----------
let lister = (src) => yt.list(src.listUrl || src.url, { limit: 6 });
const cache = new Map();   // sourceId -> { at, items }
const state = new Map();   // sourceId -> { checkedAt, error, found }
async function entriesOf(src, fresh) {
  if (src.kind === "favorit") {   // angehefteter Creator: Liste kommt von der Streams-Seite (eigener Zwischenspeicher)
    try { const items = await streams.latestOf(src.creator); state.set(src.id, { checkedAt: now(), error: null, found: items.length }); return items; }
    catch (e) { const hint = /Sign in to confirm|bot/i.test(e.message) ? "YouTube blockiert Abfragen von diesem Server gerade" : e.message; state.set(src.id, { checkedAt: now(), error: hint, found: 0 }); throw new Error(hint); }
  }
  if (src.kind === "video") return [{ id: "video", title: "", url: src.url, duration: null, live: false }];
  const hit = cache.get(src.id);
  if (hit && !fresh && Date.now() - hit.at < (config.agentIntervalMin - 1) * 60_000) return hit.items;
  try {
    const items = await lister(src);
    cache.set(src.id, { at: Date.now(), items });
    state.set(src.id, { checkedAt: now(), error: null, found: items.length });
    return items;
  } catch (e) {
    const hint = /Sign in to confirm|bot/i.test(e.message) ? "YouTube blockiert Abfragen von diesem Server gerade" : e.message;
    state.set(src.id, { checkedAt: now(), error: hint, found: 0 });
    throw new Error(hint);
  }
}

// ---------- Ein Durchgang für einen Clipper ----------
const startsToday = (user) => (user.agentStarts || []).filter((t) => Date.now() - t < DAY);
const running = (user) => db.projects.filter((p) => p.userId === user.id && p.agent && !["fertig", "fehler"].includes(p.status));

// Fertige oder fehlgeschlagene Agent-Projekte einmal melden
function report(user) {
  for (const p of db.projects) {
    if (p.userId !== user.id || !p.agent || p.agent.reported || !["fertig", "fehler"].includes(p.status)) continue;
    // Clips, die noch einmal neu gerendert werden, abwarten
    if (p.status === "fertig" && p.clips.some((c) => ["wartet", "rendern"].includes(c.status))) continue;
    p.agent.reported = true;
    if (p.status === "fehler") {
      log(user, "err", `„${p.name}“: ${p.error || "Fehler bei der Verarbeitung"}`);
      push.notify(user.id, { title: "Clip-Agent: Video übersprungen", body: `${p.name}: ${p.error || "Fehler"}`.slice(0, 180), url: "/auto#agent" });
      continue;
    }
    const ready = p.clips.filter((c) => c.status === "bereit").length, planned = p.clips.filter((c) => c.autoPlanned).length;
    const tail = planned ? `${planned} davon eingeplant` : "nicht eingeplant – Autopilot unter „Accounts“ einschalten";
    log(user, planned ? "ok" : "warn", `„${p.name}“: ${ready} Clip${ready === 1 ? "" : "s"} fertig, ${tail}`);
    push.notify(user.id, { title: `Clip-Agent: ${ready} neue Clips`, body: `${p.name} – ${tail}`.slice(0, 180), url: "/auto" });
  }
  save();
}

// Fenster eines Videos: n gleich große Stücke von höchstens 20 Minuten, davon k gleichmäßig über die Länge verteilt
function windowsOf(duration, k) {
  const n = Math.max(1, Math.ceil(duration / WINDOW)), len = duration / n;
  if (n === 1) return [null];   // kurzes Video: ganz
  const pick = Math.min(n, k), out = [];
  for (let j = 0; j < pick; j++) { const i = Math.min(n - 1, Math.floor(((j + 0.5) * n) / pick)); out.push({ from: Math.round(i * len), to: Math.round((i + 1) * len) }); }
  return out;
}
const hm = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;

// Wartende Fenster nacheinander starten (immer nur eines gleichzeitig)
function startNext(user) {
  const q = user.agentQueue || [];
  if (!q.length || running(user).length) return false;
  const job = q.shift();
  const s = settings(user);
  const opts = projects.cleanOpts({ count: job.count || s.count, minLen: s.minLen, maxLen: s.maxLen, layout: s.layout, goal: s.goal, quality: s.quality, campaign: job.campaign || null, autopost: true });
  projects.createFromLink(user, { url: job.url, platform: job.platform, name: job.name, section: job.section || null, opts, agent: { campaign: job.campaign || null, source: job.source, video: job.video } });
  save();
  return true;
}

async function runUser(user, { fresh = false } = {}) {
  report(user);
  const s = settings(user);
  if (!s.enabled) { if (user.agentQueue && user.agentQueue.length) { user.agentQueue = []; save(); } return 0; }
  if (!yt.available()) return 0;
  if (startNext(user)) return 1;
  // Quellen: Kampagnen-Quellen und (wenn gewünscht) die angehefteten Creator
  const groups = [];
  for (const cid of s.campaigns) { const c = access(cid, user.id); if (c && !expired(c)) groups.push({ campaign: c, name: c.name, sources: c.sources || [] }); }
  if (s.favorites) {
    const favs = (user.creators || []).filter((x) => x.pinned).slice(0, 12).map((x) => ({ id: "fav:" + x.id, kind: "favorit", label: x.label, platform: x.platform, url: x.url, creator: x }));
    if (favs.length) groups.push({ campaign: null, name: "Favoriten", sources: favs });
  }
  if (!groups.length) return 0;
  user.agentSeen = user.agentSeen || {};
  user.agentBase = user.agentBase || {};
  user.agentStarts = startsToday(user);
  let started = 0;
  const full = () => user.agentStarts.length >= s.perDay;
  // Immer nur ein Agent-Video gleichzeitig in der Warteschlange, damit Handarbeit nicht hinten ansteht
  const busy = () => running(user).length > 0;

  for (const g of groups) {
    const c = g.campaign || { id: null, name: g.name };
    for (const src of g.sources) {
      if (full() || busy()) { save(); return started; }
      let items;
      try { items = await entriesOf(src, fresh); }
      catch (e) {
        // Denselben Fehler nicht bei jedem Durchgang erneut ins Protokoll schreiben
        const key = `${src.id}:${e.message}`;
        if (user.agentLastErr !== key) { user.agentLastErr = key; log(user, "err", `${src.label} (${c.name}): ${e.message}`); }
        continue;
      }
      if (user.agentLastErr && user.agentLastErr.startsWith(src.id + ":")) user.agentLastErr = null;
      const key = (e) => `${src.id}:${e.id}`;
      // Erster Blick auf einen Kanal: nur das neueste Video clippen, das Archiv gilt als bekannt
      if (!user.agentBase[src.id]) {
        user.agentBase[src.id] = Date.now();
        const firstReal = items.findIndex((e) => !e.live);
        items.forEach((e, i) => { if (i !== firstReal && !e.live) user.agentSeen[key(e)] = Date.now(); });
      }
      for (const e of items) {
        if (user.agentSeen[key(e)] || e.live) continue;          // laufende Streams später noch einmal ansehen
        if (e.duration && e.duration < MIN_SECONDS) { user.agentSeen[key(e)] = Date.now(); continue; }
        // Ganze Videos nur bis 4 Stunden; fensterweise geht jede Länge (dafür muss die Länge bekannt sein)
        const whole = !s.windows || !e.duration;
        if (whole && e.duration && e.duration > MAX_SECONDS) { user.agentSeen[key(e)] = Date.now(); log(user, "warn", `„${e.title || e.url}“ übersprungen: länger als 4 Stunden (stell beim Agenten „Fenster“ ein, dann geht jede Länge)`); continue; }
        if (full() || busy()) break;
        const platform = yt.platformOf(e.url);
        if (!platform) { user.agentSeen[key(e)] = Date.now(); continue; }
        const wins = whole ? [null] : windowsOf(e.duration, s.windows);
        // Clips auf die Fenster verteilen, damit ein Video nicht mehr Clips liefert als eingestellt
        const per = Math.max(1, Math.ceil(s.count / wins.length));
        user.agentQueue = user.agentQueue || [];
        wins.forEach((w) => user.agentQueue.push({ url: e.url, platform, name: (e.title || `${platform}-Video`).slice(0, 100) + (w && wins.length > 1 ? ` (${hm(w.from)}–${hm(w.to)})` : ""), section: w, count: per, campaign: c.id, source: src.id, video: e.id }));
        user.agentSeen[key(e)] = Date.now();
        user.agentStarts.push(Date.now());
        started++;
        const what = wins[0] ? `${wins.length} Fenster von je ${Math.round((wins[0].to - wins[0].from) / 60)} Min.` : "ganzes Video";
        log(user, "info", `Neues Video bei ${src.kind === "video" ? c.name : src.label}: „${e.title || e.url}“ – wird geclippt (${what})`);
        startNext(user);
      }
    }
  }
  // Merkliste klein halten
  const seen = Object.entries(user.agentSeen);
  if (seen.length > 1500) user.agentSeen = Object.fromEntries(seen.sort((a, b) => b[1] - a[1]).slice(0, 1000));
  save();
  return started;
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    for (const user of db.users.slice()) {
      if (!user.agent && !(user.agentQueue || []).length && !db.projects.some((p) => p.userId === user.id && p.agent && !p.agent.reported)) continue;
      await runUser(user).catch((e) => console.error("Agent", user.id, e));
    }
  } finally { ticking = false; }
}

// ---------- API ----------
function publicSource(s) {
  const st = state.get(s.id) || {};
  return { id: s.id, url: s.url, label: s.label, platform: s.platform, kind: s.kind, checkedAt: st.checkedAt || null, error: st.error || null };
}
function status(user) {
  const s = settings(user), ap = autopilot.settings(user);
  const apAccounts = ap.accountIds.filter((x) => db.accounts.some((a) => a.id === x && a.userId === user.id)).length;
  const campaigns = db.campaigns.filter((c) => isMember(c, user.id)).map((c) => ({
    id: c.id, name: c.name, owner: c.userId === user.id, expired: expired(c), deadline: c.deadline || "",
    sources: (c.sources || []).map(publicSource),
  }));
  return {
    agent: s, campaigns, log: user.agentLog || [], today: startsToday(user).length, running: running(user).length, queued: (user.agentQueue || []).length,
    favorites: (user.creators || []).filter((x) => x.pinned).map((x) => ({ id: x.id, label: x.label, platform: x.platform, ...(state.get("fav:" + x.id) || {}) })),
    ai: require("./highlights").brain(),
    links: yt.available(), claude: Boolean(config.claude.apiKey), intervalMin: config.agentIntervalMin,
    autopilot: { ready: ap.enabled && apAccounts > 0, accounts: apAccounts, everyHours: ap.everyHours, from: ap.from, to: ap.to },
  };
}

function register(app, auth) {
  app.get("/api/agent", auth.requireUser, (req, res) => { report(req.user); res.json(status(req.user)); });

  app.put("/api/agent", auth.requireUser, (req, res) => {
    const b = req.body || {}, cur = settings(req.user);
    const n = (v, d, a, z) => (v == null ? d : Math.min(z, Math.max(a, Math.round(Number(v)) || a)));
    const minLen = n(b.minLen, cur.minLen, 5, 120);
    req.user.agent = {
      enabled: typeof b.enabled === "boolean" ? b.enabled : cur.enabled,
      campaigns: Array.isArray(b.campaigns) ? [...new Set(b.campaigns.map(String))].filter((cid) => access(cid, req.user.id)).slice(0, 20) : cur.campaigns,
      favorites: typeof b.favorites === "boolean" ? b.favorites : cur.favorites,
      windows: b.windows == null ? cur.windows : Math.min(3, Math.max(0, Math.round(Number(b.windows)) || 0)),
      perDay: n(b.perDay, cur.perDay, 1, 10), count: n(b.count, cur.count, 1, 15),
      goal: ["funny", "viral", "reaction", "tips", "emotional"].includes(b.goal) ? b.goal : cur.goal,
      minLen, maxLen: Math.max(minLen + 5, n(b.maxLen, cur.maxLen, 10, 180)),
      layout: ["crop", "fit", "split"].includes(b.layout) ? b.layout : cur.layout,
      quality: ["fast", "balanced", "best"].includes(b.quality) ? b.quality : cur.quality,
    };
    if (req.user.agent.enabled && !cur.enabled) log(req.user, "info", "Agent eingeschaltet");
    if (!req.user.agent.enabled && cur.enabled) log(req.user, "info", "Agent ausgeschaltet");
    save();
    // Gleich loslegen, nicht erst beim nächsten Durchgang
    if (req.user.agent.enabled) runUser(req.user).catch((e) => console.error("Agent", req.user.id, e));
    res.json(status(req.user));
  });

  // Sofort nach neuen Videos schauen (höchstens alle zwei Minuten)
  const lastRun = new Map();
  app.post("/api/agent/run", auth.requireUser, async (req, res) => {
    if (!settings(req.user).enabled) return res.status(409).json({ error: "Der Agent ist ausgeschaltet" });
    if (Date.now() - (lastRun.get(req.user.id) || 0) < 2 * 60_000) return res.status(429).json({ error: "Gerade erst geprüft – bitte in zwei Minuten nochmal" });
    lastRun.set(req.user.id, Date.now());
    const started = await runUser(req.user, { fresh: true });
    res.json({ started, ...status(req.user) });
  });

  // Quellen einer Kampagne pflegen (nur wer die Kampagne angelegt hat)
  const own = (req) => {
    const c = db.campaigns.find((x) => x.id === req.params.id && x.userId === req.user.id);
    if (!c) throw Object.assign(new Error("Kampagne nicht gefunden"), { status: 404 });
    return c;
  };
  app.post("/api/campaigns/:id/sources", auth.requireUser, (req, res) => {
    const c = own(req);
    const src = yt.sourceOf(req.body.url);
    if (!src) return res.status(400).json({ error: "Bitte einen Kanal-, Playlist- oder Video-Link einfügen (YouTube, Twitch; einzelne Videos auch von Kick, TikTok, Instagram, X, Vimeo)" });
    c.sources = c.sources || [];
    if (c.sources.some((s) => s.url === src.url)) return res.status(409).json({ error: "Diese Quelle ist schon eingetragen" });
    if (c.sources.length >= MAX_SOURCES) return res.status(400).json({ error: `Höchstens ${MAX_SOURCES} Quellen je Kampagne` });
    const s = { id: id("src"), ...src, addedAt: now() };
    c.sources.push(s); save();
    res.status(201).json({ source: publicSource(s) });
  });
  app.delete("/api/campaigns/:id/sources/:sid", auth.requireUser, (req, res) => {
    const c = own(req);
    c.sources = (c.sources || []).filter((s) => s.id !== req.params.sid);
    cache.delete(req.params.sid); state.delete(req.params.sid); save();
    res.json({ ok: true });
  });
}

function start() {
  setInterval(() => tick().catch((e) => console.error("Agent", e)), config.agentIntervalMin * 60_000);
  setTimeout(() => tick().catch((e) => console.error("Agent", e)), 60_000);
}

module.exports = { register, start, tick, runUser, settings, status, _setLister: (f) => { lister = f; } };

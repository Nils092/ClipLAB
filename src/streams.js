// Streams: Creator nachschlagen, vergangene Streams auflisten, Favoriten merken, Daten zu einem einzelnen Link holen.
// Grundlage für die Streams-Seite (Quelle wählen → Stream wählen → Scan einrichten).
const { save, id, now } = require("./store");
const yt = require("./download");

const TTL = 10 * 60_000;                 // Listen 10 Minuten merken – yt-dlp ist langsam
const cache = new Map();                 // Schlüssel → { at, value }
const MAX_CREATORS = 40;
const PLATFORMS = { twitch: "Twitch", youtube: "YouTube", kick: "Kick" };

// Erlaubte Bild-Quellen für Vorschaubilder (werden über den eigenen Server geladen – kein Abruf fremder Server durch den Browser)
const THUMB_HOSTS = [/(^|\.)jtvnw\.net$/i, /(^|\.)ytimg\.com$/i, /(^|\.)ggpht\.com$/i, /(^|\.)googleusercontent\.com$/i, /(^|\.)kick\.com$/i, /(^|\.)twitch\.tv$/i, /(^|\.)twitchcdn\.net$/i];

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 300) for (const [k, v] of cache) if (Date.now() - v.at > TTL) cache.delete(k);
  return value;
}

// Eingabe (Name, @handle oder Link) → { platform, name, label, url, listUrls }
function resolveCreator(platform, raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    const src = yt.sourceOf(s);
    if (!src || src.kind !== "kanal") return null;
    const key = Object.keys(PLATFORMS).find((k) => PLATFORMS[k] === src.platform);
    if (!key) return null;
    if (key === "twitch") return resolveCreator("twitch", new URL(src.url).pathname.split("/").filter(Boolean)[0]);
    const base = src.url.replace(/\/(videos|streams)$/, "");
    const name = base.split("/").filter(Boolean).pop();
    return { platform: key, name, label: name.replace(/^@/, ""), url: base, listUrls: [`${base}/streams`, `${base}/videos`] };
  }
  if (platform === "twitch") {
    s = s.replace(/^@/, "").replace(/\s+/g, "").toLowerCase();
    if (!/^\w{2,30}$/.test(s)) return null;
    const b = `https://www.twitch.tv/${s}/videos`;
    return { platform, name: s, label: s, url: `https://www.twitch.tv/${s}`, listUrls: [`${b}?filter=archives&sort=time`, `${b}?filter=all&sort=time`, b] };
  }
  if (platform === "youtube") {
    s = "@" + s.replace(/^@/, "").replace(/\s+/g, "");
    if (!/^@[\w.\-]{2,60}$/.test(s)) return null;
    const base = `https://www.youtube.com/${s}`;
    return { platform, name: s, label: s.slice(1), url: base, listUrls: [`${base}/streams`, `${base}/videos`] };
  }
  return null;
}

// Vergangene Streams eines Creators (neueste zuerst). YouTube: erst aufgezeichnete Streams, sonst normale Videos.
async function streamsOf(c, limit = 12) {
  return cached(`list:${c.platform}:${c.name}:${limit}`, async () => {
    let lastErr = null;
    for (const u of c.listUrls) {
      try {
        const items = (await yt.list(u, { limit, timeoutMs: 45_000 })).filter((v) => !v.live);
        if (items.length) return items;
      } catch (e) { lastErr = e; console.error("Streams: Liste fehlgeschlagen", u, "–", e.message); }
    }
    if (lastErr) throw lastErr;
    return [];
  });
}

const publicCreator = (c) => ({ id: c.id, platform: c.platform, name: c.name, label: c.label, url: c.url, pinned: Boolean(c.pinned), usedAt: c.usedAt || null, avatar: c.avatar || null, thumb: c.thumb || null });

// Profilbild eines Kanals von seiner öffentlichen Seite lesen (og:image). Klappt nicht immer – dann bleibt das Bild des letzten Streams.
async function avatarOf(c) {
  const r = await fetch(c.url, { signal: AbortSignal.timeout(7000), redirect: "follow",
    headers: { "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Accept-Language": "de,en;q=0.8", Cookie: "SOCS=CAI; CONSENT=YES+1" } });
  if (!r.ok) return null;
  const html = (await r.text()).slice(0, 400_000);
  const m = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i.exec(html) || /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);
  if (!m) return null;
  let u; try { u = new URL(m[1].replace(/&amp;/g, "&")); } catch { return null; }
  if (u.protocol !== "https:" || !THUMB_HOSTS.some((re) => re.test(u.hostname))) return null;
  if (/ttv-static-metadata|twitch_logo|yt_1200|youtube\.com\/img/i.test(u.href)) return null;   // nur das allgemeine Plattform-Logo
  return u.href.slice(0, 500);
}
function refreshAvatar(e) {
  if (e.avatar || (e.avatarTried && Date.now() - e.avatarTried < 24 * 3600_000)) return;
  e.avatarTried = Date.now();
  avatarOf(e).then((a) => { if (a) { e.avatar = a; save(); } }).catch(() => {});
}

function touch(user, c, patch = {}) {
  user.creators = user.creators || [];
  let e = user.creators.find((x) => x.platform === c.platform && x.name === c.name);
  if (!e) {
    e = { id: id("cr"), platform: c.platform, name: c.name, label: c.label, url: c.url, pinned: false, createdAt: now() };
    user.creators.unshift(e);
    // Liste klein halten: älteste nicht angeheftete zuerst entfernen
    while (user.creators.length > MAX_CREATORS) {
      const i = user.creators.map((x) => x.pinned).lastIndexOf(false);
      if (i < 0) break;
      user.creators.splice(i, 1);
    }
  }
  Object.assign(e, patch, { usedAt: now() });
  save();
  return e;
}


function register(app, auth) {
  const fail = (res, e, fallback) => {
    const msg = String((e && e.message) || fallback);
    console.error("Streams:", fallback, "–", msg);
    const text = /Sign in to confirm|bot/i.test(msg) ? "YouTube blockiert Abfragen von diesem Server gerade. Füge stattdessen den Link zum Video ein oder lade die Datei hoch."
      : /does not exist|404|Not Found|Unable to recognize/i.test(msg) ? "Diesen Creator gibt es dort nicht. Prüfe die Schreibweise."
      : /Zeitüberschreitung/i.test(msg) ? "Die Plattform antwortet gerade nicht. Versuch es gleich noch einmal."
      : fallback + " (" + msg.slice(0, 140) + ")";
    res.status(502).json({ error: text, detail: msg.slice(0, 300) });
  };

  // Gemerkte Creator (zuletzt genutzt + angeheftet)
  app.get("/api/streams/creators", auth.requireUser, (req, res) => {
    const list = (req.user.creators || []).slice().sort((a, b) => String(b.usedAt || "").localeCompare(String(a.usedAt || "")));
    res.json({ creators: list.map(publicCreator), links: yt.available() });
  });

  // Creator nachschlagen und seine vergangenen Streams liefern
  app.get("/api/streams/creator", auth.requireUser, async (req, res) => {
    const platform = String(req.query.platform || "").toLowerCase();
    if (platform === "kick") return res.status(400).json({ error: "Kick lässt sich nicht nach Creatorn durchsuchen. Füge den Link zu einem vergangenen Kick-Stream ein." });
    const c = resolveCreator(platform, req.query.name);
    if (!c) return res.status(400).json({ error: "Bitte einen Kanalnamen eingeben (z. B. „papaplatte“) oder den Link zum Kanal einfügen." });
    if (!yt.available()) return res.status(503).json({ error: "Download per Link ist auf dem Server noch nicht installiert" });
    try {
      const streams = await streamsOf(c, Math.min(24, Math.max(1, Number(req.query.limit) || 12)));
      if (!streams.length) { console.error("Streams: leere Liste für", c.platform, c.name); return res.status(404).json({ error: "Bei diesem Creator sind keine vergangenen Streams oder Videos zu finden.", detail: "Die Plattform hat eine leere Liste geliefert." }); }
      const e = req.query.peek ? (req.user.creators || []).find((x) => x.platform === c.platform && x.name === c.name) || c : touch(req.user, c);
      if (e.id) {   // Bild fürs Favoriten-Kärtchen: Vorschaubild des neuesten Streams, dazu (wenn auffindbar) das Profilbild
        const t = (streams.find((v) => v.thumb) || {}).thumb || null;
        if (t && e.thumb !== t) { e.thumb = t; save(); }
        refreshAvatar(e);
      }
      res.json({ creator: publicCreator(e), streams });
    } catch (e) { fail(res, e, "Die Streams konnten nicht geladen werden"); }
  });

  // Anheften / lösen / entfernen
  app.patch("/api/streams/creators/:id", auth.requireUser, (req, res) => {
    const e = (req.user.creators || []).find((x) => x.id === req.params.id);
    if (!e) return res.status(404).json({ error: "Creator nicht gefunden" });
    if (typeof req.body.pinned === "boolean") e.pinned = req.body.pinned;
    save();
    res.json({ creator: publicCreator(e) });
  });
  app.delete("/api/streams/creators/:id", auth.requireUser, (req, res) => {
    req.user.creators = (req.user.creators || []).filter((x) => x.id !== req.params.id);
    save();
    res.json({ ok: true });
  });

  // Daten zu einem einzelnen Link (für „Scan einrichten“): Titel, Länge, Vorschaubild
  app.get("/api/streams/info", auth.requireUser, async (req, res) => {
    const url = String(req.query.url || "").trim();
    const platform = yt.platformOf(url);
    if (!platform) return res.status(400).json({ error: "Bitte einen Link von YouTube, Twitch, Kick, TikTok, Instagram, X oder Vimeo einfügen" });
    const src = yt.sourceOf(url);
    if (src && src.kind === "kanal") return res.status(400).json({ error: "Das ist ein Kanal. Suche den Creator über das Suchfeld oder füge den Link zu einem einzelnen Stream ein.", channel: true });
    if (!yt.available()) return res.status(503).json({ error: "Download per Link ist auf dem Server noch nicht installiert" });
    try {
      const v = await cached("info:" + url, () => yt.info(url));
      if (v.live) return res.status(400).json({ error: "Dieser Stream läuft noch. Nimm die Aufzeichnung, sobald er vorbei ist." });
      res.json({ stream: { ...v, platform } });
    } catch (e) { fail(res, e, "Der Link konnte nicht gelesen werden"); }
  });

  // Vorschaubilder über den eigenen Server
  app.get("/api/streams/thumb", auth.requireUser, async (req, res) => {
    let u;
    try { u = new URL(String(req.query.u || "")); } catch { return res.status(400).send("Ungültig"); }
    if (u.protocol !== "https:" || !THUMB_HOSTS.some((re) => re.test(u.hostname))) return res.status(400).send("Nicht erlaubt");
    try {
      const r = await fetch(u.href, { signal: AbortSignal.timeout(8000), redirect: "follow" });
      const type = r.headers.get("content-type") || "";
      if (!r.ok || !/^image\//.test(type)) return res.status(404).send("Kein Bild");
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 3_000_000) return res.status(413).send("Zu groß");
      res.setHeader("Content-Type", type);
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.end(buf);
    } catch { res.status(504).send("Zeitüberschreitung"); }
  });
}

module.exports = { register, resolveCreator };

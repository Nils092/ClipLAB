// Auto-Clips: Rohmaterial (Datei oder Link: YouTube, Twitch, Kick …) → Transkript → lustigste Stellen → fertige Hochformat-Clips
// mit eingebrannten Untertiteln, Hook, Caption und Hashtags. Jobs laufen nacheinander, damit der Server nicht überlastet.
const fs = require("fs");
const path = require("path");
const { once } = require("events");
const config = require("./config");
const { db, save, id, now } = require("./store");
const media = require("./media");
const { transcribe, available: whisperAvailable } = require("./transcribe");
const yt = require("./download");
const originTool = require("./origin");
const { findHighlights } = require("./highlights");
const { renderClip, thumbnail, preview, QUALITY } = require("./render");

const ROOT = path.join(config.dataDir, "projects");
fs.mkdirSync(ROOT, { recursive: true });
const dirOf = (p) => path.join(ROOT, p.id);
const VIDEO_EXT = [".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"];
const STEP = { wartet: "Wartet", download: "Lädt Video herunter", transkription: "Schreibt mit", analyse: "Sucht lustige Stellen", rendern: "Schneidet Clips", fertig: "Fertig", fehler: "Fehler" };

// Quelle des Originalvideos (vom Nutzer eingegeben oder per Link ermittelt)
function cleanOrigin(o) {
  if (!o || typeof o !== "object") return null;
  const s = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
  const url = s(o.url, 500);
  let handle = s(o.handle, 60).replace(/^@+/, "");
  const r = { creator: s(o.creator, 80), handle, format: s(o.format, 80), episode: s(o.episode, 80), title: s(o.title, 160), url: /^https?:\/\//i.test(url) ? url : "" };
  return r.creator || r.handle || r.format || r.title || r.url ? r : null;
}
// Plattform-Name aus dem Link
function platformName(url) {
  try { const h = new URL(url).hostname.replace(/^www\./, ""); return /youtu/.test(h) ? "YouTube" : /twitch/.test(h) ? "Twitch" : /kick/.test(h) ? "Kick" : /tiktok/.test(h) ? "TikTok" : /instagram/.test(h) ? "Instagram" : null; } catch { return null; }
}
// Hashtag aus Text: Buchstaben und Zahlen, Großschreibung je Wort bleibt (z. B. "30 Dishes Germany" → 30DishesGermany)
const tagOf = (t) => String(t || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
// Caption um den Verweis auf das Originalvideo ergänzen, Stil:
//   Ganze Folge auf YouTube: 30 Dishes Germany
//   @30DishesGermany #30Dishes #30DishesGermany #30DishesBangkok
function withOrigin(clip, origin) {
  if (!origin) return clip;
  const show = origin.format || origin.creator;
  const where = platformName(origin.url);
  const lines = [];
  if (show) lines.push(`Ganze Folge${where ? ` auf ${where}` : ""}: ${origin.creator || origin.format}`);
  else if (origin.title) lines.push(`Aus dem Video „${origin.title}“${where ? ` (${where})` : ""}`);
  const tags = [];
  const add = (t) => { const x = tagOf(t); if (x.length >= 3 && !tags.some((y) => y.toLowerCase() === x.toLowerCase())) tags.push(x); };
  if (origin.format) add(origin.format);
  if (origin.creator) add(origin.creator);
  const epName = (origin.episode || "").replace(/\b(folge|episode|ep\.?|teil|tag|day)\s*\d+\b/gi, "").trim();
  if (origin.format && epName) add(origin.format + " " + epName);
  const own = (clip.hashtags || []).filter((h) => !tags.some((t) => t.toLowerCase() === String(h).toLowerCase()));
  const hashtags = [...tags, ...own].slice(0, 8);
  const mention = origin.handle ? "@" + origin.handle : "";
  const caption = [String(clip.caption || "").trim(), lines.join("\n"), mention].filter(Boolean).join("\n");
  return { ...clip, caption: caption.slice(0, 2000), hashtags };
}
const stripOrigin = (caption) => String(caption || "").split("\n").filter((l) => !/^(Ganze Folge( auf \w+)?: |Aus dem Video „|@[\w.\-]+$|🎬 Aus: |▶️ Ganzes Video: )/.test(l.trim())).join("\n").replace(/\n{3,}/g, "\n\n").trim();
const creditOf = (origin) => (origin && origin.creator ? origin.creator : "");

function cleanOpts(o = {}) {
  const n = (v, d, a, b) => Math.min(b, Math.max(a, Number(v) || d));
  const minLen = n(o.minLen, 20, 5, 120), maxLen = Math.max(minLen + 5, n(o.maxLen, 60, 10, 180));
  return {
    count: n(o.count, 5, 1, 15), minLen, maxLen,
    layout: ["fit", "split"].includes(o.layout) ? o.layout : "crop", focus: ["left", "right", "center"].includes(o.focus) ? o.focus : "auto",
    autopost: o.autopost === true || o.autopost === "true",
    goal: ["funny", "viral", "reaction", "tips", "emotional"].includes(o.goal) ? o.goal : "funny",
    cam: ["tl", "tr", "bl", "br"].includes(o.cam) ? o.cam : "tl", camSize: Math.min(0.6, Math.max(0.12, Number(o.camSize) || 0.3)),
    campaign: typeof o.campaign === "string" && /^cmp_[\w-]+$/.test(o.campaign) ? o.campaign : null,
    origin: cleanOrigin(o.origin),                      // Quelle: Creator, Videotitel, Link
    cuts: !(o.cuts === false || o.cuts === "false"),   // stille Pausen rausschneiden
    sfx: !(o.sfx === false || o.sfx === "false"),      // dezenter Luftzug an Schnitten
    quality: ["fast", "balanced", "best"].includes(o.quality) ? o.quality : "balanced",   // Tempo vs. Bildqualität
  };
}

function newProject(user, fields) {
  const p = {
    id: id("prj"), userId: user.id, status: "wartet", step: STEP.wartet, progress: 0, error: null, note: null,
    clips: [], createdAt: now(), updatedAt: now(), ...fields,
  };
  fs.mkdirSync(dirOf(p), { recursive: true });
  db.projects.push(p);
  save();
  return p;
}

const exists = (p) => db.projects.includes(p);
function set(p, patch) { Object.assign(p, patch, { updatedAt: now() }); if (patch.status) p.step = STEP[patch.status] || p.step; save(); }

// ---------- Ablauf ----------
let busy = false, deps = {};
async function kick() {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      const p = db.projects.find((x) => x.status === "wartet");
      if (p) { await runProject(p).catch((e) => { console.error("Projekt", p.id, e); if (exists(p)) set(p, { status: "fehler", error: e.message }); }); continue; }
      const q = db.projects.find((x) => x.status === "fertig" && x.clips.some((c) => c.status === "wartet"));
      if (q) { const c = q.clips.find((x) => x.status === "wartet"); await renderOne(q, c); continue; }
      break;
    }
  } finally { busy = false; }
}

// Nur den Ton vorab laden (klein, schnell) und schon mitschreiben, während das Video noch lädt
async function earlyTranscript(p, dir) {
  const trFile = path.join(dir, "transcript.json"), loudFile = path.join(dir, "loud.json"), wav = path.join(dir, "early.wav");
  if (!whisperAvailable()) return;
  const a = await yt.download(p.url, dir, { audioOnly: true });
  try {
    await media.extractAudio(a, wav);
    const loud = await media.loudness(wav);
    const tr = await transcribe(wav, {});
    fs.writeFileSync(trFile, JSON.stringify(tr));
    fs.writeFileSync(loudFile, JSON.stringify(loud));
    console.log("Projekt", p.id, "Transkript fertig, während das Video lud");
  } finally { fs.rm(a, { force: true }, () => {}); fs.rm(wav, { force: true }, () => {}); }
}

async function runProject(p) {
  const dir = dirOf(p);
  // 1. Video per Link herunterladen – parallel dazu schon den Ton mitschreiben
  let metaFromLink = null, early = null;
  if (!p.srcFile && p.url) {
    set(p, { status: "download", progress: 0, error: null });
    if (!p.section && !fs.existsSync(path.join(dir, "transcript.json")))
      early = earlyTranscript(p, dir).catch((e) => console.error("Vorab-Transkript", p.id, e.message));
    let last = 0;
    const file = await yt.download(p.url, dir, {
      section: p.section || null,
      onProgress: (x) => { if (x - last >= 0.02 || x === 1) { last = x; set(p, { progress: x }); } },
      onTitle: (t) => { if (!p.nameFromUser) set(p, { name: t.slice(0, 120) }); },
      // Quelle aus dem Link übernehmen – vom Nutzer Eingetragenes hat Vorrang
      onMeta: (m) => { metaFromLink = m; },
    });
    set(p, { srcFile: path.basename(file) });
    if (early) { set(p, { status: "transkription", progress: 0.5 }); await early; }
  }
  if (!exists(p)) return;
  if (metaFromLink) set(p, { linkMeta: metaFromLink });
  const src = path.join(dir, p.srcFile);
  const info = await media.probe(src);
  if (info.duration > 4 * 3600) throw new Error("Video ist länger als 4 Stunden");
  set(p, { duration: info.duration, width: info.width, height: info.height, hasAudio: info.hasAudio });

  // 2. Ton analysieren und mitschreiben
  set(p, { status: "transkription", progress: 0, error: null });
  const trFile = path.join(dir, "transcript.json"), loudFile = path.join(dir, "loud.json"), wav = path.join(dir, "audio.wav");
  let tr = fs.existsSync(trFile) ? JSON.parse(fs.readFileSync(trFile, "utf8")) : null;
  let loud = fs.existsSync(loudFile) ? JSON.parse(fs.readFileSync(loudFile, "utf8")) : null;
  let note = null;
  if (info.hasAudio && (!tr || !loud)) {
    await media.extractAudio(src, wav);
    loud = await media.loudness(wav);
    fs.writeFileSync(loudFile, JSON.stringify(loud));
    if (whisperAvailable()) {
      let last = 0;
      tr = await transcribe(wav, { onWait: (w) => exists(p) && set(p, { note: `Groq-Limit erreicht – geht in ca. ${Math.ceil(w / 60)} Min. automatisch weiter` }), onProgress: (x) => { if (x - last >= 0.01) { last = x; if (exists(p)) set(p, { progress: x, note: null }); } } });
    } else {
      tr = { language: null, segments: [] };
      note = "Whisper ist nicht installiert – Clips ohne Untertitel";
    }
    fs.writeFileSync(trFile, JSON.stringify(tr));
    fs.rm(wav, { force: true }, () => {});
  }
  if (!info.hasAudio) { tr = { language: null, segments: [] }; loud = { step: 0.5, db: [] }; note = "Video hat keinen Ton – Clips ohne Untertitel"; }
  if (!exists(p)) return;

  // 3. Quelle bestimmen: Eingetragenes → Gedächtnis → Link-Daten → Dateiname → Gesprochenes
  if (!p.originResolved) {
    const user = db.users.find((u) => u.id === p.userId);
    const given = p.opts.origin || {};
    const meta = p.linkMeta ? { ...p.linkMeta } : {};
    if (!p.linkMeta && p.nameFromUser) meta.hint = String(p.name || "").replace(/[_.]+/g, " ").replace(/\b(final|export|render|cut|v\d+|\d{3,4}p|4k|hd|mp4|mov)\b/gi, "").replace(/\s+/g, " ").trim();
    meta.transcript = (tr.segments || []).slice(0, 60).map((s) => s.text || s.t || "").join(" ").slice(0, 1500);
    const origin = cleanOrigin(await originTool.resolve(user, given, meta));
    set(p, { opts: { ...p.opts, origin }, originResolved: true });
    if (origin && (given.format || given.handle || given.creator)) originTool.remember(user, origin);
    if (p.linkMeta && p.linkMeta.title && !p.nameFromUser) set(p, { name: p.linkMeta.title.slice(0, 120) });
  }

  // 4. Lustigste Stellen finden
  set(p, { status: "analyse", progress: 0, language: tr.language || null });
  const origin = p.opts.origin || (p.url ? cleanOrigin({ url: p.url }) : null);
  const hl = await findHighlights(tr, loud, info.duration, p.opts, { title: (origin && origin.title) || p.name, creator: origin && origin.creator, format: origin && origin.format, episode: origin && origin.episode, platform: p.platform });
  if (!hl.clips.length) throw new Error("Keine passenden Stellen gefunden – ist das Video lang genug?");
  const clips = hl.clips.map((c) => withOrigin(c, origin)).map((c, i) => ({
    id: `c${i + 1}`, ...c, layout: p.opts.layout, focus: p.opts.focus, cam: p.opts.cam, camSize: p.opts.camSize, status: "wartet", version: 0, error: null,
  }));
  set(p, { clips, method: hl.method, note: [note, hl.note].filter(Boolean).join(" · ") || null });

  // 4. Clips rendern
  set(p, { status: "rendern", progress: 0 });
  for (let i = 0; i < clips.length; i++) {
    if (!exists(p)) return;
    await renderOne(p, clips[i]);
    set(p, { progress: (i + 1) / clips.length });
  }
  set(p, { status: "fertig", progress: 1 });
  await planAuto(p);
}

// Autopilot: fertige Clips automatisch einplanen
async function planAuto(p) {
  if (!deps.autopilot || !p.autopost) return 0;
  try {
    const n = await deps.autopilot(p, (c) => path.join(dirOf(p), `${c.id}.mp4`));
    if (n) set(p, { note: [p.note, `Autopilot: ${n} Clip${n > 1 ? "s" : ""} eingeplant`].filter(Boolean).join(" · ") });
    return n;
  } catch (e) { set(p, { note: [p.note, `Autopilot: ${e.message}`].filter(Boolean).join(" · ") }); return 0; }
}

function wordsFor(p, start, end) {
  const f = path.join(dirOf(p), "transcript.json");
  if (!fs.existsSync(f)) return [];
  const tr = JSON.parse(fs.readFileSync(f, "utf8"));
  return tr.segments.flatMap((s) => s.words || []).filter((w) => w.e > start && w.s < end)
    .map((w) => ({ w: w.w, s: Math.max(0, w.s - start), e: Math.min(end, w.e) - start }));
}

// Ist eine Stelle im Clip still (nur Lautstärke, keine Wörter)? Lachen/Reaktionen sind laut und bleiben drin.
function quietFor(p, start) {
  const f = path.join(dirOf(p), "loud.json");
  if (!fs.existsSync(f)) return null;
  const loud = JSON.parse(fs.readFileSync(f, "utf8"));
  if (!loud.db || !loud.db.length) return null;
  const xs = loud.db.filter((x) => x > -70).sort((a, b) => a - b);
  const med = xs.length ? xs[Math.floor(xs.length / 2)] : -30;
  return (t0, t1) => {
    const i0 = Math.floor((start + t0) / loud.step), i1 = Math.max(i0 + 1, Math.ceil((start + t1) / loud.step));
    const seg = loud.db.slice(i0, i1); if (!seg.length) return true;
    return Math.max(...seg) < med - 2;   // leiser als der normale Sprechpegel
  };
}

async function renderOne(p, c) {
  const dir = dirOf(p);
  c.status = "rendern"; c.error = null; save();
  try {
    const dur = c.end - c.start;
    const out = path.join(dir, `${c.id}.mp4`);
    const allWords = wordsFor(p, c.start, c.end);
    const r = await renderClip({
      src: path.join(dir, p.srcFile), start: c.start, end: c.end, out, title: c.hook,
      words: c.subtitles === false ? [] : allWords,
      layout: c.layout, focus: c.focus, cam: c.cam, camSize: c.camSize, hasAudio: p.hasAudio !== false, srcW: p.width, srcH: p.height,
      quiet: quietFor(p, c.start), cuts: c.cuts !== false && p.opts.cuts !== false, sfx: c.sfx !== false && p.opts.sfx !== false,
      quality: p.opts.quality || "balanced",
    });
    c.cutInfo = { cuts: r.cuts, removed: r.removed, duration: Math.round(r.duration * 10) / 10 };
    await thumbnail(out, path.join(dir, `${c.id}.jpg`), Math.min(1.5, dur / 2)).catch(() => {});
    await preview(out, path.join(dir, `${c.id}.preview.mp4`)).catch((e) => console.error("Vorschau", p.id, c.id, e.message));
    c.status = "bereit"; c.version = (c.version || 0) + 1;
  } catch (e) {
    console.error("Render", p.id, c.id, e.message);
    c.status = "fehler"; c.error = e.message;
  }
  p.updatedAt = now(); save();
}

// ---------- Aufräumen ----------
function cleanup() {
  const limit = Date.now() - config.retentionDays * 24 * 3600 * 1000;
  for (const p of db.projects.slice()) {
    if (new Date(p.updatedAt).getTime() > limit || !["fertig", "fehler"].includes(p.status)) continue;
    removeProject(p);
  }
}
function removeProject(p) {
  const i = db.projects.indexOf(p);
  if (i >= 0) db.projects.splice(i, 1);
  fs.rm(dirOf(p), { recursive: true, force: true }, () => {});
  save();
}

// ---------- API ----------
const publicClip = (c) => ({
  id: c.id, start: c.start, end: c.end, hook: c.hook, caption: c.caption, hashtags: c.hashtags, score: c.score, reason: c.reason,
  layout: c.layout, focus: c.focus, cam: c.cam, camSize: c.camSize, subtitles: c.subtitles !== false, status: c.status, error: c.error, version: c.version, posted: c.posted || 0, autoPlanned: Boolean(c.autoPlanned), cutInfo: c.cutInfo || null, cuts: c.cuts !== false, sfx: c.sfx !== false,
});
const publicProject = (p, full) => ({
  id: p.id, name: p.name, source: p.url ? (p.platform || "Link") : "upload", section: p.section || null, url: p.url || null, status: p.status, step: p.step, progress: p.progress,
  error: p.error, note: p.note, method: p.method || null, duration: p.duration || null, createdAt: p.createdAt, updatedAt: p.updatedAt,
  opts: p.opts, origin: p.opts && p.opts.origin ? p.opts.origin : null, campaignName: p.opts && p.opts.campaign ? (db.campaigns.find((c) => c.id === p.opts.campaign)?.name || null) : null, autopost: Boolean(p.autopost), clipCount: p.clips.length, ready: p.clips.filter((c) => c.status === "bereit").length,
  ...(full ? { clips: p.clips.map(publicClip) } : { cover: p.clips.find((c) => c.status === "bereit")?.id || null }),
});

function register(app, auth, d) {
  deps = d;
  const { schedulePosts } = d;
  const mine = (req) => {
    const p = db.projects.find((x) => x.id === req.params.id && (x.userId === req.user.id || req.user.role === "admin"));
    if (!p) throw Object.assign(new Error("Projekt nicht gefunden"), { status: 404 });
    return p;
  };
  const clipOf = (p, cid) => {
    const c = p.clips.find((x) => x.id === cid);
    if (!c) throw Object.assign(new Error("Clip nicht gefunden"), { status: 404 });
    return c;
  };
  const max = config.maxProjectMB * 1024 * 1024;

  app.get("/api/sources", auth.requireUser, (req, res) => res.json({ sources: (req.user.sources || []).map((s) => ({ creator: s.creator, handle: s.handle, format: s.format })) }));
  app.get("/api/projects/info", auth.requireUser, (req, res) => res.json({
    whisper: whisperAvailable(), fastTranscribe: Boolean(config.groq.apiKey), youtube: yt.available(), links: yt.available(), claude: Boolean(config.claude.apiKey), maxMB: config.maxProjectMB,
  }));

  // Rohmaterial hochladen: Datei als Rohdaten im Body, Optionen in der URL
  app.post("/api/projects/upload", auth.requireUser, async (req, res) => {
    const name = String(req.query.name || "video.mp4").slice(0, 160);
    const ext = path.extname(name).toLowerCase();
    if (!VIDEO_EXT.includes(ext) && !/^video\//.test(req.headers["content-type"] || "")) return res.status(415).json({ error: "Bitte eine Videodatei hochladen (MP4, MOV, MKV, WebM)" });
    if (Number(req.headers["content-length"] || 0) > max) return res.status(413).json({ error: `Datei zu groß (max. ${config.maxProjectMB} MB)` });
    let opts = {};
    try { opts = JSON.parse(req.query.opts || "{}"); } catch {}
    const o = cleanOpts(opts);
    const p = newProject(req.user, { name: name.replace(/\.[^.]+$/, ""), nameFromUser: true, opts: o, autopost: o.autopost, status: "upload", step: "Wird hochgeladen" });
    const file = path.join(dirOf(p), "source" + (VIDEO_EXT.includes(ext) ? ext : ".mp4"));
    const ws = fs.createWriteStream(file);
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > max) throw Object.assign(new Error(`Datei zu groß (max. ${config.maxProjectMB} MB)`), { status: 413 });
        if (!ws.write(chunk)) await once(ws, "drain");
      }
      ws.end(); await once(ws, "finish");
      if (size < 1000) throw Object.assign(new Error("Datei ist leer"), { status: 400 });
    } catch (e) {
      ws.destroy(); removeProject(p);
      throw e.status ? e : Object.assign(new Error("Upload abgebrochen"), { status: 400 });
    }
    set(p, { srcFile: path.basename(file), status: "wartet" });
    kick();
    res.status(201).json({ project: publicProject(p) });
  });

  // Video per Link (YouTube, Twitch, Kick, TikTok, Instagram, X, Vimeo), optional nur ein Zeitbereich
  const fromLink = (req, res) => {
    const url = String(req.body.url || "").trim();
    const platform = yt.platformOf(url);
    if (!platform) return res.status(400).json({ error: "Bitte einen Link von YouTube, Twitch, Kick, TikTok, Instagram, X oder Vimeo einfügen" });
    if (!yt.available()) return res.status(503).json({ error: "Download per Link ist auf dem Server noch nicht installiert" });
    const from = yt.parseTime(req.body.from), to = yt.parseTime(req.body.to);
    if (Number.isNaN(from) || Number.isNaN(to)) return res.status(400).json({ error: "Zeit bitte als 1:20:00 oder 45:30 angeben" });
    if (from != null && to != null && to <= from) return res.status(400).json({ error: "„Bis“ muss nach „Von“ liegen" });
    const section = from != null || to != null ? { from: from || 0, to: to ?? null } : null;
    const o = cleanOpts(req.body.opts);
    const p = newProject(req.user, { name: `${platform}-Video`, url, platform, section, opts: o, autopost: o.autopost });
    kick();
    res.status(201).json({ project: publicProject(p) });
  };
  app.post("/api/projects/link", auth.requireUser, fromLink);
  app.post("/api/projects/youtube", auth.requireUser, fromLink);

  app.get("/api/projects", auth.requireUser, (req, res) => {
    res.json({ projects: db.projects.filter((p) => p.userId === req.user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((p) => publicProject(p)) });
  });
  app.get("/api/projects/:id", auth.requireUser, (req, res) => res.json({ project: publicProject(mine(req), true) }));

  app.get("/api/projects/:id/clips/:cid/video", auth.requireUser, (req, res) => {
    const p = mine(req), c = clipOf(p, req.params.cid);
    const h = { "Cache-Control": "private, max-age=60" };
    if (req.query.dl) h["Content-Disposition"] = `attachment; filename="${(p.name || "clip").replace(/[^\w\- ]+/g, "").slice(0, 40).trim() || "clip"}-${c.id}.mp4"`;
    const pv = path.join(dirOf(p), `${c.id}.preview.mp4`);
    // ?preview=1 → kleine Datei zum Abspielen (falls vorhanden), sonst die volle
    res.sendFile(req.query.preview && !req.query.dl && fs.existsSync(pv) ? pv : path.join(dirOf(p), `${c.id}.mp4`), h);
  });
  app.get("/api/projects/:id/clips/:cid/thumb", auth.requireUser, (req, res) => {
    const p = mine(req), c = clipOf(p, req.params.cid);
    res.sendFile(path.join(dirOf(p), `${c.id}.jpg`), { "Cache-Control": "private, max-age=60" });
  });

  // Clip bearbeiten; sichtbare Änderungen lösen neues Rendern aus
  app.patch("/api/projects/:id/clips/:cid", auth.requireUser, (req, res) => {
    const p = mine(req), c = clipOf(p, req.params.cid), b = req.body || {};
    let rerender = false;
    if (typeof b.hook === "string" && b.hook.trim() !== c.hook) { c.hook = b.hook.trim().slice(0, 120); rerender = true; }
    if (typeof b.caption === "string") c.caption = b.caption.slice(0, 2000);
    if (Array.isArray(b.hashtags)) c.hashtags = b.hashtags.map((h) => String(h).replace(/^#/, "").trim()).filter(Boolean).slice(0, 10);
    if (["crop", "fit", "split"].includes(b.layout) && b.layout !== c.layout) { c.layout = b.layout; rerender = true; }
    if (["tl", "tr", "bl", "br"].includes(b.cam) && b.cam !== c.cam) { c.cam = b.cam; rerender = true; }
    if (b.camSize != null && Number(b.camSize) !== c.camSize) { c.camSize = Math.min(0.6, Math.max(0.12, Number(b.camSize) || 0.3)); rerender = true; }
    if (["auto", "center", "left", "right"].includes(b.focus) && b.focus !== c.focus) { c.focus = b.focus; rerender = true; }
    if (typeof b.subtitles === "boolean" && b.subtitles !== (c.subtitles !== false)) { c.subtitles = b.subtitles; rerender = true; }
    if (typeof b.cuts === "boolean" && b.cuts !== (c.cuts !== false)) { c.cuts = b.cuts; rerender = true; }
    if (typeof b.sfx === "boolean" && b.sfx !== (c.sfx !== false)) { c.sfx = b.sfx; rerender = true; }
    if (b.start != null || b.end != null) {
      const s = Math.max(0, Number(b.start ?? c.start)), e = Math.min(p.duration || Infinity, Number(b.end ?? c.end));
      if (!(e - s >= 3 && e - s <= 180)) return res.status(400).json({ error: "Clip muss zwischen 3 und 180 Sekunden lang sein" });
      if (s !== c.start || e !== c.end) { c.start = Math.round(s * 100) / 100; c.end = Math.round(e * 100) / 100; rerender = true; }
    }
    if (rerender) { if (c.status === "rendern") return res.status(409).json({ error: "Clip wird gerade gerendert, bitte kurz warten" }); c.status = "wartet"; }
    p.updatedAt = now(); save();
    if (rerender) kick();
    res.json({ clip: publicClip(c) });
  });

  app.post("/api/projects/:id/clips/:cid/post", auth.requireUser, async (req, res) => {
    const p = mine(req), c = clipOf(p, req.params.cid);
    if (c.status !== "bereit") return res.status(409).json({ error: "Clip ist noch nicht fertig" });
    const tags = (c.hashtags || []).map((h) => "#" + h).join(" ");
    const caption = typeof req.body.caption === "string" ? req.body.caption : [c.caption, tags].filter(Boolean).join("\n\n");
    const out = await schedulePosts({
      user: req.user, srcFile: path.join(dirOf(p), `${c.id}.mp4`), copy: true, originalName: `${p.name}-${c.id}.mp4`,
      caption, accountIds: req.body.accountIds, scheduledAt: req.body.scheduledAt, tiktokMode: req.body.tiktokMode, tiktok: req.body.tiktok, campaignId: req.body.campaignId, campaign: req.body.campaign || p.opts.campaign,
    });
    c.posted = (c.posted || 0) + out.posts.length; save();
    res.status(201).json(out);
  });

  // Alle fertigen Clips eines Projekts auf einmal einplanen – im Abstand von gapMinutes (0 = alle sofort)
  app.post("/api/projects/:id/post-all", auth.requireUser, async (req, res) => {
    const p = mine(req);
    const ready = p.clips.filter((c) => c.status === "bereit");
    if (!ready.length) return res.status(409).json({ error: "Noch kein Clip fertig – bitte kurz warten" });
    const gap = Math.max(0, Math.min(24 * 60, Number(req.body.gapMinutes) || 0)) * 60_000;
    const start = req.body.scheduledAt ? new Date(req.body.scheduledAt).getTime() : Date.now();
    let n = 0, i = 0;
    for (const c of ready.sort((a, b) => (b.score || 0) - (a.score || 0))) {
      const tags = (c.hashtags || []).map((h) => "#" + h).join(" ");
      const out = await schedulePosts({
        user: req.user, srcFile: path.join(dirOf(p), `${c.id}.mp4`), copy: true, originalName: `${p.name}-${c.id}.mp4`,
        caption: [c.caption, tags].filter(Boolean).join("\n\n"), accountIds: req.body.accountIds,
        scheduledAt: new Date(start + i * gap).toISOString(), tiktokMode: req.body.tiktokMode, tiktok: req.body.tiktok, campaign: req.body.campaign || p.opts.campaign,
      });
      c.posted = (c.posted || 0) + out.posts.length; n += out.posts.length; i++;
    }
    save();
    res.status(201).json({ clips: i, posts: n });
  });

  // Bereits fertiges Projekt nachträglich an den Autopilot geben
  app.post("/api/projects/:id/autopilot", auth.requireUser, async (req, res) => {
    const p = mine(req);
    p.autopost = true; save();
    const n = p.status === "fertig" ? await planAuto(p) : 0;
    res.json({ planned: n, waiting: p.status !== "fertig" });
  });

  // Quelle nachtragen oder ändern: Captions und Hashtags aktualisieren
  app.post("/api/projects/:id/origin", auth.requireUser, (req, res) => {
    const p = mine(req);
    const old = p.opts.origin;
    const origin = cleanOrigin(req.body.origin);
    p.opts = { ...p.opts, origin };
    if (origin) originTool.remember(req.user, origin);
    for (const c of p.clips || []) {
      const oldTags = old ? [old.format, old.creator, old.format && old.episode ? old.format + " " + old.episode.replace(/\b(folge|episode|ep\.?|teil|tag|day)\s*\d+\b/gi, "").trim() : null].filter(Boolean).map((t) => tagOf(t).toLowerCase()) : [];
      const base = { ...c, caption: stripOrigin(c.caption), hashtags: (c.hashtags || []).filter((h) => !oldTags.includes(String(h).toLowerCase())) };
      const next = withOrigin(base, origin);
      c.caption = next.caption; c.hashtags = next.hashtags;
    }
    p.updatedAt = now(); save();
    res.json({ project: publicProject(p, true) });
  });

  app.post("/api/projects/:id/retry", auth.requireUser, (req, res) => {
    const p = mine(req);
    if (p.status !== "fehler") return res.status(400).json({ error: "Nur fehlgeschlagene Projekte können neu gestartet werden" });
    set(p, { status: "wartet", error: null, progress: 0 });
    kick();
    res.json({ ok: true });
  });

  app.delete("/api/projects/:id", auth.requireUser, (req, res) => { removeProject(mine(req)); res.json({ ok: true }); });
}

function start() {
  // Nach einem Neustart unterbrochene Jobs fortsetzen
  for (const p of db.projects) {
    if (p.status === "upload") removeProject(p);
    else if (!["fertig", "fehler"].includes(p.status)) p.status = "wartet";
    for (const c of p.clips || []) if (c.status === "rendern") c.status = "wartet";
  }
  save();
  setInterval(cleanup, 3600_000);
  setTimeout(kick, 3000);
}

module.exports = { register, start, kick, cleanOpts };

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
const { findHighlights } = require("./highlights");
const { renderClip, thumbnail } = require("./render");

const ROOT = path.join(config.dataDir, "projects");
fs.mkdirSync(ROOT, { recursive: true });
const dirOf = (p) => path.join(ROOT, p.id);
const VIDEO_EXT = [".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"];
const STEP = { wartet: "Wartet", download: "Lädt Video herunter", transkription: "Schreibt mit", analyse: "Sucht lustige Stellen", rendern: "Schneidet Clips", fertig: "Fertig", fehler: "Fehler" };

function cleanOpts(o = {}) {
  const n = (v, d, a, b) => Math.min(b, Math.max(a, Number(v) || d));
  const minLen = n(o.minLen, 20, 5, 120), maxLen = Math.max(minLen + 5, n(o.maxLen, 60, 10, 180));
  return {
    count: n(o.count, 5, 1, 15), minLen, maxLen,
    layout: ["fit", "split"].includes(o.layout) ? o.layout : "crop", focus: ["left", "right", "center"].includes(o.focus) ? o.focus : "auto",
    autopost: o.autopost === true || o.autopost === "true",
    cam: ["tl", "tr", "bl", "br"].includes(o.cam) ? o.cam : "tl", camSize: Math.min(0.6, Math.max(0.12, Number(o.camSize) || 0.3)),
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

async function runProject(p) {
  const dir = dirOf(p);
  // 1. Video per Link herunterladen
  if (!p.srcFile && p.url) {
    set(p, { status: "download", progress: 0, error: null });
    let last = 0;
    const file = await yt.download(p.url, dir, {
      section: p.section || null,
      onProgress: (x) => { if (x - last >= 0.02 || x === 1) { last = x; set(p, { progress: x }); } },
      onTitle: (t) => { if (!p.nameFromUser) set(p, { name: t.slice(0, 120) }); },
    });
    set(p, { srcFile: path.basename(file) });
  }
  if (!exists(p)) return;
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
      tr = await transcribe(wav, { onProgress: (x) => { if (x - last >= 0.01) { last = x; if (exists(p)) set(p, { progress: x }); } } });
    } else {
      tr = { language: null, segments: [] };
      note = "Whisper ist nicht installiert – Clips ohne Untertitel";
    }
    fs.writeFileSync(trFile, JSON.stringify(tr));
    fs.rm(wav, { force: true }, () => {});
  }
  if (!info.hasAudio) { tr = { language: null, segments: [] }; loud = { step: 0.5, db: [] }; note = "Video hat keinen Ton – Clips ohne Untertitel"; }
  if (!exists(p)) return;

  // 3. Lustigste Stellen finden
  set(p, { status: "analyse", progress: 0, language: tr.language || null });
  const hl = await findHighlights(tr, loud, info.duration, p.opts);
  if (!hl.clips.length) throw new Error("Keine passenden Stellen gefunden – ist das Video lang genug?");
  const clips = hl.clips.map((c, i) => ({
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

async function renderOne(p, c) {
  const dir = dirOf(p);
  c.status = "rendern"; c.error = null; save();
  try {
    const dur = c.end - c.start;
    const out = path.join(dir, `${c.id}.mp4`);
    await renderClip({
      src: path.join(dir, p.srcFile), start: c.start, end: c.end, out, title: c.hook,
      words: c.subtitles === false ? [] : wordsFor(p, c.start, c.end),
      layout: c.layout, focus: c.focus, cam: c.cam, camSize: c.camSize, hasAudio: p.hasAudio !== false, srcW: p.width, srcH: p.height,
    });
    await thumbnail(out, path.join(dir, `${c.id}.jpg`), Math.min(1.5, dur / 2)).catch(() => {});
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
  layout: c.layout, focus: c.focus, cam: c.cam, camSize: c.camSize, subtitles: c.subtitles !== false, status: c.status, error: c.error, version: c.version, posted: c.posted || 0, autoPlanned: Boolean(c.autoPlanned),
});
const publicProject = (p, full) => ({
  id: p.id, name: p.name, source: p.url ? (p.platform || "Link") : "upload", section: p.section || null, url: p.url || null, status: p.status, step: p.step, progress: p.progress,
  error: p.error, note: p.note, method: p.method || null, duration: p.duration || null, createdAt: p.createdAt, updatedAt: p.updatedAt,
  opts: p.opts, autopost: Boolean(p.autopost), clipCount: p.clips.length, ready: p.clips.filter((c) => c.status === "bereit").length,
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
    res.sendFile(path.join(dirOf(p), `${c.id}.mp4`), h);
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
      caption, accountIds: req.body.accountIds, scheduledAt: req.body.scheduledAt, tiktokMode: req.body.tiktokMode, campaignId: req.body.campaignId,
    });
    c.posted = (c.posted || 0) + out.posts.length; save();
    res.status(201).json(out);
  });

  // Bereits fertiges Projekt nachträglich an den Autopilot geben
  app.post("/api/projects/:id/autopilot", auth.requireUser, async (req, res) => {
    const p = mine(req);
    p.autopost = true; save();
    const n = p.status === "fertig" ? await planAuto(p) : 0;
    res.json({ planned: n, waiting: p.status !== "fertig" });
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

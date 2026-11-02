const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const config = require("./config");
const { db, save, id, now, enc, videoDir } = require("./store");
const auth = require("./auth");
const tiktok = require("./platforms/tiktok");
const instagram = require("./platforms/instagram");
const video = require("./video");
const publisher = require("./publisher");
const projects = require("./projects");
const autopilot = require("./autopilot");
const push = require("./push");
const { createApp, readForm } = require("./web");

const app = createApp();
const MAX_UPLOAD = 500 * 1024 * 1024;
fs.mkdirSync(path.join(videoDir, "incoming"), { recursive: true });

// ---------- Einfacher Schutz gegen zu viele Login-Versuche ----------
const attempts = new Map();
function throttle(req, res, next) {
  const k = req.ip;
  const a = attempts.get(k) || { n: 0, t: Date.now() };
  if (Date.now() - a.t > 15 * 60_000) { a.n = 0; a.t = Date.now(); }
  a.n++; attempts.set(k, a);
  if (a.n > 20) return res.status(429).json({ error: "Zu viele Versuche. Bitte in 15 Minuten erneut probieren." });
  next();
}

// ---------- Konto ----------
app.post("/api/register", throttle, (req, res) => {
  const { email, name, password, invite } = req.body || {};
  const first = db.users.length === 0;
  if (!first && (!config.inviteCode || invite !== config.inviteCode)) return res.status(403).json({ error: "Einladungscode ist falsch" });
  try {
    const user = auth.createUser({ email, name, password });
    auth.setSession(res, user.id);
    res.json({ user: auth.publicUser(user) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post("/api/login", throttle, (req, res) => {
  const { email, password } = req.body || {};
  const user = db.users.find((u) => u.email === String(email || "").trim().toLowerCase() && !u.disabled);
  if (!user || !auth.checkPassword(String(password || ""), user.passwordHash)) return res.status(401).json({ error: "E-Mail oder Passwort stimmt nicht" });
  auth.setSession(res, user.id);
  res.json({ user: auth.publicUser(user) });
});

app.post("/api/logout", (req, res) => { auth.clearSession(res); res.json({ ok: true }); });

app.get("/api/session", (req, res) => {
  const u = auth.userFromRequest(req);
  res.json({
    user: u ? auth.publicUser(u) : null,
    firstRun: db.users.length === 0,
    platforms: { tiktok: config.tiktok.enabled, instagram: config.instagram.enabled },
    tiktokUnaudited: config.tiktok.unaudited,
    clippingApp: Boolean(config.clippingAppUrl),
    ffmpeg: video.hasFfmpeg,
    // Nur Admins sehen den Einladungscode (für den Einladungslink im Dashboard)
    invite: u && u.role === "admin" ? config.inviteCode || null : undefined,
  });
});

app.post("/api/apikey", auth.requireUser, (req, res) => res.json({ apiKey: auth.newApiKey(req.user) }));

app.put("/api/settings", auth.requireUser, (req, res) => {
  const { name, clippingAppKey } = req.body || {};
  if (typeof name === "string" && name.trim()) req.user.name = name.trim().slice(0, 60);
  if (typeof clippingAppKey === "string") req.user.clippingAppKey = clippingAppKey.trim() ? enc(clippingAppKey.trim()) : null;
  save();
  res.json({ user: auth.publicUser(req.user) });
});

// ---------- Accounts verbinden (OAuth) ----------
const states = new Map(); // state -> { userId, platform, exp }
const PLATFORMS = { tiktok, instagram };

app.get("/auth/:platform/start", auth.requireUser, (req, res) => {
  const p = req.params.platform;
  if (!PLATFORMS[p] || !config[p].enabled) return res.status(400).send("Diese Plattform ist auf dem Server nicht eingerichtet (.env prüfen).");
  const state = crypto.randomBytes(16).toString("base64url");
  states.set(state, { userId: req.user.id, platform: p, exp: Date.now() + 10 * 60_000 });
  res.redirect(PLATFORMS[p].authorizeUrl(state));
});

app.get("/auth/:platform/callback", async (req, res) => {
  const p = req.params.platform;
  const st = states.get(String(req.query.state || ""));
  states.delete(String(req.query.state || ""));
  const back = (msg) => res.redirect(`/?${new URLSearchParams({ meldung: msg })}`);
  if (!st || st.platform !== p || st.exp < Date.now()) return back("Anmeldung abgelaufen. Bitte nochmal verbinden.");
  if (req.query.error) return back(`Verbindung abgebrochen: ${req.query.error_description || req.query.error}`);
  try {
    let t, prof;
    if (p === "tiktok") {
      t = await tiktok.exchangeCode(String(req.query.code));
      prof = await tiktok.profile(t.accessToken);
    } else {
      t = await instagram.exchangeCode(String(req.query.code).replace(/#_$/, ""));
      prof = await instagram.profile(t.accessToken);
      t.externalId = prof.externalId;
    }
    let acc = db.accounts.find((a) => a.platform === p && a.externalId === t.externalId);
    if (acc && acc.userId !== st.userId) return back("Dieser Account ist bereits bei einem anderen Clipper verbunden.");
    if (!acc) { acc = { id: id("acc"), userId: st.userId, platform: p, externalId: t.externalId, createdAt: now() }; db.accounts.push(acc); }
    Object.assign(acc, {
      username: prof.username || acc.username || p, accessToken: enc(t.accessToken), refreshToken: enc(t.refreshToken),
      expiresAt: t.expiresAt, updatedAt: now(), problem: null,
    });
    save();
    back(`${p === "tiktok" ? "TikTok" : "Instagram"}-Account ${acc.username} verbunden.`);
  } catch (e) {
    console.error(e);
    back(`Verbindung fehlgeschlagen: ${e.message}`);
  }
});

const publicAccount = (a) => ({ id: a.id, platform: a.platform, username: a.username, problem: a.problem || null, connectedAt: a.createdAt });
app.get("/api/accounts", auth.requireUser, (req, res) => {
  res.json({ accounts: db.accounts.filter((a) => a.userId === req.user.id).map(publicAccount) });
});
app.delete("/api/accounts/:id", auth.requireUser, (req, res) => {
  const i = db.accounts.findIndex((a) => a.id === req.params.id && a.userId === req.user.id);
  if (i < 0) return res.status(404).json({ error: "Account nicht gefunden" });
  db.accounts.splice(i, 1);
  db.posts.filter((p) => p.accountId === req.params.id && p.status === "geplant").forEach((p) => { p.status = "abgebrochen"; });
  save();
  res.json({ ok: true });
});

// ---------- Clips hochladen und einplanen ----------
// Liest das Formular und legt das Video in einen Eingangsordner
async function receiveUpload(req, res, next) {
  const form = await readForm(req, MAX_UPLOAD);
  const f = form.get("video");
  req.body = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") req.body[k] = v;
  if (f && typeof f !== "string") {
    const name = f.name || "clip.mp4";
    if (!/^video\//.test(f.type) && !/\.(mp4|mov|webm)$/i.test(name)) return res.status(415).json({ error: "Bitte ein Video (MP4, MOV oder WebM) hochladen" });
    const tmp = path.join(videoDir, "incoming", crypto.randomBytes(12).toString("hex"));
    await fs.promises.writeFile(tmp, Buffer.from(await f.arrayBuffer()));
    req.file = { path: tmp, mimetype: f.type || "", originalname: name };
  }
  await next();
}

// Legt einen Clip an und plant ihn für die gewählten Accounts ein (genutzt von Studio, API und Auto-Clips)
async function schedulePosts({ user, srcFile, copy, mimetype = "video/mp4", originalName, caption, accountIds, scheduledAt, tiktokMode, campaignId, auto = false }) {
  if (typeof accountIds === "string") { try { accountIds = JSON.parse(accountIds || "[]"); } catch { accountIds = []; } }
  const accounts = db.accounts.filter((a) => (accountIds || []).includes(a.id) && a.userId === user.id);
  if (!accounts.length) {
    if (!copy) fs.rm(srcFile, { force: true }, () => {});
    throw Object.assign(new Error("Keine gültigen Ziel-Accounts gewählt"), { status: 400 });
  }
  const clipId = id("clp");
  const file = `${clipId}.mp4`;
  try {
    if (copy) await fs.promises.copyFile(srcFile, path.join(videoDir, file));
    else {
      const isMp4 = /mp4|quicktime/.test(mimetype) || /\.(mp4|mov)$/i.test(originalName || "");
      await video.normalize(srcFile, path.join(videoDir, file), { isMp4 });
    }
  } catch (e) {
    if (!copy) fs.rm(srcFile, { force: true }, () => {});
    throw Object.assign(new Error(`Video konnte nicht verarbeitet werden: ${e.message}`), { status: 422 });
  }
  const scheduled = new Date(scheduledAt || Date.now());
  const clip = { id: clipId, userId: user.id, file, caption: String(caption || "").slice(0, 2200), originalName: originalName || file, createdAt: now() };
  db.clips.push(clip);
  const posts = accounts.map((a) => ({
    id: id("pst"), userId: user.id, clipId, accountId: a.id, platform: a.platform,
    tiktokMode: tiktokMode === "direct" ? "direct" : "inbox",
    campaignId: String(campaignId || "").trim() || null,
    scheduledAt: (isNaN(scheduled) ? new Date() : scheduled).toISOString(),
    status: "geplant", attempts: 0, createdAt: now(), auto: Boolean(auto),
  }));
  db.posts.push(...posts);
  save();
  return { clip: { id: clip.id }, posts: posts.map((p) => p.id) };
}

app.post("/api/clips", auth.requireUser, receiveUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Kein Video empfangen (Feld „video“)" });
  const out = await schedulePosts({
    user: req.user, srcFile: req.file.path, mimetype: req.file.mimetype, originalName: req.file.originalname,
    caption: req.body.caption, accountIds: req.body.accountIds, scheduledAt: req.body.scheduledAt,
    tiktokMode: req.body.tiktokMode, campaignId: req.body.campaignId,
  });
  res.status(201).json(out);
});

// ---------- Auto-Clips (Rohmaterial / YouTube → lustige Clips mit Untertiteln) ----------
projects.register(app, auth, { schedulePosts, autopilot: (p, fileFor) => autopilot.planProject(p, schedulePosts, fileFor) });
autopilot.register(app, auth);
push.register(app, auth);

app.get("/api/posts", auth.requireUser, (req, res) => {
  const mine = db.posts.filter((p) => p.userId === req.user.id).sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)).slice(0, 300);
  res.json({
    posts: mine.map((p) => {
      const clip = db.clips.find((c) => c.id === p.clipId) || {};
      const acc = db.accounts.find((a) => a.id === p.accountId);
      return {
        id: p.id, platform: p.platform, account: acc?.username || "(getrennt)", status: p.status, scheduledAt: p.scheduledAt, auto: Boolean(p.auto),
        publishedAt: p.publishedAt || null, permalink: p.permalink || null, error: p.error ? (p.status === "fehler" ? p.error : p.status === "geplant" ? `Versuch ${p.attempts} fehlgeschlagen (${p.error}), neuer Versuch ist geplant` : null) : null, note: p.note || null,
        caption: (clip.caption || "").slice(0, 140), campaignId: p.campaignId, submission: p.submission || null,
        mode: p.effectiveMode || (p.platform === "tiktok" ? (config.tiktok.unaudited ? "inbox" : p.tiktokMode) : null),
      };
    }),
  });
});

app.post("/api/posts/:id/retry", auth.requireUser, (req, res) => {
  const p = db.posts.find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!p || !["fehler", "abgebrochen"].includes(p.status)) return res.status(400).json({ error: "Dieser Post kann nicht erneut versucht werden" });
  Object.assign(p, { status: "geplant", attempts: 0, error: null, scheduledAt: now() });
  save();
  res.json({ ok: true });
});

app.delete("/api/posts/:id", auth.requireUser, (req, res) => {
  const p = db.posts.find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!p || p.status !== "geplant") return res.status(400).json({ error: "Nur geplante Posts können abgebrochen werden" });
  p.status = "abgebrochen";
  save();
  res.json({ ok: true });
});

// ---------- Admin ----------
app.get("/api/admin/users", auth.requireAdmin, (req, res) => {
  res.json({
    users: db.users.map((u) => ({
      ...auth.publicUser(u), disabled: Boolean(u.disabled),
      accounts: db.accounts.filter((a) => a.userId === u.id).length,
      published: db.posts.filter((p) => p.userId === u.id && p.status === "veröffentlicht").length,
    })),
  });
});
app.patch("/api/admin/users/:id", auth.requireAdmin, (req, res) => {
  const u = db.users.find((x) => x.id === req.params.id);
  if (!u || u.id === req.user.id) return res.status(400).json({ error: "Nicht möglich" });
  if (typeof req.body.disabled === "boolean") u.disabled = req.body.disabled;
  save();
  res.json({ ok: true });
});

// ---------- Öffentliche Video-URL für Instagram ----------
app.get("/media/:token.mp4", (req, res) => {
  const clip = db.clips.find((c) => c.publicToken && c.publicToken === req.params.token && !c.deleted);
  if (!clip) return res.status(404).end();
  res.sendFile(path.join(videoDir, clip.file), { "Content-Type": "video/mp4", "Cache-Control": "no-store" });
});

// ---------- Oberflächen ----------
const pub = path.join(__dirname, "..", "public");
app.get("/studio-body.html", (req, res) => res.redirect("/studio"));
app.static(pub);

app.listen(config.port, () => {
  console.log(`ClipLab läuft auf Port ${config.port} – ${config.baseUrl}`);
  console.log(`TikTok: ${config.tiktok.enabled ? "eingerichtet" : "nicht eingerichtet"}${config.tiktok.unaudited ? " (unauditiert → Entwurf-Modus)" : ""} · Instagram: ${config.instagram.enabled ? "eingerichtet" : "nicht eingerichtet"} · ffmpeg: ${video.hasFfmpeg ? "ja" : "nein"}`);
  publisher.start();
  projects.start();
});

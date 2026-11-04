const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const config = require("./config");
const { db, save, id, now, enc, videoDir } = require("./store");
const auth = require("./auth");
const tiktok = require("./platforms/tiktok");
const instagram = require("./platforms/instagram");
const youtube = require("./platforms/youtube");
const PLATFORM_NAME = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };
const video = require("./video");
const publisher = require("./publisher");
const projects = require("./projects");
const autopilot = require("./autopilot");
const stats = require("./stats");
const push = require("./push");
const mail = require("./mail");
const { createApp, readForm } = require("./web");

const app = createApp();
const MAX_UPLOAD = 2000 * 1024 * 1024;
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
// Wie neue Clipper reinkommen: mit E-Mail-Bestätigung (wenn ein Postfach eingerichtet ist), per Code oder gar nicht
function registrationMode() {
  if (["mail", "invite", "closed"].includes(config.registration)) return config.registration === "mail" && !mail.enabled() ? "invite" : config.registration;
  return mail.enabled() ? "mail" : config.inviteCode ? "invite" : "closed";
}
const tokenHash = (t) => crypto.createHash("sha256").update(t).digest("hex");
async function sendVerification(user) {
  const token = crypto.randomBytes(24).toString("base64url");
  user.verifyHash = tokenHash(token); user.verifyExp = Date.now() + 48 * 3600_000; save();
  await mail.sendVerification(user, `${config.baseUrl}/bestaetigen?token=${token}`);
}

app.post("/api/register", throttle, async (req, res) => {
  const { email, name, password, invite } = req.body || {};
  const first = db.users.length === 0, mode = registrationMode();
  if (!first && mode === "closed") return res.status(403).json({ error: "Registrierung ist derzeit geschlossen" });
  if (!first && mode === "invite" && (!config.inviteCode || invite !== config.inviteCode)) return res.status(403).json({ error: "Einladungscode ist falsch" });
  let user;
  try { user = auth.createUser({ email, name, password }); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  if (first || mode !== "mail") {
    auth.setSession(res, user.id);
    return res.json({ user: auth.publicUser(user) });
  }
  user.verified = false; save();
  try { await sendVerification(user); }
  catch (e) {
    console.error("Bestätigungs-Mail:", e.message);
    db.users.splice(db.users.indexOf(user), 1); save();
    return res.status(502).json({ error: "Bestätigungs-Mail konnte nicht gesendet werden. Bitte später nochmal versuchen." });
  }
  res.json({ needsVerification: true, email: user.email });
});

app.get("/bestaetigen", (req, res) => {
  const h = tokenHash(String(req.query.token || ""));
  const u = db.users.find((x) => x.verifyHash === h && x.verifyExp > Date.now());
  if (!u) return res.redirect(`/?${new URLSearchParams({ meldung: "Bestätigungslink ist ungültig oder abgelaufen. Bitte melde dich an, um einen neuen zu bekommen." })}`);
  u.verified = true; delete u.verifyHash; delete u.verifyExp; save();
  auth.setSession(res, u.id);
  res.redirect(`/?${new URLSearchParams({ meldung: "E-Mail bestätigt – willkommen bei ClipLab!" })}`);
});

app.post("/api/verify/resend", throttle, async (req, res) => {
  const u = db.users.find((x) => x.email === String(req.body.email || "").trim().toLowerCase() && x.verified === false);
  if (u) await sendVerification(u).catch((e) => console.error("Bestätigungs-Mail:", e.message));
  res.json({ ok: true }); // verrät nicht, ob es die Adresse gibt
});

app.post("/api/login", throttle, (req, res) => {
  const { email, password } = req.body || {};
  const user = db.users.find((u) => u.email === String(email || "").trim().toLowerCase() && !u.disabled);
  if (!user || !auth.checkPassword(String(password || ""), user.passwordHash)) return res.status(401).json({ error: "E-Mail oder Passwort stimmt nicht" });
  if (user.verified === false) return res.status(403).json({ error: "Bitte bestätige zuerst deine E-Mail-Adresse – der Link steht in der Mail von ClipLab.", unverified: true });
  auth.setSession(res, user.id);
  res.json({ user: auth.publicUser(user) });
});

app.post("/api/logout", (req, res) => { auth.clearSession(res); res.json({ ok: true }); });

app.get("/api/session", (req, res) => {
  const u = auth.userFromRequest(req);
  res.json({
    user: u ? auth.publicUser(u) : null,
    firstRun: db.users.length === 0,
    registration: registrationMode(),
    env: config.appEnv,
    platforms: { tiktok: config.tiktok.enabled, instagram: config.instagram.enabled, youtube: config.youtube.enabled },
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
const PLATFORMS = { tiktok, instagram, youtube };

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
  const back = (msg) => res.redirect(`/einstellungen?${new URLSearchParams({ meldung: msg })}`);
  if (!st || st.platform !== p || st.exp < Date.now()) return back("Anmeldung abgelaufen. Bitte nochmal verbinden.");
  if (req.query.error) return back(`Verbindung abgebrochen: ${req.query.error_description || req.query.error}`);
  try {
    let t, profs;
    if (p === "tiktok") {
      t = await tiktok.exchangeCode(String(req.query.code));
      const prof = await tiktok.profile(t.accessToken);
      profs = [{ ...prof, externalId: t.externalId }];
    } else if (p === "youtube") {
      t = await youtube.exchangeCode(String(req.query.code));
      profs = await youtube.profiles(t.accessToken);   // ein Google-Konto kann mehrere Kanäle haben
    } else {
      t = await instagram.exchangeCode(String(req.query.code).replace(/#_$/, ""));
      try { profs = await instagram.profiles(t.accessToken); }   // bei Unified Login ggf. mehrere Accounts
      catch (e) {
        if (!instagram.unified() || !/kein Instagram-Account/.test(e.message)) throw e;
        // Ausweg: Zugang kurz merken und den Clipper die Instagram-ID eintragen lassen
        const key = crypto.randomBytes(16).toString("base64url");
        pendingIg.set(key, { userId: st.userId, t, exp: Date.now() + 20 * 60_000 });
        return res.redirect(`/einstellungen?ig_manual=${key}`);
      }
    }
    const names = [];
    for (const prof of profs) {
      let acc = db.accounts.find((a) => a.platform === p && a.externalId === prof.externalId);
      if (acc && acc.userId !== st.userId) { names.push(`${prof.username || prof.externalId} (gehört schon einem anderen Clipper)`); continue; }
      if (!acc) { acc = { id: id("acc"), userId: st.userId, platform: p, externalId: prof.externalId, createdAt: now() }; db.accounts.push(acc); }
      Object.assign(acc, {
        username: prof.username || acc.username || p, accessToken: enc(t.accessToken), refreshToken: enc(t.refreshToken),
        expiresAt: t.expiresAt, mode: t.mode || null, updatedAt: now(), problem: null,
      });
      names.push(acc.username);
    }
    save();
    back(`${PLATFORM_NAME[p]}: ${names.join(", ")} verbunden.`);
  } catch (e) {
    console.error(e);
    back(`Verbindung fehlgeschlagen: ${e.message}`);
  }
});

// Instagram-Account per ID verbinden (wenn Meta die Freigabe nach dem Login nicht auflistet)
const pendingIg = new Map(); // key -> { userId, t, exp }
app.post("/api/instagram/manual", auth.requireUser, async (req, res) => {
  const pend = pendingIg.get(String(req.body.key || ""));
  if (!pend || pend.userId !== req.user.id || pend.exp < Date.now()) return res.status(400).json({ error: "Anmeldung abgelaufen – bitte Instagram nochmal verbinden" });
  const igId = String(req.body.igId || "").replace(/\D/g, "");
  if (igId.length < 8) return res.status(400).json({ error: "Bitte die lange Zahl (Instagram-ID) eintragen" });
  let prof;
  try { prof = await instagram.accountById(pend.t.accessToken, igId); }
  catch (e) { return res.status(400).json({ error: `ClipLab hat keinen Zugriff auf diesen Account (${e.message}). Ist er in Meta unter „Verknüpfte Apps → Cliplab“ freigegeben?` }); }
  let acc = db.accounts.find((a) => a.platform === "instagram" && a.externalId === prof.externalId);
  if (acc && acc.userId !== req.user.id) return res.status(409).json({ error: "Dieser Account ist bereits bei einem anderen Clipper verbunden" });
  if (!acc) { acc = { id: id("acc"), userId: req.user.id, platform: "instagram", externalId: prof.externalId, createdAt: now() }; db.accounts.push(acc); }
  Object.assign(acc, { username: prof.username, accessToken: enc(pend.t.accessToken), refreshToken: enc(pend.t.refreshToken), expiresAt: pend.t.expiresAt, mode: pend.t.mode || null, updatedAt: now(), problem: null });
  pendingIg.delete(String(req.body.key));
  save();
  res.json({ account: { id: acc.id, username: acc.username } });
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

// ---------- Performance: Kennzahlen und Erkenntnisse ----------
app.get("/api/stats", auth.requireUser, (req, res) => res.json(stats.summary(req.user.id)));
const lastRefresh = new Map();
app.post("/api/stats/refresh", auth.requireUser, async (req, res) => {
  if (Date.now() - (lastRefresh.get(req.user.id) || 0) < 5 * 60_000) return res.status(429).json({ error: "Gerade erst aktualisiert – bitte in ein paar Minuten nochmal" });
  lastRefresh.set(req.user.id, Date.now());
  const n = await stats.collect({ force: true, userId: req.user.id });
  res.json({ updated: n, ...stats.summary(req.user.id) });
});

// ---------- Kampagnen: wofür wird geclippt (Briefing, Link zur Clipping-App, Hashtags, Deadline) ----------
function cleanCampaign(b, c = {}) {
  const s = (v, n) => String(v ?? "").trim().slice(0, n);
  const name = s(b.name, 80); if (!name) throw Object.assign(new Error("Name der Kampagne fehlt"), { status: 400 });
  const link = s(b.link, 500); if (link && !/^https?:\/\//i.test(link)) throw Object.assign(new Error("Link muss mit http(s):// beginnen"), { status: 400 });
  const deadline = s(b.deadline, 10); if (deadline && isNaN(Date.parse(deadline))) throw Object.assign(new Error("Deadline ist kein Datum"), { status: 400 });
  return { ...c, name, brief: s(b.brief, 2000), link, externalId: s(b.externalId, 120),
    hashtags: [...new Set(String(b.hashtags || "").split(/[\s,#]+/).map((h) => h.trim()).filter(Boolean))].slice(0, 20), deadline };
}
const campaignStats = (c, userId = null) => {
  const ps = db.posts.filter((p) => p.campaign === c.id && (userId ? p.userId === userId : true));
  return { posts: ps.length, published: ps.filter((p) => p.status === "veröffentlicht").length, views: ps.reduce((a, p) => a + (Number(p.stats?.views) || 0), 0) };
};
const isMember = (c, userId) => c.userId === userId || (c.members || []).some((m) => m.userId === userId);
const campaignAccess = (campaignId, userId) => { const c = db.campaigns.find((x) => x.id === campaignId); return c && isMember(c, userId) ? c : null; };
// Eigene Kampagnen (Rolle owner) und Kampagnen, zu denen man eingeladen wurde (Rolle member, nur eigene Zahlen)
app.get("/api/campaigns", auth.requireUser, (req, res) => {
  const mine = db.campaigns.filter((c) => c.userId === req.user.id).map((c) => ({ ...c, role: "owner", members: (c.members || []).length, ...campaignStats(c) }));
  const joined = db.campaigns.filter((c) => c.userId !== req.user.id && isMember(c, req.user.id)).map((c) => ({
    id: c.id, name: c.name, brief: c.brief, link: c.link, hashtags: c.hashtags, deadline: c.deadline, role: "member",
    owner: db.users.find((u) => u.id === c.userId)?.name || "unbekannt", ...campaignStats(c, req.user.id),
  }));
  res.json({ campaigns: [...mine, ...joined] });
});
// Einladungslink: wer ihn öffnet, wird Mitglied (nach Anmeldung/Registrierung)
app.post("/api/campaigns/:id/invite", auth.requireUser, (req, res) => {
  const c = db.campaigns.find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!c) return res.status(404).json({ error: "Kampagne nicht gefunden" });
  if (!c.inviteToken || req.body?.renew) { c.inviteToken = crypto.randomBytes(18).toString("base64url"); save(); }
  res.json({ url: `${config.baseUrl}/kampagne?token=${c.inviteToken}` });
});
app.get("/kampagne", (req, res) => {
  const token = String(req.query.token || "");
  const c = db.campaigns.find((x) => x.inviteToken && x.inviteToken === token);
  if (!c) return res.redirect(`/?${new URLSearchParams({ meldung: "Dieser Kampagnen-Link ist ungültig oder wurde erneuert." })}`);
  const u = auth.userFromRequest(req);
  if (u) { joinCampaign(c, u); return res.redirect(`/auto?${new URLSearchParams({ meldung: `Du bist jetzt Clipper in der Kampagne „${c.name}“.` })}#kampagnen`); }
  res.cookie("cl_join", token, { sameSite: "lax", secure: config.baseUrl.startsWith("https://"), maxAge: 2 * 3600_000, path: "/" });
  res.redirect(`/?${new URLSearchParams({ meldung: `Melde dich an oder registriere dich, dann bist du Clipper in der Kampagne „${c.name}“.` })}`);
});
function joinCampaign(c, u) {
  if (c.userId === u.id) return false;
  c.members = c.members || [];
  if (!c.members.some((m) => m.userId === u.id)) { c.members.push({ userId: u.id, joinedAt: now() }); save(); return true; }
  return false;
}
// Beitritt nach Anmeldung (Token aus Cookie oder Body)
app.post("/api/campaigns/join", auth.requireUser, (req, res) => {
  const token = String(req.body?.token || "");
  const c = db.campaigns.find((x) => x.inviteToken && x.inviteToken === token);
  res.clearCookie("cl_join", { path: "/" });
  if (!c) return res.status(404).json({ error: "Kampagnen-Link ungültig" });
  joinCampaign(c, req.user);
  res.json({ campaign: { id: c.id, name: c.name } });
});
app.post("/api/campaigns/:id/leave", auth.requireUser, (req, res) => {
  const c = db.campaigns.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "Kampagne nicht gefunden" });
  c.members = (c.members || []).filter((m) => m.userId !== req.user.id); save();
  res.json({ ok: true });
});
app.delete("/api/campaigns/:id/members/:uid", auth.requireUser, (req, res) => {
  const c = db.campaigns.find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!c) return res.status(404).json({ error: "Kampagne nicht gefunden" });
  c.members = (c.members || []).filter((m) => m.userId !== req.params.uid); save();
  res.json({ ok: true });
});
// Übersicht für den Auftraggeber: wer hat was wo gepostet, mit Kennzahlen
app.get("/api/campaigns/:id/overview", auth.requireUser, (req, res) => {
  const c = db.campaigns.find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!c) return res.status(404).json({ error: "Kampagne nicht gefunden" });
  const ps = db.posts.filter((p) => p.campaign === c.id);
  const people = [{ userId: c.userId, joinedAt: c.createdAt, owner: true }, ...(c.members || [])];
  const members = people.map((m) => {
    const u = db.users.find((x) => x.id === m.userId); const mine = ps.filter((p) => p.userId === m.userId);
    return { userId: m.userId, name: u?.name || "(gelöscht)", owner: Boolean(m.owner), joinedAt: m.joinedAt,
      posts: mine.length, published: mine.filter((p) => p.status === "veröffentlicht").length,
      views: mine.reduce((a, p) => a + (Number(p.stats?.views) || 0), 0), likes: mine.reduce((a, p) => a + (Number(p.stats?.likes) || 0), 0),
      accounts: [...new Set(mine.map((p) => db.accounts.find((a) => a.id === p.accountId)?.username).filter(Boolean))] };
  });
  const posts = ps.sort((a, b) => (b.publishedAt || b.scheduledAt).localeCompare(a.publishedAt || a.scheduledAt)).slice(0, 200).map((p) => ({
    id: p.id, user: db.users.find((x) => x.id === p.userId)?.name || "?", platform: p.platform, account: db.accounts.find((a) => a.id === p.accountId)?.username || "(getrennt)",
    status: p.status, scheduledAt: p.scheduledAt, publishedAt: p.publishedAt || null, permalink: p.permalink || null,
    caption: (db.clips.find((x) => x.id === p.clipId)?.caption || "").split("\n")[0].slice(0, 90),
    views: p.stats?.views ?? null, likes: p.stats?.likes ?? 0, comments: p.stats?.comments ?? 0,
  }));
  res.json({ campaign: { id: c.id, name: c.name, deadline: c.deadline, brief: c.brief, link: c.link, hashtags: c.hashtags }, totals: campaignStats(c), members, posts, insights: stats.summary(null, { campaign: c.id }).insights });
});
app.post("/api/campaigns", auth.requireUser, (req, res) => {
  const c = { id: id("cmp"), userId: req.user.id, createdAt: now(), ...cleanCampaign(req.body || {}) };
  db.campaigns.push(c); save(); res.status(201).json({ campaign: { ...c, posts: 0, published: 0 } });
});
app.put("/api/campaigns/:id", auth.requireUser, (req, res) => {
  const i = db.campaigns.findIndex((c) => c.id === req.params.id && c.userId === req.user.id);
  if (i < 0) return res.status(404).json({ error: "Kampagne nicht gefunden" });
  db.campaigns[i] = cleanCampaign(req.body || {}, db.campaigns[i]); save(); res.json({ campaign: { ...db.campaigns[i], ...campaignStats(db.campaigns[i]) } });
});
app.delete("/api/campaigns/:id", auth.requireUser, (req, res) => {
  const i = db.campaigns.findIndex((c) => c.id === req.params.id && c.userId === req.user.id);
  if (i < 0) return res.status(404).json({ error: "Kampagne nicht gefunden" });
  db.campaigns.splice(i, 1); save(); res.json({ ok: true });
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

// TikTok-Optionen aus dem Post-Dialog bereinigen
function cleanTiktokOpts(o) {
  if (typeof o === "string") { try { o = JSON.parse(o); } catch { o = {}; } }
  o = o || {};
  const P = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"];
  return {
    privacy: P.includes(o.privacy) ? o.privacy : null,
    allowComment: Boolean(o.allowComment), allowDuet: Boolean(o.allowDuet), allowStitch: Boolean(o.allowStitch),
    commercial: { brand: Boolean(o.commercial?.brand), branded: Boolean(o.commercial?.branded) },
  };
}

// Aktuelle Creator-Infos (Pflicht beim Öffnen des Post-Dialogs laut TikTok)
app.get("/api/accounts/:id/tiktok-creator", auth.requireUser, async (req, res) => {
  const acc = db.accounts.find((a) => a.id === req.params.id && a.userId === req.user.id && a.platform === "tiktok");
  if (!acc) return res.status(404).json({ error: "TikTok-Account nicht gefunden" });
  try {
    const info = await tiktok.creatorInfo(await publisher.tokenFor(acc));
    res.json({
      nickname: info.creator_nickname, username: info.creator_username, avatar: info.creator_avatar_url,
      privacyOptions: info.privacy_level_options || [], commentDisabled: Boolean(info.comment_disabled),
      duetDisabled: Boolean(info.duet_disabled), stitchDisabled: Boolean(info.stitch_disabled),
      maxDuration: info.max_video_post_duration_sec || null, unaudited: config.tiktok.unaudited,
    });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Legt einen Clip an und plant ihn für die gewählten Accounts ein (genutzt von Studio, API und Auto-Clips)
async function schedulePosts({ user, srcFile, copy, mimetype = "video/mp4", originalName, caption, accountIds, scheduledAt, tiktokMode, tiktok, campaignId, campaign, auto = false }) {
  if (typeof accountIds === "string") { try { accountIds = JSON.parse(accountIds || "[]"); } catch { accountIds = []; } }
  // Kampagne: Hashtags anhängen, ID für die Clipping-App übernehmen
  const cmp = campaign ? campaignAccess(campaign, user.id) : null;
  if (cmp) {
    caption = String(caption || "");
    const missing = (cmp.hashtags || []).filter((h) => !new RegExp("#" + h + "\\b", "i").test(caption));
    if (missing.length) caption = [caption.trim(), missing.map((h) => "#" + h).join(" ")].filter(Boolean).join("\n\n");
    if (!campaignId && cmp.externalId) campaignId = cmp.externalId;
  }
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
    tiktokMode: tiktokMode === "inbox" ? "inbox" : "direct",
    tiktok: a.platform === "tiktok" ? cleanTiktokOpts(tiktok) : undefined,
    campaignId: String(campaignId || "").trim() || null, campaign: cmp ? cmp.id : null,
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
    tiktokMode: req.body.tiktokMode, tiktok: req.body.tiktok, campaignId: req.body.campaignId, campaign: req.body.campaign,
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
        campaign: p.campaign ? (db.campaigns.find((c) => c.id === p.campaign)?.name || null) : null,
        stats: p.stats ? { views: p.stats.views ?? null, likes: p.stats.likes ?? 0, comments: p.stats.comments ?? 0, shares: p.stats.shares ?? null, at: p.stats.at, note: p.stats.note || null, error: p.stats.error || null } : null,
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
      ...auth.publicUser(u), disabled: Boolean(u.disabled), verified: u.verified !== false,
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
  stats.start(publisher.tokenFor);
  projects.start();
});

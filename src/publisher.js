// Arbeitet die Warteschlange ab: fällige Posts veröffentlichen, TikTok-Status nachverfolgen,
// Tokens verlängern, veröffentlichte Posts bei der Clipping-App einreichen, alte Videos löschen.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");
const { db, save, now, enc, dec, videoDir } = require("./store");
const tiktok = require("./platforms/tiktok");
const instagram = require("./platforms/instagram");

const MAX_ATTEMPTS = 3;
const running = new Set();

function log(...a) { console.log(new Date().toISOString(), "[publisher]", ...a); }

async function tokenFor(acc) {
  if (acc.expiresAt && acc.expiresAt > Date.now() + 60_000) return dec(acc.accessToken);
  if (acc.platform === "tiktok") {
    const t = await tiktok.refresh(dec(acc.refreshToken));
    Object.assign(acc, { accessToken: enc(t.accessToken), refreshToken: enc(t.refreshToken), expiresAt: t.expiresAt });
  } else {
    const t = await instagram.refresh(dec(acc.accessToken));
    Object.assign(acc, { accessToken: enc(t.accessToken), expiresAt: t.expiresAt });
  }
  acc.updatedAt = now();
  save();
  return dec(acc.accessToken);
}

// Instagram-Token rechtzeitig vor Ablauf (60 Tage) verlängern
async function refreshInstagramTokens() {
  for (const acc of db.accounts.filter((a) => a.platform === "instagram")) {
    if (acc.expiresAt - Date.now() < 10 * 24 * 3600 * 1000) {
      try {
        const t = await instagram.refresh(dec(acc.accessToken));
        Object.assign(acc, { accessToken: enc(t.accessToken), expiresAt: t.expiresAt, updatedAt: now(), problem: null });
      } catch (e) {
        acc.problem = "Token abgelaufen – bitte neu verbinden";
        log("IG-Token", acc.username, e.message);
      }
      save();
    }
  }
}

function publicVideoUrl(clip) {
  if (!clip.publicToken) { clip.publicToken = crypto.randomBytes(18).toString("base64url"); save(); }
  return `${config.baseUrl}/media/${clip.publicToken}.mp4`;
}

async function submitToClippingApp(post, user, acc) {
  if (!config.clippingAppUrl || !post.campaignId || !post.permalink || !user?.clippingAppKey) return;
  try {
    const r = await fetch(`${config.clippingAppUrl}/api/submissions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${dec(user.clippingAppKey)}` },
      body: JSON.stringify({ post_url: post.permalink, platform: acc.platform, campaign_id: post.campaignId, account_name: acc.username }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    post.submission = { id: j.id || j.submission_id || null, status: j.status || "eingereicht", at: now() };
  } catch (e) {
    post.submission = { error: e.message, at: now() };
  }
  save();
}

async function runPost(post) {
  const clip = db.clips.find((c) => c.id === post.clipId);
  const acc = db.accounts.find((a) => a.id === post.accountId);
  const user = db.users.find((u) => u.id === post.userId);
  if (!clip || !acc) throw new Error(!clip ? "Clip wurde gelöscht" : "Account ist nicht mehr verbunden");
  const file = path.join(videoDir, clip.file);
  const token = await tokenFor(acc);

  if (acc.platform === "tiktok") {
    // Ohne Audit wären Direkt-Posts nur privat sichtbar – dann lieber als Entwurf in die App
    const mode = config.tiktok.unaudited ? "inbox" : post.tiktokMode;
    const { publishId } = await tiktok.publish({ token, file, caption: clip.caption, mode });
    Object.assign(post, { status: "verarbeitung", externalId: publishId, effectiveMode: mode });
  } else {
    const res = await instagram.publish({ token, igUserId: acc.externalId, videoUrl: publicVideoUrl(clip), caption: clip.caption });
    Object.assign(post, { status: "veröffentlicht", externalId: res.mediaId, permalink: res.permalink, publishedAt: now() });
    await submitToClippingApp(post, user, acc);
  }
  save();
}

async function checkTikTok(post) {
  const acc = db.accounts.find((a) => a.id === post.accountId);
  if (!acc) return;
  const s = await tiktok.status(await tokenFor(acc), post.externalId);
  if (s.status === "PUBLISH_COMPLETE") {
    const vid = s.postIds[0];
    Object.assign(post, { status: "veröffentlicht", publishedAt: now(), permalink: vid && acc.username ? `https://www.tiktok.com/${acc.username}/video/${vid}` : null });
    await submitToClippingApp(post, db.users.find((u) => u.id === post.userId), acc);
  } else if (s.status === "SEND_TO_USER_INBOX") {
    Object.assign(post, { status: "entwurf", note: "Liegt als Entwurf in der TikTok-App – dort veröffentlichen (innerhalb von 24 h)" });
  } else if (s.status === "FAILED") {
    Object.assign(post, { status: "fehler", error: `TikTok: ${s.failReason || "unbekannt"}` });
  }
  save();
}

async function tick() {
  const due = db.posts.filter((p) => p.status === "geplant" && new Date(p.scheduledAt).getTime() <= Date.now() && !running.has(p.id));
  for (const post of due.slice(0, 3)) {
    running.add(post.id);
    post.status = "läuft"; post.attempts = (post.attempts || 0) + 1; post.startedAt = now(); save();
    runPost(post)
      .then(() => log("ok", post.id))
      .catch((e) => {
        log("Fehler", post.id, e.message);
        post.error = e.message;
        // Netz- oder Ratenfehler: später nochmal versuchen
        if (post.attempts < MAX_ATTEMPTS) {
          post.status = "geplant";
          post.scheduledAt = new Date(Date.now() + post.attempts * 10 * 60_000).toISOString();
        } else post.status = "fehler";
        save();
      })
      .finally(() => running.delete(post.id));
  }
  for (const post of db.posts.filter((p) => p.status === "verarbeitung" && !running.has(p.id))) {
    running.add(post.id);
    await checkTikTok(post).catch((e) => log("TikTok-Status", post.id, e.message)).finally(() => running.delete(post.id));
  }
}

function cleanup() {
  const limit = Date.now() - config.retentionDays * 24 * 3600 * 1000;
  for (const clip of db.clips) {
    if (clip.deleted || new Date(clip.createdAt).getTime() > limit) continue;
    const open = db.posts.some((p) => p.clipId === clip.id && ["geplant", "läuft", "verarbeitung"].includes(p.status));
    if (open) continue;
    fs.rm(path.join(videoDir, clip.file), { force: true }, () => {});
    clip.deleted = true; clip.publicToken = null;
  }
  save();
}

function start() {
  // Abgestürzte Läufe nach Neustart wieder einplanen
  db.posts.filter((p) => p.status === "läuft").forEach((p) => { p.status = "geplant"; });
  save();
  setInterval(() => tick().catch((e) => log(e)), 20_000);
  setInterval(() => refreshInstagramTokens().catch((e) => log(e)), 6 * 3600_000);
  setInterval(cleanup, 3600_000);
  setTimeout(() => tick().catch((e) => log(e)), 2000);
  log("gestartet");
}

module.exports = { start, tick };

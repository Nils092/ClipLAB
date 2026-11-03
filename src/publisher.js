// Arbeitet die Warteschlange ab: fällige Posts veröffentlichen, TikTok-Status nachverfolgen,
// Tokens verlängern, veröffentlichte Posts bei der Clipping-App einreichen, alte Videos löschen.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");
const { db, save, now, enc, dec, videoDir } = require("./store");
const tiktok = require("./platforms/tiktok");
const instagram = require("./platforms/instagram");
const youtube = require("./platforms/youtube");
const PLATFORM_NAME = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };
const push = require("./push");

const MAX_ATTEMPTS = 3;
const running = new Set();

function log(...a) { console.log(new Date().toISOString(), "[publisher]", ...a); }

async function tokenFor(acc) {
  if (!acc.expiresAt || acc.expiresAt > Date.now() + 60_000) return dec(acc.accessToken);   // ohne Ablaufdatum: läuft nicht ab
  if (acc.platform === "tiktok") {
    const t = await tiktok.refresh(dec(acc.refreshToken));
    Object.assign(acc, { accessToken: enc(t.accessToken), refreshToken: enc(t.refreshToken), expiresAt: t.expiresAt });
  } else if (acc.platform === "youtube") {
    if (!acc.refreshToken) throw new Error("YouTube-Zugang abgelaufen – bitte neu verbinden");
    const t = await youtube.refresh(dec(acc.refreshToken));
    Object.assign(acc, { accessToken: enc(t.accessToken), expiresAt: t.expiresAt });
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
    if (!acc.expiresAt) continue;   // Unified Login ohne Ablauf
    if (acc.mode === "unified") { if (acc.expiresAt < Date.now()) { acc.problem = "Zugang abgelaufen – bitte neu verbinden"; save(); } continue; }
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

// Push-Nachricht an den Clipper, wenn sich der Status eines Posts entscheidet
function tell(post, acc, clip) {
  clip = clip || db.clips.find((c) => c.id === post.clipId);
  const where = `${PLATFORM_NAME[post.platform] || post.platform}${acc?.username ? " · " + acc.username : ""}`;
  const what = (clip?.caption || "").split("\n")[0].slice(0, 80);
  const msg = {
    "veröffentlicht": { title: "Clip ist online 🎉", body: `${where}${what ? ": " + what : ""}`, url: post.permalink || "/" },
    entwurf: { title: "Entwurf in TikTok bereit", body: `${where}: In der TikTok-App veröffentlichen${what ? " – " + what : ""}`, url: "/" },
    fehler: { title: "Clip konnte nicht veröffentlicht werden", body: `${where}: ${post.error || "Fehler"}`.slice(0, 160), url: "/" },
  }[post.status];
  if (msg) push.notify(post.userId, msg);
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
  } else if (acc.platform === "youtube") {
    const res = await youtube.publish({ token, file, caption: clip.caption });
    Object.assign(post, { status: "veröffentlicht", externalId: res.videoId, permalink: res.permalink, publishedAt: now(),
      note: res.privacy !== "public" ? `Auf YouTube als „${res.privacy === "private" ? "privat" : "nicht gelistet"}“ hochgeladen` : null });
    tell(post, acc, clip);
    await submitToClippingApp(post, user, acc);
  } else {
    const res = await instagram.publish({ token, igUserId: acc.externalId, videoUrl: publicVideoUrl(clip), caption: clip.caption });
    Object.assign(post, { status: "veröffentlicht", externalId: res.mediaId, permalink: res.permalink, publishedAt: now() });
    tell(post, acc, clip);
    await submitToClippingApp(post, user, acc);
  }
  save();
}

const acc = (post) => db.accounts.find((a) => a.id === post.accountId);
async function checkTikTok(post) {
  const acc = db.accounts.find((a) => a.id === post.accountId);
  if (!acc) return;
  const s = await tiktok.status(await tokenFor(acc), post.externalId);
  if (s.status === "PUBLISH_COMPLETE") {
    const vid = s.postIds[0];
    Object.assign(post, { status: "veröffentlicht", publishedAt: now(), permalink: vid && acc.username ? `https://www.tiktok.com/${acc.username}/video/${vid}` : null });
    tell(post, acc);
    await submitToClippingApp(post, db.users.find((u) => u.id === post.userId), acc);
  } else if (s.status === "SEND_TO_USER_INBOX") {
    Object.assign(post, { status: "entwurf", note: "Liegt als Entwurf in der TikTok-App – dort veröffentlichen (innerhalb von 24 h)" });
    tell(post, acc);
  } else if (s.status === "FAILED") {
    Object.assign(post, { status: "fehler", error: `TikTok: ${s.failReason || "unbekannt"}` });
    tell(post, acc);
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
        } else { post.status = "fehler"; tell(post, db.accounts.find((a) => a.id === post.accountId)); }
        save();
      })
      .finally(() => running.delete(post.id));
  }
  for (const post of db.posts.filter((p) => p.status === "verarbeitung" && !running.has(p.id))) {
    running.add(post.id);
    await checkTikTok(post).catch((e) => {
      log("TikTok-Status", post.id, e.message);
      // TikTok (v. a. im Sandbox-Modus) antwortet auf die Statusabfrage oft mit "Something went wrong".
      // Der Upload selbst war erfolgreich – nach einigen Versuchen als übergeben markieren statt endlos zu fragen.
      post.statusTries = (post.statusTries || 0) + 1;
      if (post.statusTries >= 6) {
        Object.assign(post, {
          status: "entwurf", publishedAt: null,
          note: config.tiktok.unaudited
            ? "An TikTok übergeben. Im Sandbox-Modus (App noch nicht geprüft) zeigt TikTok das Video nicht in der App – das klappt erst nach der Prüfung durch TikTok."
            : "An TikTok übergeben – Status konnte nicht abgefragt werden. Bitte in der TikTok-App unter Entwürfe nachsehen.",
        });
        tell(post, acc(post));
        save();
      }
    }).finally(() => running.delete(post.id));
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

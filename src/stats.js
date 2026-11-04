// Performance-Protokoll: Views, Likes, Kommentare veröffentlichter Posts regelmäßig nachladen
// und daraus einfache Erkenntnisse ableiten (bester Clip, beste Uhrzeit, Titel mit/ohne Emoji …).
const { db, save, now } = require("./store");
const tiktok = require("./platforms/tiktok");
const instagram = require("./platforms/instagram");
const youtube = require("./platforms/youtube");

const DAYS = 60;                       // so lange werden Kennzahlen nachgeladen
const log = (...a) => console.log(new Date().toISOString(), "[stats]", ...a);
let tokenFor = null;                   // wird vom Publisher gesetzt (Token-Verlängerung)
let busy = false;

// Wie oft nachladen: frische Posts stündlich, ältere alle 6 Stunden
function due(post, t = Date.now()) {
  if (post.status !== "veröffentlicht" || !post.publishedAt) return false;
  const age = t - new Date(post.publishedAt).getTime();
  if (age > DAYS * 86400_000) return false;
  const last = post.stats?.at ? new Date(post.stats.at).getTime() : 0;
  return t - last > (age < 48 * 3600_000 ? 3600_000 : 6 * 3600_000);
}

function apply(post, m) {
  if (!m) return;
  const prev = post.stats || {};
  post.stats = {
    views: m.views ?? prev.views ?? null, likes: m.likes ?? prev.likes ?? 0, comments: m.comments ?? prev.comments ?? 0,
    shares: m.shares ?? prev.shares ?? null, saved: m.saved ?? prev.saved ?? null, reach: m.reach ?? prev.reach ?? null,
    at: now(), note: m.insightsError ? "Views brauchen die Insights-Berechtigung bei Meta" : null,
  };
  // Verlauf (max. 40 Punkte) für "wie entwickelt sich der Clip"
  post.statsLog = [...(post.statsLog || []), { t: post.stats.at, v: post.stats.views ?? 0, l: post.stats.likes }].slice(-40);
}

async function collect({ force = false, userId = null } = {}) {
  if (busy) return 0; busy = true;
  let n = 0;
  try {
    const posts = db.posts.filter((p) => (userId ? p.userId === userId : true) && (force ? p.status === "veröffentlicht" && p.publishedAt && Date.now() - new Date(p.publishedAt).getTime() < DAYS * 86400_000 : due(p)));
    // nach Account bündeln (TikTok und YouTube können mehrere IDs auf einmal)
    const byAcc = new Map();
    for (const p of posts) { if (!byAcc.has(p.accountId)) byAcc.set(p.accountId, []); byAcc.get(p.accountId).push(p); }
    for (const [accId, list] of byAcc) {
      const acc = db.accounts.find((a) => a.id === accId);
      if (!acc) continue;
      try {
        const token = await tokenFor(acc);
        if (acc.platform === "tiktok") {
          if (process.env.TIKTOK_VIDEO_LIST !== "true") { list.forEach((p) => { p.stats = { ...(p.stats || {}), at: now(), note: "TikTok-Views brauchen die Display API (video.list)" }; }); continue; }
          const withId = list.filter((p) => p.videoId);
          for (let i = 0; i < withId.length; i += 20) {
            const chunk = withId.slice(i, i + 20);
            const m = await tiktok.metrics(token, chunk.map((p) => p.videoId));
            chunk.forEach((p) => { apply(p, m[p.videoId]); n++; });
          }
        } else if (acc.platform === "youtube") {
          const withId = list.filter((p) => p.externalId);
          for (let i = 0; i < withId.length; i += 50) {
            const chunk = withId.slice(i, i + 50);
            const m = await youtube.metrics(token, chunk.map((p) => p.externalId));
            chunk.forEach((p) => { apply(p, m[p.externalId]); n++; });
          }
        } else {
          for (const p of list.filter((p) => p.externalId)) { apply(p, await instagram.metrics(token, p.externalId)); n++; }
        }
      } catch (e) {
        log(acc.platform, acc.username, e.message);
        list.forEach((p) => { p.stats = { ...(p.stats || {}), at: now(), error: e.message.slice(0, 160) }; });
      }
    }
    if (n || posts.length) save();
  } finally { busy = false; }
  return n;
}

// ---------- Auswertung ----------
const EMOJI = /\p{Extended_Pictographic}/u;
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const fmtHour = (h) => `${String(h).padStart(2, "0")}–${String((h + 1) % 24).padStart(2, "0")} Uhr`;
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function summary(userId, { campaign = null } = {}) {
  const posts = db.posts.filter((p) => (userId ? p.userId === userId : true) && (campaign ? p.campaign === campaign : true) && p.status === "veröffentlicht");
  const withViews = posts.filter((p) => typeof p.stats?.views === "number");
  const clipOf = (p) => db.clips.find((c) => c.id === p.clipId) || {};
  const accOf = (p) => db.accounts.find((a) => a.id === p.accountId);
  const sum = (k) => posts.reduce((a, p) => a + (Number(p.stats?.[k]) || 0), 0);
  const totals = { posts: posts.length, views: sum("views"), likes: sum("likes"), comments: sum("comments"), shares: sum("shares"), measured: withViews.length };
  const row = (p) => ({ id: p.id, platform: p.platform, account: accOf(p)?.username || "", caption: (clipOf(p).caption || "").split("\n")[0].slice(0, 90), permalink: p.permalink, publishedAt: p.publishedAt, views: p.stats?.views ?? null, likes: p.stats?.likes ?? 0, comments: p.stats?.comments ?? 0 });
  const top = [...withViews].sort((a, b) => (b.stats.views || 0) - (a.stats.views || 0)).slice(0, 5).map(row);

  // Erkenntnisse – nur wenn genug Daten da sind
  const insights = [];
  const group = (keyFn) => { const g = new Map(); for (const p of withViews) { const k = keyFn(p); if (k == null) continue; if (!g.has(k)) g.set(k, []); g.get(k).push(p.stats.views || 0); } return g; };
  const best = (g, min = 2) => [...g].filter(([, v]) => v.length >= min).map(([k, v]) => [k, avg(v), v.length]).sort((a, b) => b[1] - a[1]);
  if (withViews.length >= 4) {
    const byPlatform = best(group((p) => p.platform), 1);
    if (byPlatform.length > 1) insights.push({ kind: "platform", text: `Ø Views: ${byPlatform.map(([k, v, n]) => `${{ tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" }[k]} ${Math.round(v).toLocaleString("de-DE")} (${n} Clips)`).join(" · ")}` });
    const byHour = best(group((p) => new Date(p.publishedAt).getHours()));
    if (byHour.length >= 2 && byHour[0][1] > 1.3 * avg(withViews.map((p) => p.stats.views || 0))) insights.push({ kind: "hour", hour: byHour[0][0], text: `Beste Uhrzeit bisher: ${fmtHour(byHour[0][0])} – Ø ${Math.round(byHour[0][1]).toLocaleString("de-DE")} Views (${byHour[0][2]} Clips)` });
    const byDay = best(group((p) => new Date(p.publishedAt).getDay()));
    if (byDay.length >= 2 && byDay[0][1] > 1.3 * byDay[byDay.length - 1][1]) insights.push({ kind: "weekday", text: `Stärkster Wochentag: ${WD[byDay[0][0]]} (Ø ${Math.round(byDay[0][1]).toLocaleString("de-DE")} Views)` });
    const byEmoji = best(group((p) => (EMOJI.test((clipOf(p).caption || "").split("\n")[0]) ? "mit" : "ohne")));
    if (byEmoji.length === 2) { const [a, b] = byEmoji; if (a[1] > 1.25 * b[1]) insights.push({ kind: "emoji", text: `Titel ${a[0]} Emoji laufen besser: Ø ${Math.round(a[1]).toLocaleString("de-DE")} vs. ${Math.round(b[1]).toLocaleString("de-DE")} Views` }); }
    const byLen = best(group((p) => { const t = (clipOf(p).caption || "").split("\n")[0].length; return t < 30 ? "kurze Titel (unter 30 Zeichen)" : t < 60 ? "mittlere Titel" : "lange Titel"; }));
    if (byLen.length >= 2 && byLen[0][1] > 1.25 * byLen[byLen.length - 1][1]) insights.push({ kind: "length", text: `${byLen[0][0].charAt(0).toUpperCase() + byLen[0][0].slice(1)} bekommen die meisten Views (Ø ${Math.round(byLen[0][1]).toLocaleString("de-DE")})` });
  } else if (posts.length) {
    insights.push({ kind: "wait", text: withViews.length ? `Erst ${withViews.length} Clips mit Kennzahlen – ab 4 gibt es Auswertungen.` : "Kennzahlen werden nach dem Veröffentlichen stündlich nachgeladen." });
  }
  const bestHour = insights.find((i) => i.kind === "hour")?.hour ?? null;
  return { totals, top, insights, bestHour, updatedAt: posts.map((p) => p.stats?.at).filter(Boolean).sort().pop() || null };
}

function start(tf) {
  tokenFor = tf;
  setTimeout(() => collect().then((n) => n && log(`${n} Posts aktualisiert`)).catch((e) => log(e.message)), 30_000);
  setInterval(() => collect().then((n) => n && log(`${n} Posts aktualisiert`)).catch((e) => log(e.message)), 30 * 60_000);
}

module.exports = { start, collect, summary };

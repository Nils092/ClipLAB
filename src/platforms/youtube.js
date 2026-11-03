// YouTube Shorts über die YouTube Data API v3 (Google-Login mit OAuth 2.0)
// Doku: https://developers.google.com/youtube/v3/guides/uploading_a_video
// Hochformat-Videos bis 3 Minuten erkennt YouTube automatisch als Short; #Shorts im Titel hilft zusätzlich.
// Hinweis: Solange das Google-Projekt nicht von Google geprüft ist, setzt YouTube neue Uploads auf "privat".
const fs = require("fs");
const config = require("../config");

const REDIRECT = () => `${config.baseUrl}/auth/youtube/callback`;
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];

function authorizeUrl(state) {
  return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
    client_id: config.youtube.clientId, redirect_uri: REDIRECT(), response_type: "code",
    scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  })}`;
}

async function json(r, what) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) {
    const m = j.error?.message || j.error_description || (typeof j.error === "string" ? j.error : "") || r.status;
    throw new Error(`YouTube ${what}: ${m}`);
  }
  return j;
}

async function tokenRequest(params) {
  const j = await json(await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.youtube.clientId, client_secret: config.youtube.clientSecret, ...params }),
  }), "Token");
  return { accessToken: j.access_token, refreshToken: j.refresh_token || params.refresh_token || null, expiresAt: Date.now() + ((j.expires_in || 3600) - 120) * 1000 };
}
const exchangeCode = (code) => tokenRequest({ code, grant_type: "authorization_code", redirect_uri: REDIRECT() });
const refresh = (refreshToken) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

// Alle YouTube-Kanäle des angemeldeten Google-Kontos
async function profiles(token) {
  const j = await json(await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${token}` } }), "Kanal");
  const list = (j.items || []).map((c) => ({ externalId: c.id, username: c.snippet?.customUrl || c.snippet?.title || c.id }));
  if (!list.length) throw new Error("YouTube: Zu diesem Google-Konto gibt es keinen YouTube-Kanal. Bitte zuerst auf youtube.com einen Kanal anlegen.");
  return list;
}

// Titel (max. 100 Zeichen, mit #Shorts) und Beschreibung aus der Caption
function textsFrom(caption) {
  const text = String(caption || "").trim();
  const firstLine = (text.split("\n").find((l) => l.trim() && !/^#/.test(l.trim())) || "Clip").trim();
  const tag = " #Shorts";
  const title = (firstLine.length + tag.length > 100 ? firstLine.slice(0, 100 - tag.length - 1) + "…" : firstLine) + tag;
  const tags = (text.match(/#[\p{L}\p{N}_]+/gu) || []).map((t) => t.slice(1)).slice(0, 15);
  return { title, description: text.slice(0, 4900), tags };
}

/** Lädt ein Video als Short hoch (fortsetzbarer Upload). */
async function publish({ token, file, caption }) {
  const size = (await fs.promises.stat(file)).size;
  const { title, description, tags } = textsFrom(caption);
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify({
      snippet: { title, description, tags, categoryId: config.youtube.categoryId },
      status: { privacyStatus: config.youtube.privacy, selfDeclaredMadeForKids: false },
    }),
  });
  if (!init.ok) await json(init, "Upload starten");
  const location = init.headers.get("location");
  if (!location) throw new Error("YouTube: Keine Upload-Adresse erhalten");
  const up = await json(await fetch(location, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4", "Content-Length": String(size) },
    body: fs.createReadStream(file), duplex: "half",
  }), "Upload");
  return { videoId: up.id, permalink: up.id ? `https://youtube.com/shorts/${up.id}` : null, privacy: up.status?.privacyStatus || config.youtube.privacy };
}

/** Kennzahlen mehrerer Videos (Scope youtube.readonly) */
async function metrics(token, ids) {
  const j = await json(await fetch(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.slice(0, 50).join(",")}`, { headers: { Authorization: `Bearer ${token}` } }), "Statistik");
  const out = {};
  for (const v of j.items || []) out[v.id] = { views: Number(v.statistics?.viewCount || 0), likes: Number(v.statistics?.likeCount || 0), comments: Number(v.statistics?.commentCount || 0) };
  return out;
}

module.exports = { metrics, authorizeUrl, exchangeCode, refresh, profiles, publish, textsFrom };

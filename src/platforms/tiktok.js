// TikTok Content Posting API
// Doku: https://developers.tiktok.com/doc/content-posting-api-get-started
const fs = require("fs");
const config = require("../config");

const AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
const API = "https://open.tiktokapis.com/v2";
const SCOPES = ["user.info.basic", "video.upload", "video.publish"];

function authorizeUrl(state) {
  const p = new URLSearchParams({
    client_key: config.tiktok.clientKey,
    scope: SCOPES.join(","),
    response_type: "code",
    redirect_uri: `${config.baseUrl}/auth/tiktok/callback`,
    state,
  });
  return `${AUTH_URL}?${p}`;
}

async function tokenRequest(params) {
  const r = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: config.tiktok.clientKey, client_secret: config.tiktok.clientSecret, ...params }),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(`TikTok-Token: ${j.error_description || j.error || r.status}`);
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Date.now() + (j.expires_in - 120) * 1000,
    refreshExpiresAt: Date.now() + (j.refresh_expires_in || 0) * 1000,
    externalId: j.open_id,
  };
}
const exchangeCode = (code) => tokenRequest({ code, grant_type: "authorization_code", redirect_uri: `${config.baseUrl}/auth/tiktok/callback` });
const refresh = (refreshToken) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

async function api(token, path, body) {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.error && j.error.code && j.error.code !== "ok")) {
    const e = new Error(`TikTok ${path}: ${j.error?.message || j.error?.code || r.status}`);
    e.code = j.error?.code;
    throw e;
  }
  return j.data;
}

// Pflicht vor jedem Direkt-Post: erlaubte Sichtbarkeiten und max. Videolänge des Creators
const creatorInfo = (token) => api(token, "/post/publish/creator_info/query/");

function chunkPlan(size) {
  const MB = 1024 * 1024;
  if (size <= 64 * MB) return { chunkSize: size, count: 1 };
  const chunkSize = 10 * MB;
  return { chunkSize, count: Math.floor(size / chunkSize) }; // letzter Chunk nimmt den Rest auf
}

async function uploadFile(uploadUrl, file, size, plan) {
  const fd = await fs.promises.open(file, "r");
  try {
    for (let i = 0; i < plan.count; i++) {
      const start = i * plan.chunkSize;
      const end = i === plan.count - 1 ? size - 1 : start + plan.chunkSize - 1;
      const len = end - start + 1;
      const buf = Buffer.alloc(len);
      await fd.read(buf, 0, len, start);
      const r = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4", "Content-Length": String(len), "Content-Range": `bytes ${start}-${end}/${size}` },
        body: buf,
      });
      if (![200, 201, 206].includes(r.status)) throw new Error(`TikTok-Upload Teil ${i + 1}: HTTP ${r.status}`);
    }
  } finally {
    await fd.close();
  }
}

/**
 * Lädt ein Video hoch.
 * mode "inbox": landet als Entwurf in der TikTok-App (Scope video.upload)
 * mode "direct": wird direkt veröffentlicht (Scope video.publish; ohne Audit nur privat)
 */
async function publish({ token, file, caption, mode }) {
  const size = (await fs.promises.stat(file)).size;
  const plan = chunkPlan(size);
  const source_info = { source: "FILE_UPLOAD", video_size: size, chunk_size: plan.chunkSize, total_chunk_count: plan.count };
  let data;
  if (mode === "direct") {
    const info = await creatorInfo(token);
    const options = info.privacy_level_options || [];
    const privacy = config.tiktok.unaudited ? "SELF_ONLY" : options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : options[0];
    data = await api(token, "/post/publish/video/init/", {
      post_info: {
        title: caption.slice(0, 2200),
        privacy_level: privacy,
        disable_comment: Boolean(info.comment_disabled),
        disable_duet: Boolean(info.duet_disabled),
        disable_stitch: Boolean(info.stitch_disabled),
        video_cover_timestamp_ms: 1000,
      },
      source_info,
    });
  } else {
    data = await api(token, "/post/publish/inbox/video/init/", { source_info });
  }
  await uploadFile(data.upload_url, file, size, plan);
  return { publishId: data.publish_id };
}

// Status: PROCESSING_UPLOAD | PROCESSING_DOWNLOAD | SEND_TO_USER_INBOX | PUBLISH_COMPLETE | FAILED
async function status(token, publishId) {
  const d = await api(token, "/post/publish/status/fetch/", { publish_id: publishId });
  return { status: d.status, failReason: d.fail_reason, postIds: d.publicaly_available_post_id || [] };
}

async function profile(token) {
  try {
    const info = await creatorInfo(token);
    return { username: info.creator_username ? "@" + info.creator_username : info.creator_nickname };
  } catch {
    return { username: null };
  }
}

module.exports = { authorizeUrl, exchangeCode, refresh, publish, status, profile };

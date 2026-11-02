// Instagram API with Instagram Login – Content Publishing (Reels)
// Doku: https://developers.facebook.com/docs/instagram-platform/content-publishing
const config = require("../config");

const G = () => `https://graph.instagram.com/${config.instagram.version}`;
const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

function authorizeUrl(state) {
  const p = new URLSearchParams({
    client_id: config.instagram.appId,
    redirect_uri: `${config.baseUrl}/auth/instagram/callback`,
    response_type: "code",
    scope: SCOPES.join(","),
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${p}`;
}

async function json(r, what) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error || j.error_message) {
    const m = j.error?.message || j.error_message || j.error_description || r.status;
    const e = new Error(`Instagram ${what}: ${m}`);
    e.code = j.error?.code;
    throw e;
  }
  return j;
}

async function exchangeCode(code) {
  const short = await json(await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: config.instagram.appId,
      client_secret: config.instagram.appSecret,
      grant_type: "authorization_code",
      redirect_uri: `${config.baseUrl}/auth/instagram/callback`,
      code,
    }),
  }), "Token");
  const shortToken = short.data?.[0]?.access_token || short.access_token;
  const long = await json(await fetch(`https://graph.instagram.com/access_token?${new URLSearchParams({
    grant_type: "ig_exchange_token", client_secret: config.instagram.appSecret, access_token: shortToken,
  })}`), "Langzeit-Token");
  return { accessToken: long.access_token, refreshToken: null, expiresAt: Date.now() + (long.expires_in - 3600) * 1000 };
}

// Langzeit-Token (60 Tage) verlängern; geht ab 24 h nach Ausstellung
async function refresh(accessToken) {
  const j = await json(await fetch(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
    grant_type: "ig_refresh_token", access_token: accessToken,
  })}`), "Token verlängern");
  return { accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in - 3600) * 1000 };
}

async function profile(token) {
  const j = await json(await fetch(`${G()}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`), "Profil");
  return { externalId: j.user_id || j.id, username: j.username ? "@" + j.username : null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Veröffentlicht ein Reel. videoUrl muss öffentlich per HTTPS erreichbar sein. */
async function publish({ token, igUserId, videoUrl, caption }) {
  const c = await json(await fetch(`${G()}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ media_type: "REELS", video_url: videoUrl, caption: caption.slice(0, 2200), share_to_feed: true }),
  }), "Container");
  // Meta verarbeitet das Video asynchron
  for (let i = 0; i < 60; i++) {
    await sleep(i < 6 ? 5000 : 10000);
    const s = await json(await fetch(`${G()}/${c.id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`), "Status");
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram-Verarbeitung: ${s.status || s.status_code}`);
    if (i === 59) throw new Error("Instagram-Verarbeitung dauert zu lange");
  }
  const p = await json(await fetch(`${G()}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ creation_id: c.id }),
  }), "Veröffentlichen");
  let permalink = null;
  try {
    const m = await json(await fetch(`${G()}/${p.id}?fields=permalink&access_token=${encodeURIComponent(token)}`), "Link");
    permalink = m.permalink;
  } catch {}
  return { mediaId: p.id, permalink };
}

module.exports = { authorizeUrl, exchangeCode, refresh, profile, publish };

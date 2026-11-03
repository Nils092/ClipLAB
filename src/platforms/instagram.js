// Instagram – Content Publishing (Reels)
// Zwei Wege, je nach Meta-App:
//  - "unified" (neue Apps, INSTAGRAM_CONFIG_ID gesetzt): Facebook Login for Business mit config_id,
//    Token für einen Business-Integration-Systemnutzer, Aufrufe an graph.facebook.com
//    Doku: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login
//  - "instagram" (ältere Apps): Instagram-Login, Aufrufe an graph.instagram.com
const config = require("../config");

const unified = () => Boolean(config.instagram.configId);
const G = () => (unified() ? `https://graph.facebook.com/${config.instagram.unifiedVersion}` : `https://graph.instagram.com/${config.instagram.version}`);
const REDIRECT = () => `${config.baseUrl}/auth/instagram/callback`;
const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];

function authorizeUrl(state) {
  if (unified()) {
    return `https://www.facebook.com/${config.instagram.unifiedVersion}/dialog/oauth?${new URLSearchParams({
      client_id: config.instagram.appId, config_id: config.instagram.configId, redirect_uri: REDIRECT(),
      response_type: "code", override_default_response_type: "true", state,
    })}`;
  }
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
  if (unified()) {
    const j = await json(await fetch(`${G()}/oauth/access_token?${new URLSearchParams({
      client_id: config.instagram.appId, client_secret: config.instagram.appSecret, redirect_uri: REDIRECT(), code,
    })}`), "Token");
    // Ablauf hängt von der Konfiguration ab ("Nie" empfohlen); ohne expires_in läuft der Token nicht ab
    return { accessToken: j.access_token, refreshToken: null, expiresAt: j.expires_in ? Date.now() + (j.expires_in - 3600) * 1000 : null, mode: "unified" };
  }
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
  if (unified()) throw new Error("Zugang abgelaufen – bitte Instagram neu verbinden");
  const j = await json(await fetch(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({
    grant_type: "ig_refresh_token", access_token: accessToken,
  })}`), "Token verlängern");
  return { accessToken: j.access_token, expiresAt: Date.now() + (j.expires_in - 3600) * 1000 };
}

// Alle Instagram-Accounts, die bei der Anmeldung freigegeben wurden
async function profiles(token) {
  if (!unified()) return [await profile(token)];
  const j = await json(await fetch(`${G()}/me/assigned_instagram_accounts?${new URLSearchParams({ fields: "id,username", access_token: token })}`), "Accounts");
  const list = (j.data || []).map((a) => ({ externalId: String(a.id), username: a.username ? "@" + a.username : null }));
  if (!list.length) throw new Error("Instagram: Bei der Anmeldung wurde kein Instagram-Account freigegeben");
  return list;
}

async function profile(token) {
  const j = await json(await fetch(`${G()}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`), "Profil");
  return { externalId: j.user_id || j.id, username: j.username ? "@" + j.username : null };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Veröffentlicht ein Reel. videoUrl muss öffentlich per HTTPS erreichbar sein. */
// POST an die Graph-API; Token je nach Weg im Header oder als Parameter
const post = (url, token, body) => fetch(url, unified()
  ? { method: "POST", body: new URLSearchParams({ ...Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)])), access_token: token }) }
  : { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

async function publish({ token, igUserId, videoUrl, caption }) {
  const c = await json(await post(`${G()}/${igUserId}/media`, token,
    { media_type: "REELS", video_url: videoUrl, caption: caption.slice(0, 2200), share_to_feed: true }), "Container");
  // Meta verarbeitet das Video asynchron
  for (let i = 0; i < 60; i++) {
    await sleep(i < 6 ? 5000 : 10000);
    const s = await json(await fetch(`${G()}/${c.id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`), "Status");
    if (s.status_code === "FINISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram-Verarbeitung: ${s.status || s.status_code}`);
    if (i === 59) throw new Error("Instagram-Verarbeitung dauert zu lange");
  }
  const p = await json(await post(`${G()}/${igUserId}/media_publish`, token, { creation_id: c.id }), "Veröffentlichen");
  let permalink = null;
  try {
    const m = await json(await fetch(`${G()}/${p.id}?fields=permalink&access_token=${encodeURIComponent(token)}`), "Link");
    permalink = m.permalink;
  } catch {}
  return { mediaId: p.id, permalink };
}

module.exports = { authorizeUrl, exchangeCode, refresh, profile, profiles, publish, unified };

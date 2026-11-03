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

// Alle Instagram-Accounts, die bei der Anmeldung freigegeben wurden.
// Meta liefert die Freigabe je nach Konfiguration an unterschiedlichen Stellen und teils mit Verzögerung –
// daher mehrere Wege und bis zu drei Versuche. Antworten werden (ohne Token) protokolliert.
const short = (o) => JSON.stringify(o).replace(/"access_token":"[^"]+"/g, '"access_token":"…"').slice(0, 600);
async function profiles(token) {
  if (!unified()) return [await profile(token)];
  const get = async (pathQ, what) => {
    try {
      const j = await json(await fetch(`${G()}/${pathQ}${pathQ.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`), what);
      console.log(`Instagram-Accounts: ${what} →`, short(j));
      return j;
    } catch (e) { console.error(`Instagram-Accounts: ${what} → Fehler:`, e.message); return null; }
  };
  const appToken = `${config.instagram.appId}|${config.instagram.appSecret}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  for (let attempt = 1; attempt <= 3; attempt++) {
    const seen = new Map();
    const add = (id, username) => { if (id && !seen.has(String(id))) seen.set(String(id), username ? "@" + username : null); };

    // 1. Dem Systemnutzer zugewiesene Instagram-Accounts (laut Doku der Standardweg)
    const a = await get("me/assigned_instagram_accounts?fields=id,username", `Versuch ${attempt}: zugewiesene Accounts`);
    (a?.data || []).forEach((x) => add(x.id, x.username));

    // 2. Freigaben direkt aus dem Token (granulare Berechtigungen mit Ziel-IDs)
    let businessId = null;
    try {
      const d = await json(await fetch(`${G()}/debug_token?${new URLSearchParams({ input_token: token, access_token: appToken })}`), "Token prüfen");
      const data = d.data || {};
      console.log(`Instagram-Accounts: Versuch ${attempt}: Token →`, short({ type: data.type, user_id: data.user_id, profile_id: data.profile_id, expires_at: data.expires_at, granular_scopes: data.granular_scopes }));
      for (const g of data.granular_scopes || []) {
        if (/^instagram_/.test(g.scope)) for (const tid of g.target_ids || []) add(tid, null);
        if (g.scope === "business_management" && g.target_ids?.length) businessId = g.target_ids[0];
      }
    } catch (e) { console.error("Instagram-Accounts: Token prüfen → Fehler:", e.message); }

    // 3. Über das Business-Portfolio des Systemnutzers
    if (!seen.size) {
      const me = await get("me?fields=id,name", `Versuch ${attempt}: Systemnutzer`);
      const biz = businessId ? { data: [{ id: businessId }] } : await get("me/businesses?fields=id,name", `Versuch ${attempt}: Portfolios`);
      for (const b of biz?.data || []) {
        for (const edge of ["owned_instagram_accounts", "instagram_accounts", "client_instagram_assets"]) {
          const r = await get(`${b.id}/${edge}?fields=id,username`, `Versuch ${attempt}: ${edge}`);
          (r?.data || []).forEach((x) => add(x.id, x.username));
          if (seen.size) break;
        }
      }
      void me;
    }

    // 4. Über das freigegebene Werbekonto (Unified Login teilt oft Instagram-Account + Werbekonto)
    if (!seen.size) {
      const ads = await get("me/assigned_ad_accounts?fields=id,account_id,name", `Versuch ${attempt}: Werbekonten`);
      for (const ad of ads?.data || []) {
        const act = String(ad.id || "").startsWith("act_") ? ad.id : `act_${ad.account_id || ad.id}`;
        for (const edge of ["instagram_accounts", "connected_instagram_accounts"]) {
          const r = await get(`${act}/${edge}?fields=id,username`, `Versuch ${attempt}: ${edge} über Werbekonto`);
          (r?.data || []).forEach((x) => add(x.id, x.username));
          if (seen.size) break;
        }
      }
    }

    // 5. Über verknüpfte Facebook-Seiten (ältere Einrichtung)
    if (!seen.size) {
      const p = await get("me/accounts?fields=instagram_business_account{id,username}", `Versuch ${attempt}: Seiten`);
      (p?.data || []).forEach((x) => x.instagram_business_account && add(x.instagram_business_account.id, x.instagram_business_account.username));
    }

    // Fehlende Benutzernamen nachladen; nur echte Instagram-Accounts behalten
    const list = [];
    for (const [id, username] of seen) {
      if (username) { list.push({ externalId: id, username }); continue; }
      const u = await get(`${id}?fields=username`, "Benutzername");
      if (u?.username) list.push({ externalId: id, username: "@" + u.username });
    }
    if (list.length) return list;
    if (attempt < 3) await sleep(attempt * 4000);   // Freigabe kommt bei Meta teils verzögert an
  }
  throw new Error("Instagram: Bei der Anmeldung wurde kein Instagram-Account freigegeben. Bitte beim Verbinden im Meta-Fenster den Instagram-Account auswählen.");
}

// Account direkt per ID prüfen (Ausweg, wenn Meta die Freigabe nicht auflistet)
async function accountById(token, id) {
  const j = await json(await fetch(`${G()}/${encodeURIComponent(id)}?${new URLSearchParams({ fields: "id,username", access_token: token })}`), "Account prüfen");
  if (!j.username) throw new Error("Instagram: Unter dieser ID wurde kein Instagram-Account gefunden");
  return { externalId: String(j.id || id), username: "@" + j.username };
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

/** Kennzahlen eines Reels: Likes/Kommentare über Felder, Views/Reichweite/Shares/Saves über Insights (braucht Insights-Berechtigung) */
async function metrics(token, mediaId) {
  const m = await json(await fetch(`${G()}/${mediaId}?fields=like_count,comments_count&access_token=${encodeURIComponent(token)}`), "Kennzahlen");
  const out = { views: null, likes: m.like_count || 0, comments: m.comments_count || 0, shares: null, saved: null, reach: null };
  try {
    const ins = await json(await fetch(`${G()}/${mediaId}/insights?metric=views,reach,shares,saved&access_token=${encodeURIComponent(token)}`), "Insights");
    for (const d of ins.data || []) { const v = d.values?.[0]?.value ?? d.total_value?.value ?? 0; if (d.name === "views" || d.name === "plays") out.views = v; else if (d.name in out) out[d.name] = v; }
  } catch (e) { out.insightsError = e.message; }
  return out;
}

module.exports = { metrics, authorizeUrl, exchangeCode, refresh, profile, profiles, accountById, publish, unified };

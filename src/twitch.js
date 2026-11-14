// Twitch über die offizielle Schnittstelle (Helix): Kanäle suchen, Profilbild, Follower, vergangene Streams.
// Braucht TWITCH_CLIENT_ID und TWITCH_CLIENT_SECRET (kostenlose App unter dev.twitch.tv/console). Ohne die Schlüssel bleibt
// ClipLab beim langsameren Weg über yt-dlp und der Eingabe des genauen Kanalnamens.
const config = require("./config");

const enabled = () => Boolean(config.twitch.clientId && config.twitch.clientSecret);
let tok = null;   // { value, until }

async function token() {
  if (tok && Date.now() < tok.until) return tok.value;
  const r = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST", signal: AbortSignal.timeout(8000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.twitch.clientId, client_secret: config.twitch.clientSecret, grant_type: "client_credentials" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("Twitch lehnt die Schlüssel ab (" + (j.message || r.status) + ")");
  tok = { value: j.access_token, until: Date.now() + Math.max(60, (j.expires_in || 3600) - 300) * 1000 };
  return tok.value;
}

async function helix(path, params, retry = true) {
  const r = await fetch(`https://api.twitch.tv/helix/${path}?${new URLSearchParams(params)}`, {
    signal: AbortSignal.timeout(8000), headers: { "Client-Id": config.twitch.clientId, Authorization: `Bearer ${await token()}` },
  });
  if (r.status === 401 && retry) { tok = null; return helix(path, params, false); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Twitch antwortet mit " + r.status + (j.message ? ": " + j.message : ""));
  return j;
}

// "3h8m33s" → Sekunden
const seconds = (s) => { const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(String(s || "")); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : null; };
const pic = (u, w, h) => (typeof u === "string" && u ? u.replace(/%?\{width\}/g, w).replace(/%?\{height\}/g, h) : null);

// Vorschläge beim Tippen
async function search(q) {
  const j = await helix("search/channels", { query: String(q).slice(0, 60), first: "8" });
  return (j.data || []).map((c) => ({ platform: "twitch", name: c.broadcaster_login, label: c.display_name || c.broadcaster_login, avatar: c.thumbnail_url || null, live: Boolean(c.is_live), game: c.game_name || "" }));
}

// Kanal mit Profilbild, Followern und den letzten aufgezeichneten Streams; null, wenn es den Kanal nicht gibt
async function channel(login, limit = 12) {
  const u = ((await helix("users", { login })).data || [])[0];
  if (!u) return null;
  const [arch, fol] = await Promise.all([
    helix("videos", { user_id: u.id, type: "archive", first: String(limit) }),
    helix("channels/followers", { broadcaster_id: u.id, first: "1" }).catch(() => null),
  ]);
  let vids = arch.data || [];
  if (!vids.length) vids = (await helix("videos", { user_id: u.id, type: "all", first: String(limit) })).data || [];
  return {
    name: u.login, label: u.display_name || u.login, avatar: u.profile_image_url || null, followers: fol && typeof fol.total === "number" ? fol.total : null,
    streams: vids.map((v) => ({
      id: "v" + v.id, title: String(v.title || "").slice(0, 160), url: `https://www.twitch.tv/videos/${v.id}`, duration: seconds(v.duration), live: false,
      thumb: pic(v.thumbnail_url, "320", "180"), at: v.created_at ? Math.round(new Date(v.created_at).getTime() / 1000) : null, views: Number(v.view_count) || null,
    })),
  };
}

module.exports = { enabled, search, channel };

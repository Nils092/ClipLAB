// Lädt Videos per Link mit yt-dlp auf den Server (bis 1080p, MP4):
// YouTube, Twitch (VODs und Clips), Kick, TikTok, Instagram, X/Twitter, Vimeo.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const config = require("./config");

const BIN = path.join(path.dirname(config.whisper.python), "yt-dlp");
const available = () => fs.existsSync(BIN);

// Nur bekannte Videoplattformen (keine beliebigen Adressen vom Server aus abrufen)
const PLATFORMS = [
  ["YouTube", /(^|\.)(youtube\.com|youtu\.be)$/i],
  ["Twitch", /(^|\.)twitch\.tv$/i],
  ["Kick", /(^|\.)kick\.com$/i],
  ["TikTok", /(^|\.)tiktok\.com$/i],
  ["Instagram", /(^|\.)instagram\.com$/i],
  ["X", /(^|\.)(x\.com|twitter\.com)$/i],
  ["Vimeo", /(^|\.)vimeo\.com$/i],
];
function platformOf(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    const hit = PLATFORMS.find(([, re]) => re.test(u.hostname));
    return hit ? hit[0] : null;
  } catch { return null; }
}
const isYouTube = (url) => platformOf(url) === "YouTube";

// "1:20:00", "80:00" oder "4800" → Sekunden
function parseTime(s) {
  s = String(s || "").trim();
  if (!s) return null;
  if (!/^\d+(:\d{1,2}){0,2}$/.test(s)) return NaN;
  return s.split(":").map(Number).reduce((a, b) => a * 60 + b, 0);
}

// section: { from, to } in Sekunden (optional) – lädt nur diesen Ausschnitt
function download(url, dir, { onProgress, onTitle, onMeta, section, audioOnly } = {}) {
  return new Promise((resolve, reject) => {
    if (!available()) return reject(new Error("Download per Link ist auf dem Server nicht installiert (bash deploy/update.sh ausführen)"));
    const sec = section && (section.from != null || section.to != null)
      ? ["--download-sections", `*${section.from || 0}-${section.to != null ? section.to : "inf"}`] : [];
    // Bild und Ton kommen bei YouTube getrennt – Fortschritt über beide Teile zusammenrechnen
    let part = 0, prev = 0;
    const weights = audioOnly ? [[0, 1]] : [[0, 0.85], [0.85, 0.97], [0.97, 1]];
    const fmt = audioOnly
      ? ["-f", "ba[ext=m4a]/ba/b"]
      : ["-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b", "--merge-output-format", "mp4"];
    const args = [
      "--concurrent-fragments", "8", "--no-playlist", "--newline", "--no-simulate", "--progress", "--no-warnings", "--match-filter", "!is_live", ...sec,
      ...fmt, "--max-filesize", `${config.maxProjectMB}M`,
      "--js-runtimes", "node",
      "--progress-template", "download:PROG %(progress._percent_str)s",
      "--print", "before_dl:TITLE %(title)s", "--print", "after_move:FILE %(filepath)s",
      "--print", "before_dl:META %(.{title,uploader,channel,uploader_id,channel_url,uploader_url,webpage_url})j",
      "-o", path.join(dir, audioOnly ? "early-audio.%(ext)s" : "source.%(ext)s"), url,
    ];
    const p = spawn(BIN, args, { env: { ...process.env, HOME: config.dataDir } });
    let file = null, err = "";
    const onLine = (line) => {
      line = line.trim();
      let m;
      if ((m = /^PROG\s+([\d.]+)%/.exec(line))) {
        const x = Number(m[1]) / 100;
        if (x < prev - 0.3 && part < weights.length - 1) part++;   // nächster Teil (Ton) beginnt
        prev = x;
        const [a, b] = weights[part];
        onProgress && onProgress(a + (b - a) * x);
      }
      else if ((m = /^TITLE (.*)$/.exec(line))) onTitle && onTitle(m[1]);
      else if ((m = /^META (.*)$/.exec(line))) { try { const j = JSON.parse(m[1]); onMeta && onMeta({ title: j.title || "", creator: j.channel || j.uploader || "", handle: j.uploader_id || "", url: j.webpage_url || url }); } catch {} }
      else if ((m = /^FILE (.*)$/.exec(line))) file = m[1];
    };
    let buf = "";
    p.stdout.on("data", (d) => { buf += d; const parts = buf.split("\n"); buf = parts.pop(); parts.forEach(onLine); });
    p.stderr.on("data", (d) => { err += d; if (err.length > 20_000) err = err.slice(-8_000); });
    p.on("error", reject);
    p.on("close", (code) => {
      if (buf) onLine(buf);
      if (code === 0 && !file) return reject(new Error("Download übersprungen – laufende Livestreams gehen nicht. Nimm das VOD, sobald der Stream vorbei ist."));
      if (code !== 0 || !file || !fs.existsSync(file)) {
        const msg = (err.match(/ERROR: (.*)/g) || []).pop() || err.trim().split("\n").pop() || `Code ${code}`;
        const hint = /Sign in to confirm|bot/i.test(msg) ? " – YouTube blockiert Downloads von diesem Server gerade. Lade das Video stattdessen als Datei hoch."
          : /is_live|live event|currently live/i.test(msg) ? " – Laufende Livestreams gehen nicht. Nimm das VOD, sobald der Stream vorbei ist."
          : /subscriber|sub-only|only available to/i.test(msg) ? " – Das Video ist nur für Abonnenten freigegeben."
          : /File is larger|max-filesize/i.test(msg) ? " – Das Video ist zu groß. Gib einen Zeitbereich (Von – Bis) an." : "";
        return reject(new Error("Download fehlgeschlagen: " + msg.replace(/^ERROR:\s*/, "").slice(0, 300) + hint));
      }
      resolve(file);
    });
  });
}

// ---------- Kanäle und Playlists (für den Clip-Agenten) ----------
// Erkennt, was ein Link ist: Kanal/Playlist (wird regelmäßig geprüft) oder einzelnes Video (wird einmal geclippt).
// Gibt { kind, platform, url, listUrl, label } zurück oder null.
function sourceOf(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return null; }
  const platform = platformOf(u.href);
  if (!platform) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (platform === "YouTube") {
    const list = u.searchParams.get("list");
    if (u.hostname.endsWith("youtu.be") || parts[0] === "watch" || parts[0] === "shorts" || parts[0] === "live") return { kind: "video", platform, url: u.href, label: "Einzelnes Video" };
    if (parts[0] === "playlist" && list) { const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`; return { kind: "kanal", platform, url, listUrl: url, label: "Playlist" }; }
    let base = null;
    if (/^@[\w.\-]+$/.test(parts[0] || "")) base = parts[0];
    else if (["channel", "c", "user"].includes(parts[0]) && /^[\w.\-]+$/.test(parts[1] || "")) base = `${parts[0]}/${parts[1]}`;
    if (!base) return null;
    // "/streams" = aufgezeichnete Livestreams des Kanals, sonst die normalen Videos (ohne Shorts)
    const tab = parts[base.includes("/") ? 2 : 1] === "streams" ? "streams" : "videos";
    const url = `https://www.youtube.com/${base}/${tab}`;
    return { kind: "kanal", platform, url, listUrl: url, label: (base.startsWith("@") ? base : base.split("/")[1]) + (tab === "streams" ? " (Streams)" : "") };
  }
  if (platform === "Twitch") {
    if (parts[0] === "videos" && /^\d+$/.test(parts[1] || "")) return { kind: "video", platform, url: u.href, label: "Einzelnes Video" };
    if (parts[1] === "clip" || u.hostname.startsWith("clips.")) return { kind: "video", platform, url: u.href, label: "Einzelnes Video" };
    if (!/^\w{2,30}$/.test(parts[0] || "")) return null;
    const name = parts[0].toLowerCase();
    return { kind: "kanal", platform, url: `https://www.twitch.tv/${name}`, listUrl: `https://www.twitch.tv/${name}/videos?filter=archives&sort=time`, label: name + " (VODs)" };
  }
  // Kick: nur aufgezeichnete Videos und Clips – ein Kanal-Link wäre der laufende Stream
  if (platform === "Kick" && !/\/(videos?|clips?)\//.test(u.pathname) && !u.searchParams.get("clip")) return null;
  return { kind: "video", platform, url: u.href, label: "Einzelnes Video" };
}

// Neueste Videos eines Kanals oder einer Playlist auflisten (nur Daten, kein Download)
function list(listUrl, { limit = 6, timeoutMs = 90_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!available()) return reject(new Error("Download per Link ist auf dem Server nicht installiert (bash deploy/update.sh ausführen)"));
    const args = ["--flat-playlist", "--playlist-end", String(limit), "--no-warnings", "--js-runtimes", "node",
      "--print", "%(.{id,title,url,webpage_url,duration,live_status})j", listUrl];
    const p = spawn(BIN, args, { env: { ...process.env, HOME: config.dataDir } });
    let out = "", err = "";
    const timer = setTimeout(() => { p.kill("SIGKILL"); }, timeoutMs);
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; if (err.length > 20_000) err = err.slice(-8_000); });
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      const items = parseList(out, listUrl);
      if (!items.length && code !== 0) {
        const msg = (err.match(/ERROR: (.*)/g) || []).pop() || err.trim().split("\n").pop() || (code == null ? "Zeitüberschreitung" : `Code ${code}`);
        return reject(new Error(msg.replace(/^ERROR:\s*/, "").slice(0, 200)));
      }
      resolve(items);
    });
  });
}
// Ausgabe von yt-dlp (eine JSON-Zeile je Video) in eine saubere Liste umwandeln, neuestes zuerst
function parseList(out, listUrl) {
  const items = [];
  for (const line of String(out || "").split("\n")) {
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (!j || !j.id) continue;
    let url = [j.webpage_url, j.url].find((x) => typeof x === "string" && platformOf(x));
    if (!url && isYouTube(listUrl) && /^[\w-]{11}$/.test(j.id)) url = `https://www.youtube.com/watch?v=${j.id}`;
    if (!url) continue;
    items.push({ id: String(j.id).slice(0, 80), title: String(j.title || "").slice(0, 160), url, duration: Number(j.duration) || null, live: ["is_live", "is_upcoming"].includes(j.live_status) });
  }
  return items;
}

module.exports = { download, list, parseList, sourceOf, available, isYouTube, platformOf, parseTime };

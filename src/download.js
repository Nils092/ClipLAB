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
function download(url, dir, { onProgress, onTitle, section } = {}) {
  return new Promise((resolve, reject) => {
    if (!available()) return reject(new Error("Download per Link ist auf dem Server nicht installiert (bash deploy/update.sh ausführen)"));
    const sec = section && (section.from != null || section.to != null)
      ? ["--download-sections", `*${section.from || 0}-${section.to != null ? section.to : "inf"}`] : [];
    const args = [
      "--no-playlist", "--newline", "--no-simulate", "--progress", "--no-warnings", "--match-filter", "!is_live", ...sec,
      "-f", "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
      "--merge-output-format", "mp4", "--max-filesize", `${config.maxProjectMB}M`,
      "--js-runtimes", "node",
      "--progress-template", "download:PROG %(progress._percent_str)s",
      "--print", "before_dl:TITLE %(title)s", "--print", "after_move:FILE %(filepath)s",
      "-o", path.join(dir, "source.%(ext)s"), url,
    ];
    const p = spawn(BIN, args, { env: { ...process.env, HOME: config.dataDir } });
    let file = null, err = "";
    const onLine = (line) => {
      line = line.trim();
      let m;
      if ((m = /^PROG\s+([\d.]+)%/.exec(line))) onProgress && onProgress(Number(m[1]) / 100);
      else if ((m = /^TITLE (.*)$/.exec(line))) onTitle && onTitle(m[1]);
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

module.exports = { download, available, isYouTube, platformOf, parseTime };

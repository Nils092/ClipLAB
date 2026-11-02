// Lädt ein YouTube-Video mit yt-dlp auf den Server (bis 1080p, MP4).
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const config = require("./config");

const BIN = path.join(path.dirname(config.whisper.python), "yt-dlp");
const available = () => fs.existsSync(BIN);

function isYouTube(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && /(^|\.)(youtube\.com|youtu\.be)$/i.test(u.hostname);
  } catch { return false; }
}

function download(url, dir, { onProgress, onTitle } = {}) {
  return new Promise((resolve, reject) => {
    if (!available()) return reject(new Error("YouTube-Download ist auf dem Server nicht installiert (bash deploy/update.sh ausführen)"));
    const args = [
      "--no-playlist", "--newline", "--no-simulate", "--progress", "--no-warnings",
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
      if (code !== 0 || !file || !fs.existsSync(file)) {
        const msg = (err.match(/ERROR: (.*)/g) || []).pop() || err.trim().split("\n").pop() || `Code ${code}`;
        const hint = /Sign in to confirm|bot/i.test(msg) ? " – YouTube blockiert Downloads von diesem Server gerade. Lade das Video stattdessen als Datei hoch." : "";
        return reject(new Error("Download fehlgeschlagen: " + msg.replace(/^ERROR:\s*/, "").slice(0, 300) + hint));
      }
      resolve(file);
    });
  });
}

module.exports = { download, available, isYouTube };

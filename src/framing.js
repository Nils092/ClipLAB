// Personen-Tracking fürs Hochformat: fragt scripts/framing.py, wo die Personen sind,
// und baut daraus Kamerafahrten (ffmpeg-sendcmd-Datei für den Zuschnitt).
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const config = require("./config");

const SCRIPT = path.join(__dirname, "..", "scripts", "framing.py");

function track(src, start, end) {
  return new Promise((resolve) => {
    const py = fs.existsSync(config.whisper.python) ? config.whisper.python : "python3";
    const p = spawn(py, [SCRIPT, src, String(start), String(end)], { env: { ...process.env, WHISPER_MODELS_DIR: path.join(config.dataDir, "models") } });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", () => resolve(null));
    p.on("close", (code) => {
      if (code !== 0) { console.error("Personen-Erkennung:", err.trim().split("\n").pop()); return resolve(null); }
      try { const j = JSON.parse(out); resolve(j.found && j.points.length ? j : null); } catch { resolve(null); }
    });
  });
}

// Breite des auf 1920 px Höhe skalierten Bildes → Befehle für crop@pc (x in Pixeln), alle 0,1 s weich interpoliert
function sendcmd(points, srcW, srcH) {
  const Ws = 2 * Math.round((srcW * 1920) / srcH / 2);
  const px = (cx) => Math.round(Math.min(Ws - 1080, Math.max(0, cx * Ws - 540)));
  const lines = [];
  for (let i = 0; i < points.length; i++) {
    const [t, cx] = points[i], next = points[i + 1];
    lines.push(`${t.toFixed(2)} crop@pc x ${px(cx)};`);
    if (next && !next[2]) {
      for (let s = t + 0.1; s < next[0] - 0.01; s += 0.1) {
        const k = (s - t) / (next[0] - t), e = k * k * (3 - 2 * k);
        lines.push(`${s.toFixed(2)} crop@pc x ${px(cx + (next[1] - cx) * e)};`);
      }
    }
  }
  return { text: lines.join("\n") + "\n", x0: px(points[0][1]) };
}

module.exports = { track, sendcmd };

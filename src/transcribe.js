// Startet Whisper (scripts/transcribe.py) auf dem eigenen Server.
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const config = require("./config");

const SCRIPT = path.join(__dirname, "..", "scripts", "transcribe.py");
const available = () => fs.existsSync(config.whisper.python);

function transcribe(wavFile, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (!available()) return reject(new Error("Whisper ist auf dem Server nicht installiert (bash deploy/update.sh ausführen)"));
    const env = {
      ...process.env,
      WHISPER_MODEL: config.whisper.model, WHISPER_LANGUAGE: config.whisper.language,
      WHISPER_THREADS: config.whisper.threads, WHISPER_MODELS_DIR: path.join(config.dataDir, "models"),
      HF_HOME: path.join(config.dataDir, "models", "hf"), HF_HUB_DISABLE_TELEMETRY: "1",
    };
    const p = spawn(config.whisper.python, [SCRIPT, wavFile], { env });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => {
      for (const line of String(d).split("\n")) {
        const m = /^\{"progress": ([\d.]+)\}$/.exec(line.trim());
        if (m) onProgress && onProgress(Number(m[1]));
        else if (line.trim()) { err += line + "\n"; if (err.length > 20_000) err = err.slice(-8_000); }
      }
    });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error("Transkription fehlgeschlagen: " + (err.trim().split("\n").pop() || `Code ${code}`)));
      try { resolve(JSON.parse(out)); } catch { reject(new Error("Transkription lieferte kein gültiges Ergebnis")); }
    });
  });
}

module.exports = { transcribe, available };

// Schreibt mit, was gesagt wird – mit Zeit für jedes Wort.
// Mit GROQ_API_KEY in der Cloud (Sekunden statt Minuten), sonst bzw. bei Fehlern mit Whisper auf dem eigenen Server.
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const config = require("./config");
const { ffmpeg } = require("./media");

const SCRIPT = path.join(__dirname, "..", "scripts", "transcribe.py");
const MIN_RAM = 6 * 1024 ** 3;   // Whisper auf dem eigenen Server braucht ~3 GB – darunter beendet das System sonst ganz ClipLab (oom-kill)
const localAvailable = () => fs.existsSync(config.whisper.python) && os.totalmem() >= MIN_RAM;
const available = () => Boolean(config.groq.apiKey) || localAvailable();

// ---------- Cloud (Groq, Whisper large-v3-turbo) ----------
const LANG = { german: "de", english: "en", french: "fr", spanish: "es", italian: "it", turkish: "tr", dutch: "nl", polish: "pl", portuguese: "pt", russian: "ru", arabic: "ar" };
const CHUNK = 20 * 60; // Sekunden pro Stück (bleibt klein genug für das Upload-Limit)

// Wartezeit aus Retry-After bzw. "Please try again in 7m12.5s"
function retryWait(r, j, attempt) {
  const h = Number(r.headers.get("retry-after"));
  if (h > 0) return h + 1;
  const m = /try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i.exec(j.error?.message || "");
  if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) + 1;
  return 15 * (attempt + 1);
}

async function cloud(wavFile, { onProgress, onWait } = {}) {
  const { duration } = await probeAudio(wavFile);
  const out = { language: null, duration, segments: [] };
  for (let off = 0; off < duration; off += CHUNK) {
    const part = `${wavFile}.${off}.ogg`, cache = path.join(path.dirname(wavFile), `tr.${off}.json`);
    if (fs.existsSync(cache)) {   // Teil schon fertig (z. B. vor einem Neustart) – nicht noch einmal an Groq schicken
      try { const c = JSON.parse(fs.readFileSync(cache, "utf8")); if (!out.language) out.language = c.language; out.segments.push(...c.segments); onProgress && onProgress(Math.min(1, (off + CHUNK) / duration)); continue; } catch {}
    }
    await ffmpeg(["-ss", String(off), "-t", String(CHUNK), "-i", wavFile, "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", part]);
    try {
      const fd = new FormData();
      fd.append("file", new Blob([await fs.promises.readFile(part)], { type: "audio/ogg" }), "audio.ogg");
      fd.append("model", config.groq.model);
      fd.append("response_format", "verbose_json");
      fd.append("timestamp_granularities[]", "word");
      fd.append("timestamp_granularities[]", "segment");
      fd.append("temperature", "0");
      if (config.whisper.language && config.whisper.language !== "auto") fd.append("language", config.whisper.language);
      // Bei Groq-Limit (429) bzw. kurzer Störung warten und erneut senden – statt auf den langsamen eigenen Server auszuweichen
      let r, j;
      for (let attempt = 0; ; attempt++) {
        r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST", headers: { Authorization: `Bearer ${config.groq.apiKey}` }, body: fd, signal: AbortSignal.timeout(300_000),
        });
        j = await r.json().catch(() => ({}));
        if (r.ok || attempt >= 6 || !(r.status === 429 || r.status >= 500)) break;
        const wait = retryWait(r, j, attempt);
        if (wait > 90 * 60) break;
        console.log(`Groq ${r.status} – warte ${Math.round(wait)} s und versuche es erneut`);
        onWait && onWait(wait);
        await new Promise((ok) => setTimeout(ok, wait * 1000));
      }
      if (!r.ok) throw new Error(j.error?.message || `Groq antwortet mit ${r.status}`);
      if (!out.language && j.language) out.language = LANG[String(j.language).toLowerCase()] || String(j.language).toLowerCase().slice(0, 2);
      const lang = out.language;
      const segs = [];
      const words = (j.words || []).map((w) => ({ w: String(w.word || "").trim(), s: +(w.start + off).toFixed(2), e: +(w.end + off).toFixed(2) })).filter((w) => w.w);
      for (const sg of j.segments || []) {
        const s = +(sg.start + off).toFixed(2), e = +(sg.end + off).toFixed(2);
        segs.push({ s, e, text: String(sg.text || "").trim(), words: words.filter((w) => w.s >= s - 0.05 && w.s < e) });
      }
      out.segments.push(...segs);
      try { fs.writeFileSync(cache, JSON.stringify({ language: lang, segments: segs })); } catch {}
    } finally {
      fs.rm(part, { force: true }, () => {});
    }
    onProgress && onProgress(Math.min(1, (off + CHUNK) / duration));
  }
  return out;
}
async function probeAudio(file) {
  const st = await fs.promises.stat(file);
  return { duration: Math.max(1, (st.size - 44) / 32000) }; // 16 kHz, 16 Bit, mono
}

async function transcribe(wavFile, opts = {}) {
  if (config.groq.apiKey) {
    try { return { ...(await cloud(wavFile, opts)), engine: "groq" }; }
    catch (e) {
      console.error("Groq-Transkription fehlgeschlagen, nutze den eigenen Server:", e.message);
      if (!localAvailable()) throw new Error(/rate limit/i.test(e.message)
        ? "Groq-Limit für heute erreicht – bitte später noch einmal starten (oder bei Groq den Dev-Tarif freischalten). " + e.message.replace(/Need more tokens.*$/i, "").slice(0, 200)
        : "Transkription fehlgeschlagen: " + e.message);
    }
  }
  return { ...(await local(wavFile, opts)), engine: "server" };
}

function local(wavFile, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (!localAvailable()) return reject(new Error("Whisper ist auf dem Server nicht installiert (bash deploy/update.sh ausführen)"));
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

module.exports = { transcribe, available, cloud: () => Boolean(config.groq.apiKey) };

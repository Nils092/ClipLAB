// Hilfsfunktionen rund um ffmpeg: Video-Infos, Tonspur herauslösen, Lautstärke-Verlauf.
const { spawn } = require("child_process");
const fs = require("fs");

function exec(cmd, args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => { err += d; if (err.length > 200_000) err = err.slice(-50_000); onStderr && onStderr(String(d)); });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(lastLine(err) || `${cmd} beendet mit Code ${code}`))));
  });
}
const lastLine = (s) => s.trim().split("\n").filter((l) => !/^\s*$/.test(l)).pop() || "";

const ffmpeg = (args, opts) => exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], opts);

async function probe(file) {
  const out = await exec("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file]);
  const j = JSON.parse(out);
  const v = (j.streams || []).find((s) => s.codec_type === "video");
  const a = (j.streams || []).find((s) => s.codec_type === "audio");
  if (!v) throw new Error("Die Datei enthält keine Videospur");
  let w = Number(v.width), h = Number(v.height);
  const rot = Math.abs(Number(v.tags?.rotate || v.side_data_list?.find((x) => x.rotation != null)?.rotation || 0));
  if (rot === 90 || rot === 270) [w, h] = [h, w];
  return { duration: Number(j.format?.duration || v.duration || 0), width: w, height: h, hasAudio: Boolean(a) };
}

// Tonspur als 16 kHz Mono-WAV (für Whisper und die Lautstärke-Analyse)
const extractAudio = (src, out) => ffmpeg(["-i", src, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", out]);

// Lautstärke in dB für jedes Zeitfenster (Standard 0,5 s) – liest die WAV-Datei in Stücken
async function loudness(wavFile, step = 0.5) {
  const fd = await fs.promises.open(wavFile, "r");
  try {
    // "data"-Block im WAV-Kopf suchen
    const head = Buffer.alloc(4096);
    await fd.read(head, 0, head.length, 0);
    let pos = 12, dataStart = 44, rate = 16000;
    while (pos + 8 <= head.length) {
      const id = head.toString("ascii", pos, pos + 4), size = head.readUInt32LE(pos + 4);
      if (id === "fmt ") rate = head.readUInt32LE(pos + 12);
      if (id === "data") { dataStart = pos + 8; break; }
      pos += 8 + size + (size % 2);
    }
    const win = Math.max(1, Math.round(rate * step));
    const env = [];
    let sum = 0, n = 0, offset = dataStart, carry = null;
    const buf = Buffer.alloc(1 << 20);
    for (;;) {
      const { bytesRead } = await fd.read(buf, 0, buf.length, offset);
      if (!bytesRead) break;
      offset += bytesRead;
      let chunk = buf.subarray(0, bytesRead);
      if (carry) { chunk = Buffer.concat([carry, chunk]); carry = null; }
      const even = chunk.length - (chunk.length % 2);
      if (even < chunk.length) carry = Buffer.from(chunk.subarray(even));
      for (let i = 0; i < even; i += 2) {
        const s = chunk.readInt16LE(i) / 32768;
        sum += s * s;
        if (++n === win) { env.push(20 * Math.log10(Math.sqrt(sum / n) + 1e-6)); sum = 0; n = 0; }
      }
    }
    if (n > win / 4) env.push(20 * Math.log10(Math.sqrt(sum / n) + 1e-6));
    return { step, db: env.map((x) => Math.round(x * 10) / 10) };
  } finally {
    await fd.close();
  }
}

module.exports = { exec, ffmpeg, probe, extractAudio, loudness };

// Schneidet einen Clip ins Hochformat 1080×1920, brennt Wort-für-Wort-Untertitel ein
// und legt den Titel (weiße Boxen, farbige Emojis) darüber.
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const config = require("./config");
const { ffmpeg } = require("./media");
const { buildAss } = require("./subtitles");
const framing = require("./framing");
const polish = require("./polish");

const FONTS = path.join(__dirname, "..", "assets", "fonts");
const OVERLAY = path.join(__dirname, "..", "scripts", "overlay.py");
const SPLIT_TOP = 608; // Höhe der Facecam oben im Streamer-Layout (16:9)

// Qualitätsstufen: [Zwischenstand preset/crf, Endergebnis preset/crf]
const QUALITY = {
  fast: { p1: ["ultrafast", "17"], p2: ["veryfast", "21"] },
  balanced: { p1: ["superfast", "16"], p2: ["faster", "20"] },
  best: { p1: ["veryfast", "16"], p2: ["fast", "19"] },
};

// Pfade für ffmpeg-Filter maskieren
const fpath = (p) => p.replace(/\\/g, "/").replace(/([:,'\[\]])/g, "\\$1");

// Wo der Titel sitzt (Mitte in Pixeln): im Streamer-Layout genau an der Nahtstelle
const titleCenter = (layout) => (layout === "split" ? SPLIT_TOP : Math.round(1920 * 0.22));

// layout: "crop" = Bild füllen (Personen in der Mitte), "fit" = ganzes Bild auf unscharfem Hintergrund,
//         "split" = Streamer: Facecam oben, Gameplay unten
// focus:  "auto" (Personen-Tracking) | "center" | "left" | "right" – welcher Bildteil beim Zuschneiden sichtbar bleibt
// cmdFile: sendcmd-Datei mit Kamerafahrt aus der Personen-Erkennung (nur "crop" + "auto")
// cam:    "tl" | "tr" | "bl" | "br" – Ecke der Facecam im Original (nur "split"), camSize = Anteil der Bildbreite
function videoFilter({ layout = "crop", focus = "center", cam = "tl", camSize = 0.3, ass, overlay, cmdFile, x0 = 0 }) {
  const x = { left: "'max(0,iw/4-540)'", right: "'min(iw-1080,iw*3/4-540)'", center: "(iw-1080)/2" }[focus] || "(iw-1080)/2";
  let g;
  if (layout === "fit") {
    g = `[0:v]split=2[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2,eq=brightness=-0.12[bg];` +
      `[b]scale=1080:1920:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[base]`;
  } else if (layout === "split") {
    const cs = Math.min(0.6, Math.max(0.12, Number(camSize) || 0.3));
    const cx = cam.endsWith("r") ? `iw-iw*${cs}` : "0", cy = cam.startsWith("b") ? `ih-iw*${cs}*9/16` : "0";
    g = `[0:v]split=2[a][b];[a]crop=w='iw*${cs}':h='iw*${cs}*9/16':x='${cx}':y='${cy}',scale=1080:${SPLIT_TOP}:force_original_aspect_ratio=increase,crop=1080:${SPLIT_TOP}[top];` +
      `[b]scale=-2:${1920 - SPLIT_TOP},crop=1080:${1920 - SPLIT_TOP}:${x}:0[bot];[top][bot]vstack[base]`;
  } else if (cmdFile) {
    g = `[0:v]scale=-2:1920,sendcmd=f=${fpath(cmdFile)},crop@pc=w=1080:h=1920:x=${x0}:y=0[base]`;
  } else {
    g = `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=w=1080:h=1920:x=${x}:y=(ih-1920)/2[base]`;
  }
  g += `;[base]setsar=1,fps=30${ass ? `,subtitles=filename=${fpath(ass)}:fontsdir=${fpath(FONTS)}` : ""}`;
  g += overlay ? `[sub];[sub][1:v]overlay=0:0:format=auto,format=yuv420p[v]` : `,format=yuv420p[v]`;
  return g;
}

// Titelbild mit Python/Pillow zeichnen; liefert false, wenn das nicht geht (dann übernimmt die ASS-Datei den Titel)
function drawTitle(text, out, centerY, credit = "") {
  return new Promise((resolve) => {
    if ((!text || !text.trim()) && !credit) return resolve(false);
    const py = fs.existsSync(config.whisper.python) ? config.whisper.python : "python3";
    const p = spawn(py, [OVERLAY, out, text || "", String(centerY), credit || ""]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", () => resolve(false));
    p.on("close", (code) => { if (code !== 0) console.error("Titelbild:", err.trim().split("\n").pop()); resolve(code === 0 && fs.existsSync(out)); });
  });
}

// words: Wörter mit Zeiten relativ zum Clip-Start ([] = ohne Untertitel)
// srcW/srcH: Originalgröße (für das Personen-Tracking)
// quiet(t0,t1): ist die Stelle (relativ zum Clip) still? – entscheidet, ob eine Pause geschnitten werden darf
// cuts: Pausen schneiden (Standard an) · sfx: Luftzug an Schnitten (Standard an)
async function renderClip({ src, start, end, words = [], out, title, credit = "", quality = "balanced", layout, focus, cam, camSize, hasAudio = true, srcW, srcH, quiet = null, cuts = true, sfx = true }) {
  const tmp1 = out + ".pass1.mp4", tmp = out + ".part.mp4";
  const base = out.replace(/\.mp4$/, "");
  const png = base + ".title.png", ass = base + ".ass";
  const overlay = await drawTitle(title, png, titleCenter(layout), credit);
  // Personen finden und den Ausschnitt mitführen (nur bei Querformat-Quellen sinnvoll)
  let cmdFile = null, x0 = 0, tracked = false;
  if (layout === "crop" && (focus || "auto") === "auto" && srcW && srcH && srcW / srcH > 0.75) {
    const tr = await framing.track(src, start, end);
    if (tr) {
      const sc = framing.sendcmd(tr.points, srcW, srcH);
      cmdFile = base + ".cmd"; x0 = sc.x0; tracked = true;
      fs.writeFileSync(cmdFile, sc.text);
    } else focus = "center";
  }
  // 1. Durchgang: Bildausschnitt und Hochformat (ohne Untertitel/Titel, hohe Qualität als Zwischenstand)
  await ffmpeg([
    "-ss", start.toFixed(2), "-i", src, "-t", (end - start).toFixed(2),
    "-filter_complex", videoFilter({ layout, focus, cam, camSize, cmdFile, x0 }), "-map", "[v]",
    ...(hasAudio ? ["-map", "0:a:0", "-c:a", "pcm_s16le", "-ar", "44100", "-ac", "2"] : []),
    "-c:v", "libx264", "-preset", (QUALITY[quality] || QUALITY.balanced).p1[0], "-crf", (QUALITY[quality] || QUALITY.balanced).p1[1], "-profile:v", "high", tmp1,
  ]);
  // 2. Durchgang: Feinschnitt
  const dur = end - start;
  const keep = cuts && words.length ? polish.planCuts(words, dur, quiet) : [[0, dur]];
  const shown = polish.remapWords(words, keep);
  const removed = dur - polish.outDuration(keep);
  fs.writeFileSync(ass, buildAss({ words: shown, hook: overlay ? "" : title, duration: polish.outDuration(keep) }));
  const useSfx = Boolean(sfx && hasAudio && fs.existsSync(polish.SFX));
  const inputs = ["-i", tmp1];
  let overlayInput = null, sfxInput = null;
  if (overlay) { inputs.push("-i", png); overlayInput = 1; }
  if (useSfx) { inputs.push("-i", polish.SFX); sfxInput = inputs.length / 2 - 1; }
  const pf = polish.polishFilter({ keep, hasAudio, ass: words.length || !overlay ? ass : null, fontsDir: FONTS, overlayInput, sfxInput, sfx: useSfx });
  await ffmpeg([
    ...inputs, "-filter_complex", pf.graph, "-map", "[v]",
    ...(hasAudio ? ["-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2"] : []),
    "-c:v", "libx264", "-preset", (QUALITY[quality] || QUALITY.balanced).p2[0], "-crf", (QUALITY[quality] || QUALITY.balanced).p2[1], "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", "-t", pf.duration.toFixed(3), tmp,
  ]);
  await fs.promises.rename(tmp, out);
  fs.rm(tmp1, { force: true }, () => {});
  return { overlay, tracked, cuts: keep.length - 1, removed: Math.round(removed * 10) / 10, duration: pf.duration };
}

// Kleine Vorschau zum Abspielen in ClipLab (540×960, startet sofort); gepostet wird immer die volle Datei
const preview = (video, out) => ffmpeg(["-i", video, "-vf", "scale=540:-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-profile:v", "main",
  "-c:a", "aac", "-b:a", "96k", "-ac", "2", "-movflags", "+faststart", out]);
const thumbnail = (video, out, at) => ffmpeg(["-ss", String(at), "-i", video, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", out]);

module.exports = { renderClip, preview, QUALITY, thumbnail, videoFilter, drawTitle, titleCenter };

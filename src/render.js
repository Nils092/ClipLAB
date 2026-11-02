// Schneidet einen Clip ins Hochformat 1080×1920, brennt Wort-für-Wort-Untertitel ein
// und legt den Titel (weiße Boxen, farbige Emojis) darüber.
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const config = require("./config");
const { ffmpeg } = require("./media");
const { buildAss } = require("./subtitles");
const framing = require("./framing");

const FONTS = path.join(__dirname, "..", "assets", "fonts");
const OVERLAY = path.join(__dirname, "..", "scripts", "overlay.py");
const SPLIT_TOP = 608; // Höhe der Facecam oben im Streamer-Layout (16:9)

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
function drawTitle(text, out, centerY) {
  return new Promise((resolve) => {
    if (!text || !text.trim()) return resolve(false);
    const py = fs.existsSync(config.whisper.python) ? config.whisper.python : "python3";
    const p = spawn(py, [OVERLAY, out, text, String(centerY)]);
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", () => resolve(false));
    p.on("close", (code) => { if (code !== 0) console.error("Titelbild:", err.trim().split("\n").pop()); resolve(code === 0 && fs.existsSync(out)); });
  });
}

// words: Wörter mit Zeiten relativ zum Clip-Start ([] = ohne Untertitel)
// srcW/srcH: Originalgröße (für das Personen-Tracking)
async function renderClip({ src, start, end, words = [], out, title, layout, focus, cam, camSize, hasAudio = true, srcW, srcH }) {
  const tmp = out + ".part.mp4";
  const base = out.replace(/\.mp4$/, "");
  const png = base + ".title.png", ass = base + ".ass";
  const overlay = await drawTitle(title, png, titleCenter(layout));
  // Ohne Titelbild (Pillow fehlt) zeichnet die ASS-Datei den Titel – dann ohne farbige Emojis
  fs.writeFileSync(ass, buildAss({ words, hook: overlay ? "" : title, duration: end - start }));
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
  await ffmpeg([
    "-ss", start.toFixed(2), "-i", src, ...(overlay ? ["-i", png] : []), "-t", (end - start).toFixed(2),
    "-filter_complex", videoFilter({ layout, focus, cam, camSize, ass, overlay, cmdFile, x0 }), "-map", "[v]",
    // Ton auf TikTok-Lautstärke bringen (wie in den Vorlagen: laut und gleichmäßig)
    ...(hasAudio ? ["-map", "0:a:0", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2"] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-profile:v", "high",
    "-movflags", "+faststart", tmp,
  ]);
  await fs.promises.rename(tmp, out);
  return { overlay, tracked };
}

const thumbnail = (video, out, at) => ffmpeg(["-ss", String(at), "-i", video, "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", out]);

module.exports = { renderClip, thumbnail, videoFilter, drawTitle, titleCenter };

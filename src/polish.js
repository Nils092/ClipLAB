// Feinschnitt (2. Durchgang): stille Pausen raus, Schnitte als „Punch-in“ (leichter Zoom-Wechsel),
// Untertitel und Titel darüber, weiche Ein-/Ausblendung, dezenter Luftzug an Schnitten, Lautstärke angleichen.
const path = require("path");

const SFX = path.join(__dirname, "..", "assets", "sfx", "whoosh.wav");
const GAP = 1.1;        // Pause zwischen zwei Wörtern ab dieser Länge wird gekürzt …
const KEEP = 0.28;      // … auf so viel Stille vor und nach dem Schnitt
const MIN_SEG = 0.9;    // kein Segment kürzer als das
const PUNCH = 1.1;      // Zoomfaktor im Wechsel (Jump-Cut-Optik)
const SFX_GAP = 3;      // höchstens alle 3 s ein Luftzug
const SFX_VOL = 0.22;   // leise
const INTRO = 0.45;     // Punch-in am Anfang (Sekunden)
const DRIFT = 0.05;     // langsamer Zoom über den ganzen Clip (Ken-Burns), 5 %

/**
 * Plant die Schnitte eines Clips. words: Wörter relativ zum Clip-Start; quiet(t0,t1) → ist die Stelle still?
 * Liefert die behaltenen Bereiche (in Sekunden des ungeschnittenen Clips).
 */
function planCuts(words, duration, quiet) {
  const keep = [];
  let pos = 0;
  const sorted = [...words].sort((a, b) => a.s - b.s);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1].e, b = sorted[i].s;
    if (b - a < GAP) continue;
    const cutFrom = a + KEEP, cutTo = b - KEEP;
    if (cutTo - cutFrom < 0.4) continue;
    if (quiet && !quiet(cutFrom, cutTo)) continue;     // Lachen/Reaktion ohne Wörter bleibt drin
    if (cutFrom - pos < MIN_SEG) continue;
    keep.push([pos, cutFrom]); pos = cutTo;
  }
  keep.push([pos, duration]);
  if (keep.length > 1 && keep[keep.length - 1][1] - keep[keep.length - 1][0] < MIN_SEG) {
    const last = keep.pop(); keep[keep.length - 1][1] = last[1];   // zu kurzen Rest ans vorige Segment hängen
  }
  return keep;
}

// Wort-Zeiten auf die geschnittene Zeitachse umrechnen (Wörter in entfernten Bereichen fallen weg)
function remapWords(words, keep) {
  const out = [];
  let off = 0;
  for (const [a, b] of keep) {
    for (const w of words) {
      if (w.e <= a || w.s >= b) continue;
      out.push({ ...w, s: Math.max(a, w.s) - a + off, e: Math.min(b, w.e) - a + off });
    }
    off += b - a;
  }
  return out;
}

const outDuration = (keep) => keep.reduce((n, [a, b]) => n + (b - a), 0);
const cutTimes = (keep) => { const t = []; let off = 0; for (let i = 0; i < keep.length - 1; i++) { off += keep[i][1] - keep[i][0]; t.push(off); } return t; };

const fpath = (p) => p.replace(/\\/g, "/").replace(/([:,'\[\]])/g, "\\$1");

/**
 * Filtergraph für den Feinschnitt. Eingänge: 0 = Zwischenschnitt (1080×1920), 1 = Titelbild (optional), 2 = Luftzug (optional)
 */
function polishFilter({ keep, hasAudio, ass, fontsDir, overlayInput, sfxInput, sfx }) {
  const D = outDuration(keep);
  const parts = [];
  const vlabels = [], alabels = [];
  keep.forEach(([a, b], i) => {
    const punch = i % 2 === 1 ? `,crop=w=iw/${PUNCH}:h=ih/${PUNCH},scale=1080:1920:flags=lanczos` : "";
    parts.push(`[0:v]trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS${punch},setsar=1[v${i}]`);
    vlabels.push(`[v${i}]`);
    if (hasAudio) { parts.push(`[0:a]atrim=start=${a.toFixed(3)}:end=${b.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`); alabels.push(`[a${i}]`); }
  });
  if (keep.length > 1) {
    parts.push(`${vlabels.join("")}concat=n=${keep.length}:v=1:a=0[cv]`);
    if (hasAudio) parts.push(`${alabels.join("")}concat=n=${keep.length}:v=0:a=1[ca]`);
  } else {
    parts.push(`[v0]null[cv]`); if (hasAudio) parts.push(`[a0]anull[ca]`);
  }
  // Bewegung: Punch-in am Anfang, danach langsamer Zoom über den Clip – vor Untertiteln/Titel, damit Text ruhig bleibt
  parts.push(`[cv]zoompan=z='if(lt(it,${INTRO}),1.12-0.12*it/${INTRO},1+${DRIFT}*it/${Math.max(1, D).toFixed(2)})':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=30[mv]`);
  // Bild: Untertitel, Titel, kurze Blende rein (4 Frames) und raus (0.3 s)
  let v = `[mv]${ass ? `subtitles=filename=${fpath(ass)}:fontsdir=${fpath(fontsDir)},` : ""}fade=t=in:st=0:d=0.13,fade=t=out:st=${Math.max(0, D - 0.3).toFixed(2)}:d=0.3`;
  if (overlayInput != null) { parts.push(v + `[sv]`); v = `[sv][${overlayInput}:v]overlay=0:0:format=auto`; }
  parts.push(v + `,format=yuv420p[v]`);
  if (!hasAudio) return { graph: parts.join(";"), duration: D };
  // Ton: weiche Blenden, Luftzug an den Schnitten (dezent, nicht öfter als alle 3 s), dann TikTok-Lautstärke
  let a = `[ca]afade=t=in:st=0:d=0.12,afade=t=out:st=${Math.max(0, D - 0.35).toFixed(2)}:d=0.35[a0]`;
  parts.push(a);
  let mixIn = "[a0]";
  if (sfx && sfxInput != null) {
    const times = [0.02]; let last = 0.02;   // Luftzug zum Einstieg, dann an den Schnitten
    for (const t of cutTimes(keep)) if (t - last >= SFX_GAP) { times.push(t); last = t; }
    if (times.length) {
      parts.push(`[${sfxInput}:a]volume=${SFX_VOL},asplit=${times.length}${times.map((_, i) => `[s${i}]`).join("")}`);
      times.forEach((t, i) => parts.push(`[s${i}]adelay=${Math.max(0, Math.round((t - 0.12) * 1000))}:all=1[d${i}]`));
      parts.push(`[a0]${times.map((_, i) => `[d${i}]`).join("")}amix=inputs=${times.length + 1}:normalize=0:dropout_transition=0[am]`);
      mixIn = "[am]";
    }
  }
  parts.push(`${mixIn}loudnorm=I=-14:TP=-1.5:LRA=11[a]`);
  return { graph: parts.join(";"), duration: D };
}

module.exports = { planCuts, remapWords, outDuration, cutTimes, polishFilter, SFX };

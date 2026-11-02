// Erzeugt eine ASS-Untertiteldatei im TikTok-Stil für einen Clip:
// große fette Schrift, 1–3 Wörter gleichzeitig, das gerade gesprochene Wort leuchtet gelb.
// Oben steht der Hook in einer weißen Box.
const W = 1080, H = 1920;

const clean = (s) => String(s).replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();
const t = (sec) => {
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
};

// Wörter in kurze Häppchen teilen: max. 3 Wörter / ~18 Zeichen, Pause oder Satzende beendet ein Häppchen
function chunk(words) {
  const out = [];
  let cur = [];
  const flush = () => { if (cur.length) out.push(cur); cur = []; };
  words.forEach((w, i) => {
    const prev = words[i - 1];
    const len = cur.reduce((a, x) => a + x.w.length + 1, 0) + w.w.length;
    if (cur.length && (cur.length >= 3 || len > 18 || (prev && w.s - prev.e > 0.6))) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.w)) flush();
  });
  flush();
  return out;
}

function buildAss({ words = [], hook = "", duration, highlight = "&H0000E5FF" }) {
  const lines = [];
  const groups = chunk(words.map((w) => ({ ...w, w: clean(w.w).toUpperCase() })).filter((w) => w.w));
  groups.forEach((g, gi) => {
    const next = groups[gi + 1];
    const groupEnd = Math.min(g[g.length - 1].e + 0.4, next ? next[0].s : duration, duration);
    g.forEach((w, wi) => {
      const s = wi === 0 ? w.s : Math.max(w.s, g[wi - 1].e - 0.02);
      const e = wi + 1 < g.length ? g[wi + 1].s : groupEnd;
      if (e - s < 0.04) return;
      const text = g.map((x, xi) => (xi === wi ? `{\\c${highlight}&\\fscx112\\fscy112}${x.w}{\\r}` : x.w)).join(" ");
      lines.push(`Dialogue: 0,${t(s)},${t(e)},Sub,,0,0,0,,{\\pos(${W / 2},${Math.round(H * 0.68)})}${text}`);
    });
  });
  // Farbige Emojis kann der Untertitel-Renderer nicht darstellen – im Hook weglassen (in der Caption bleiben sie)
  const h = clean(String(hook).replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, ""));
  if (h) lines.push(`Dialogue: 1,${t(0)},${t(duration)},Hook,,0,0,0,,{\\fad(250,0)}${h}`);

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Poppins,96,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,8,5,5,70,70,0,1
Style: Hook,Poppins,62,&H00000000,&H00000000,&H00FFFFFF,&H00FFFFFF,-1,0,0,0,100,100,0,0,3,16,0,8,110,110,250,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join("\n")}
`;
}

module.exports = { buildAss, chunk };

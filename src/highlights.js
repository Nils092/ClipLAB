// Findet die lustigsten Stellen in einem Video.
// Mit ANTHROPIC_API_KEY liest Claude das Transkript und wählt Momente mit Aufbau und Pointe aus
// und schreibt Hook, Caption und Hashtags. Ohne Schlüssel (oder bei Fehlern) entscheiden einfache Regeln:
// Lachen im Text ("haha"), laute Stellen und viele Ausrufe.
const config = require("./config");

const LAUGH = /(\bha(ha)+\w*|\bhihi\w*|\bhehe\w*|\blol\b|\blach\w*|gelächter|\blaugh\w*|😂|🤣)/gi;

function loudStats(loud) {
  const xs = loud.db.filter((x) => x > -60).slice().sort((a, b) => a - b);
  if (!xs.length) return { med: -30, sd: 6 };
  const med = xs[Math.floor(xs.length / 2)];
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length) || 6;
  return { med, sd };
}
// Wie laut ein Abschnitt im Vergleich zum Rest ist (Mittel der lautesten 25 %, in Standardabweichungen)
function loudZ(loud, st, t0, t1) {
  const a = Math.max(0, Math.floor(t0 / loud.step)), b = Math.min(loud.db.length, Math.ceil(t1 / loud.step));
  const xs = loud.db.slice(a, b).sort((x, y) => y - x);
  if (!xs.length) return 0;
  const top = xs.slice(0, Math.max(1, Math.ceil(xs.length / 4)));
  return (top.reduce((s, x) => s + x, 0) / top.length - st.med) / st.sd;
}

const fmtT = (t) => (Math.round(t * 10) / 10).toFixed(1);
const allWords = (tr) => tr.segments.flatMap((s) => s.words || []);

// Clip-Grenzen an Wörter anlegen; nach der Pointe noch etwas Lachen/Reaktion mitnehmen
function snap(start, end, words, duration, loud, st) {
  const first = words.find((w) => w.e > start + 0.05);
  if (first && first.s < end) start = Math.max(0, first.s - 0.15);
  const inside = words.filter((w) => w.s < end - 0.05 && w.e > start);
  if (inside.length) end = inside[inside.length - 1].e + 0.35;
  if (loud && st) {
    let ext = 0;
    while (ext < 2) {
      const i = Math.floor((end + ext) / loud.step);
      if (i >= loud.db.length || loud.db[i] < st.med + st.sd * 0.8) break;
      ext += loud.step;
    }
    end += ext;
  }
  return { start: Math.round(start * 100) / 100, end: Math.round(Math.min(duration, end) * 100) / 100 };
}

function removeOverlaps(clips) {
  const out = [];
  for (const c of clips) if (!out.some((o) => c.start < o.end && o.start < c.end)) out.push(c);
  return out;
}

// ---------- Regeln (ohne KI) ----------
const HOOKS = {
  de: ["Warte aufs Ende 😂", "Damit hat keiner gerechnet", "Ich kann nicht mehr 😂", "Diese Reaktion 😂", "Bester Moment der Folge", "Das ist eskaliert 😂"],
  en: ["Wait for the end 😂", "Nobody expected that", "I can't breathe 😂", "That reaction 😂", "Best moment of the episode", "This escalated 😂"],
};
const TAGS = { de: ["lustig", "comedy", "fyp", "viral", "podcast"], en: ["funny", "comedy", "fyp", "viral", "podcast"] };

function byRules(tr, loud, duration, opts) {
  const lang = tr.language === "de" ? "de" : tr.language ? "en" : "de";
  const st = loudStats(loud);
  const segs = tr.segments;
  const target = (opts.minLen + opts.maxLen) / 2;
  const cands = [];
  if (segs.length) {
    for (let i = 0; i < segs.length; i++) {
      let j = i;
      while (j + 1 < segs.length && segs[j + 1].e - segs[i].s <= opts.maxLen && segs[j].e - segs[i].s < target) j++;
      const s = segs[i].s, e = segs[j].e, len = e - s;
      if (len < opts.minLen * 0.7) continue;
      const text = segs.slice(i, j + 1).map((x) => x.text).join(" ");
      const laughs = (text.match(LAUGH) || []).length;
      const shouts = (text.match(/[!?]/g) || []).length;
      // Pointe am Ende zählt mehr: Lautstärke im letzten Drittel extra gewichten
      const score = laughs * 3 + Math.max(0, loudZ(loud, st, s, e)) * 1.5 + Math.max(0, loudZ(loud, st, e - len / 3, e)) + Math.min(3, shouts / Math.max(1, len / 10)) * 0.5;
      cands.push({ start: s, end: e, score, text });
    }
  } else {
    const win = target;
    for (let t = 0; t + win <= duration; t += 2) cands.push({ start: t, end: t + win, score: loudZ(loud, st, t, t + win), text: "" });
  }
  cands.sort((a, b) => b.score - a.score);
  const words = allWords(tr);
  const picked = removeOverlaps(cands).slice(0, opts.count);
  const max = Math.max(...picked.map((c) => c.score), 1);
  return picked.map((c, k) => {
    // Satz mit Lachen oder Ausruf bevorzugen, sonst den ersten
    const sentences = (c.text.match(/[^.!?]+[.!?]*/g) || []).map((x) => x.trim()).filter(Boolean);
    const first = sentences.find((x) => { LAUGH.lastIndex = 0; return LAUGH.test(x); }) || sentences.find((x) => /!/.test(x)) || sentences[0] || "";
    return {
      ...snap(c.start, c.end, words, duration, loud, st),
      hook: HOOKS[lang][k % HOOKS[lang].length],
      caption: first ? (first.length > 120 ? first.slice(0, 117) + "…" : first) + " 😂" : HOOKS[lang][k % HOOKS[lang].length],
      hashtags: TAGS[lang].slice(0, 4),
      score: Math.max(1, Math.round((c.score / max) * 10)),
      reason: c.text ? "Laute Reaktion bzw. Lachen erkannt" : "Lauteste Stelle im Video",
    };
  });
}

// ---------- Claude ----------
function transcriptText(tr, loud, st, budget = 120_000) {
  let lines = tr.segments.map((s) => {
    const mark = (s.text.match(LAUGH) || []).length || loudZ(loud, st, s.s, s.e) > 1.5 ? " 🔊" : "";
    return `[${fmtT(s.s)}–${fmtT(s.e)}]${mark} ${s.text}`;
  });
  let text = lines.join("\n");
  if (text.length > budget) {
    const per = Math.max(60, Math.floor(budget / lines.length) - 20);
    lines = lines.map((l) => (l.length > per ? l.slice(0, per) + "…" : l));
    text = lines.join("\n").slice(0, budget);
  }
  return text;
}

async function askClaude(prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": config.claude.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: config.claude.model, max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(180_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Claude antwortet mit ${r.status}`);
  const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("Claude hat kein JSON geliefert");
  return JSON.parse(text.slice(a, b + 1));
}

async function byClaude(tr, loud, duration, opts) {
  const st = loudStats(loud);
  const prompt = `Du bist ein erfahrener Cutter für TikTok und Instagram Reels und hast ein sehr gutes Gespür für Humor.
Unten steht das Transkript eines Videos (Länge ${fmtT(duration)} s) mit Zeitstempeln in Sekunden. Zeilen mit 🔊 sind besonders laut – oft Lachen, Rufen oder starke Reaktionen.

Finde die ${opts.count} lustigsten Momente, die als eigenständiger Clip funktionieren: kurzer Aufbau, klare Pointe oder Reaktion am Ende, ohne dass man den Rest des Videos kennen muss.
Regeln:
- Jeder Clip ist ${opts.minLen} bis ${opts.maxLen} Sekunden lang. Clips dürfen sich nicht überschneiden.
- Start an einem Satzanfang (Zeitstempel einer Zeile), Ende direkt nach der Pointe bzw. dem Lachen.
- Gibt es weniger wirklich lustige Momente, nimm die unterhaltsamsten. Sortiere vom lustigsten zum schwächsten.
Für jeden Clip:
- "start", "end": Sekunden als Zahl
- "hook": Titel, der groß im Video steht. Beschreibt konkret und neugierig machend, wer was macht – mit Namen, wenn sie im Video fallen – und endet mit 2 bis 3 passenden Emojis. 6 bis 12 Wörter, Sprache des Videos. Beispiele für den Stil: "Willy zieht Olise und macht Tim nach 😂😱‼️", "Max sieht zum ersten Mal sein Zimmer in der Minecraft-Villa 😭🏠👀"
- "caption": Post-Text: der Titel, optional ein kurzer Zusatz, höchstens 150 Zeichen
- "hashtags": 4 bis 6 Hashtags ohne #-Zeichen: Namen der Personen, Thema/Spiel, dazu "viral" und "fyp"
- "score": 1 bis 10, wie lustig
- "reason": ein kurzer Satz, warum es lustig ist
Antworte ausschließlich mit JSON in dieser Form: {"clips":[{"start":0,"end":0,"hook":"","caption":"","hashtags":[],"score":0,"reason":""}]}

Transkript:
${transcriptText(tr, loud, st)}`;
  const out = await askClaude(prompt);
  const words = allWords(tr);
  const clips = (Array.isArray(out.clips) ? out.clips : [])
    .map((c) => {
      let s = Number(c.start), e = Number(c.end);
      if (!isFinite(s) || !isFinite(e) || e <= s) return null;
      s = Math.max(0, s); e = Math.min(duration, e);
      if (e - s > opts.maxLen * 1.25) e = s + opts.maxLen;
      if (e - s < 4) return null;
      return {
        ...snap(s, e, words, duration, loud, st),
        hook: String(c.hook || "").slice(0, 120),
        caption: String(c.caption || "").slice(0, 300),
        hashtags: (Array.isArray(c.hashtags) ? c.hashtags : String(c.hashtags || "").split(/[,\s]+/)).map((h) => String(h).replace(/^#/, "").trim()).filter(Boolean).slice(0, 6),
        score: Math.max(1, Math.min(10, Math.round(Number(c.score) || 5))),
        reason: String(c.reason || "").slice(0, 200),
      };
    })
    .filter(Boolean);
  const res = removeOverlaps(clips).slice(0, opts.count);
  if (!res.length) throw new Error("Claude hat keine passenden Clips gefunden");
  return res;
}

async function findHighlights(tr, loud, duration, opts) {
  if (config.claude.apiKey && tr.segments.length) {
    try { return { clips: await byClaude(tr, loud, duration, opts), method: "claude" }; }
    catch (e) { return { clips: byRules(tr, loud, duration, opts), method: "regeln", note: `Claude nicht erreichbar (${e.message}), einfache Regeln verwendet` }; }
  }
  return { clips: byRules(tr, loud, duration, opts), method: "regeln", note: config.claude.apiKey ? null : "Ohne Claude-Schlüssel: Auswahl nach Lachen und Lautstärke" };
}

module.exports = { findHighlights, byRules, snap, LAUGH };

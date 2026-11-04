// Findet die besten Stellen in einem Video – je nach Ziel: lustig, viral, krasse Reaktionen, Tipps oder emotional.
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

// ---------- Wonach gesucht wird ----------
// w: Gewichte für die Regeln (laugh = Lachen, loud = Lautstärke, end = laute Pointe am Ende, shout = !/?, kw = Stichwörter)
const GOALS = {
  funny: { emoji: ["😂", "💀"], label: "Lustig", score: "Witz-Score", what: "die lustigsten Momente: kurzer Aufbau, klare Pointe oder Reaktion am Ende", end: "direkt nach der Pointe bzw. dem Lachen", how: "wie lustig", tags: { de: ["lustig", "comedy"], en: ["funny", "comedy"] }, w: { laugh: 3, loud: 1.5, end: 1, shout: 0.5 } },
  viral: { emoji: ["🔥", "👀"], label: "Viral", score: "Viral-Score", what: "die Momente mit dem größten Viral-Potenzial: starker Einstieg in den ersten Sekunden, überraschende oder kontroverse Aussagen, starke Emotionen, Sätze, die man teilen oder kommentieren will", end: "direkt nach dem stärksten Moment", how: "wie wahrscheinlich der Clip viral geht", tags: { de: ["viral", "foryou"], en: ["viral", "foryou"] }, w: { laugh: 1.5, loud: 1.5, end: 1, shout: 1.5, start: 1 } },
  reaction: { emoji: ["😱", "🤯"], label: "Krasse Reaktionen", score: "Reaktions-Score", what: "die stärksten Reaktionen: Schreien, Ausrasten, Schock, Jubel, Fassungslosigkeit", end: "direkt nach der Reaktion", how: "wie stark die Reaktion ist", tags: { de: ["reaction", "krass"], en: ["reaction", "insane"] }, w: { laugh: 1, loud: 3, end: 1.5, shout: 1 } },
  tips: { emoji: ["💡", "✅"], label: "Tipps & Wissen", score: "Wert-Score", what: "die wertvollsten Aussagen: konkrete Tipps, Erkenntnisse, Zahlen oder Anleitungen, die für sich allein verständlich sind", end: "wenn der Gedanke abgeschlossen ist", how: "wie nützlich der Inhalt ist", tags: { de: ["tipps", "wissen"], en: ["tips", "learn"] }, w: { laugh: 0.3, loud: 0.3, end: 0, shout: 0.3, kw: 2 }, kw: /(tipp|trick|wichtig|fehler|musst|solltest|so geht|geheimnis|regel|schritt|\d+ ?(%|prozent|euro|€))/gi },
  emotional: { emoji: ["🥹", "❤️"], label: "Emotional", score: "Emotions-Score", what: "die emotionalsten Momente: berührend, ehrlich, traurig oder Gänsehaut", end: "wenn der Moment ausklingt", how: "wie emotional der Moment ist", tags: { de: ["emotional", "gänsehaut"], en: ["emotional", "feelings"] }, w: { laugh: 0.3, loud: 0.8, end: 0.5, shout: 0.3, kw: 2 }, kw: /(wein|tränen|traurig|ehrlich|liebe|danke|vermiss|stolz|angst|familie|gänsehaut)/gi },
};
const goalOf = (opts) => GOALS[opts && opts.goal] || GOALS.funny;

// ---------- Regeln (ohne KI) ----------
const HOOKS = {
  de: ["Warte aufs Ende 😂", "Damit hat keiner gerechnet", "Ich kann nicht mehr 😂", "Diese Reaktion 😂", "Bester Moment der Folge", "Das ist eskaliert 😂"],
  en: ["Wait for the end 😂", "Nobody expected that", "I can't breathe 😂", "That reaction 😂", "Best moment of the episode", "This escalated 😂"],
};
const TAGS = { de: ["lustig", "comedy", "fyp", "viral", "podcast"], en: ["funny", "comedy", "fyp", "viral", "podcast"] };

// Titel, Caption und Hashtags aus dem, was im Clip wirklich gesagt wird (wenn keine KI verfügbar ist)
const STOP = new Set(("der die das den dem des ein eine einen einem einer und oder aber wenn weil dass ich du er sie es wir ihr mein dein sein unser " +
  "ist sind war waren bin bist hat haben hatte wird werden kann können mal so ja nein nicht noch schon auch nur ganz sehr hier da dann jetzt also " +
  "mit von zu zum zur auf aus bei für im in an am um über unter vor nach wie was wer wo warum alles alle mehr man sich mich dich uns euch " +
  "neuer neue neues roter rote roten krasser krasse bester beste großer kleiner erster letzter geiler alter digga mein meine meinen video folge teil live stream vod the and you for with this that what are was is it to of in on my your").split(" "));
const FILLER = /^(und|also|ja|ähm|äh|ehm|hm|so|naja|okay|ok|aber|weil|oder|na)\b[,\s]*/i;
const EMOJI = [
  [/\b(ha(ha)+|lach|lol|witzig|lustig)/i, "😂"], [/(geld|euro|€|teuer|kostet|kaufen|gekauft|bezahlt)/i, "💸"],
  [/(auto|ferrari|porsche|lambo|mercedes|bmw|audi|gas|fahren|ps\b)/i, "🏎️"], [/(krass|alter|wtf|digga|wie bitte|schock|unfassbar)/i, "😱"],
  [/(spiel|game|fifa|fc ?\d|pack|gezogen|minecraft|fortnite|zocken)/i, "🎮"], [/(essen|lecker|hunger|pizza|burger|döner)/i, "🍔"],
  [/(liebe|freundin|freund|date|herz)/i, "❤️"], [/(feuer|heiß|brennt|geil|stark|bester)/i, "🔥"], [/(haus|villa|zimmer|wohnung|tour)/i, "🏠"],
  [/(weint|traurig|sorry|schade)/i, "😭"], [/(schau|guck|sieh|seht|sehen)/i, "👀"],
];
const FALLBACK_EMOJI = ["😂", "😳", "🔥", "👀", "😱", "💀"];

function sentencesOf(text) {
  // Nur an Satzzeichen mit folgendem Leerzeichen trennen (300.000 bleibt ganz)
  return text.split(/(?<=[.!?…])\s+/).map((x) => x.replace(FILLER, "").trim()).filter((x) => x.split(/\s+/).length >= 3);
}
function scoreSentence(s, goal) {
  const n = s.split(/\s+/).length;
  LAUGH.lastIndex = 0;
  const laugh = LAUGH.test(s);
  let kw = 0;
  if (goal && goal.kw) { goal.kw.lastIndex = 0; kw = (s.match(goal.kw) || []).length; }
  // Bei Tipps/Emotion zählen passende Stichwörter, Lachen eher nicht
  const calm = goal && goal.kw;
  return (/!/.test(s) ? (calm ? 0.5 : 2) : 0) + (/\?/.test(s) ? 1 : 0) + (laugh ? (calm ? -1 : 2) : 0) + kw * 3 + (/\d/.test(s) ? 0.5 : 0)
    + Math.min(2, (s.slice(1).match(/\s[A-ZÄÖÜ][a-zäöüß]{2,}/g) || []).length * 0.5) - (n > 14 ? 1.5 : 0) - (n < 4 ? 1 : 0);
}
function shorten(s, max = 12) {
  const w = s.replace(/\s+/g, " ").trim().split(" ");
  let t = w.join(" ");
  if (w.length > max) {
    // lieber an einem Komma kürzen als mitten im Gedanken
    const head = w.slice(0, max).join(" "), cut = head.lastIndexOf(",");
    t = cut > 0 && head.slice(0, cut).split(" ").length >= 5 ? head.slice(0, cut) : head;
  }
  t = t.replace(/[,;:–-]+$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function emojisFor(line, text, k, goal) {
  const out = [];
  // Erst passend zum Satz, dann ein Emoji fürs Ziel (lustig 😂, Tipps 💡 …), bei lustig/viral auch aus dem ganzen Clip
  const sources = goal && goal.kw ? [line] : [line, text];
  for (const src of sources) for (const [re, e] of EMOJI) if (out.length < 1 && re.test(src) && !out.includes(e)) out.push(e);
  const pool = goal && goal.emoji ? [...goal.emoji, ...FALLBACK_EMOJI] : FALLBACK_EMOJI;
  for (let i = 0; out.length < 2 && i < pool.length * 2; i++) { const e = pool[(i + (goal && goal.emoji ? 0 : k)) % pool.length]; if (!out.includes(e)) out.push(e); }
  return out.slice(0, 2).join("");
}
function tagsFor(text, context, lang) {
  const norm = (w) => w.toLowerCase().replace(/[^a-z0-9äöüß]/g, "");
  const tags = [];
  const add = (w) => { w = norm(w); if (w.length >= 3 && !STOP.has(w) && !tags.includes(w)) tags.push(w); };
  // 1. Häufige Hauptwörter/Namen aus dem Clip zuerst (unterscheidet die Clips)
  const freq0 = {};
  (text.match(/(?<=[a-zäöüß,]\s)[A-ZÄÖÜ][a-zäöüß]{2,}/g) || []).forEach((w) => { const n = norm(w); if (!STOP.has(n)) freq0[n] = (freq0[n] || 0) + 1; });
  Object.entries(freq0).sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([w]) => add(w));
  // 2. Wörter aus dem Videotitel (z. B. "Ferrari", "F8 Tributo" → ferrari, f8tributo)
  const title = String(context.title || "");
  const tw = /^(img|vid|mov|dsc|dji|gopro|screen|record|video)[\s_-]*\d*$/i.test(title.trim()) ? [] : title.split(/[^A-Za-zÄÖÜäöüß0-9]+/).filter((w) => w.length >= 3 && !/^(img|vid|mov|dsc|mp4|final|export)$/i.test(w));
  tw.forEach((w, i) => { if (/\d/.test(w) && /[a-z]/i.test(w) && tw[i + 1]) add(w + tw[i + 1]); else if (!(i > 0 && /\d/.test(tw[i - 1]) && /[a-z]/i.test(tw[i - 1]))) add(w); });
  if (context.platform) add(context.platform);
  const base = [...(context.goalTags || (lang === "de" ? ["lustig"] : ["funny"])), "viral", "fyp"];
  return [...tags.slice(0, 4), ...base].filter((v, i, a) => a.indexOf(v) === i).slice(0, 6);
}
function textsFor(picked, lang, context, goal) {
  const used = new Set();
  return picked.map((c, k) => {
    const cands = sentencesOf(c.text).sort((a, b) => scoreSentence(b, goal) - scoreSentence(a, goal));
    let line = cands.find((s) => !used.has(shorten(s).toLowerCase()));
    if (!line) return { hook: HOOKS[lang][k % HOOKS[lang].length], caption: HOOKS[lang][k % HOOKS[lang].length], hashtags: tagsFor(c.text, context, lang) };
    const t = shorten(line);
    used.add(t.toLowerCase());
    const em = emojisFor(line, c.text, k, goal);
    const hook = `${t.replace(/[.…]+$/, "")} ${em}`;
    const full = line.length > 140 ? line.slice(0, 137) + "…" : line;
    return { hook, caption: `${full.charAt(0).toUpperCase() + full.slice(1)} ${em}`, hashtags: tagsFor(c.text, context, lang) };
  });
}

function byRules(tr, loud, duration, opts, context = {}) {
  const goal = goalOf(opts);
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
      // Gewichtung je nach Ziel; Pointe am Ende bzw. starker Einstieg zählen extra
      const w = goal.w;
      const kws = goal.kw ? (text.match(goal.kw) || []).length : 0;
      const score = laughs * w.laugh + Math.max(0, loudZ(loud, st, s, e)) * w.loud + Math.max(0, loudZ(loud, st, e - len / 3, e)) * w.end
        + Math.min(3, shouts / Math.max(1, len / 10)) * w.shout + Math.min(4, kws) * (w.kw || 0) + (w.start ? Math.max(0, loudZ(loud, st, s, s + 4)) * w.start : 0);
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
  const texts = textsFor(picked, lang, { ...context, goalTags: goal.tags[lang] }, goal);
  return picked.map((c, k) => {
    return {
      ...snap(c.start, c.end, words, duration, loud, st),
      ...texts[k],
      score: Math.max(1, Math.round((c.score / max) * 10)),
      reason: !c.text ? "Lauteste Stelle im Video" : goal === GOALS.tips || goal === GOALS.emotional ? "Passende Stichwörter im Gesagten erkannt" : "Laute Reaktion bzw. Lachen erkannt",
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

async function byClaude(tr, loud, duration, opts, context = {}) {
  const goal = goalOf(opts);
  const st = loudStats(loud);
  const prompt = `Du bist ein erfahrener Cutter für TikTok und Instagram Reels und hast ein sehr gutes Gespür für Humor.
${context.title ? `Titel des Originalvideos: "${String(context.title).slice(0, 200)}"${context.creator ? ` von ${String(context.creator).slice(0, 80)}` : ""}${context.format ? `, Format „${String(context.format).slice(0, 80)}“` : ""}${context.episode ? `, Folge „${String(context.episode).slice(0, 80)}“` : ""}${context.platform ? ` (${context.platform})` : ""}\n` : ""}Unten steht das Transkript eines Videos (Länge ${fmtT(duration)} s) mit Zeitstempeln in Sekunden. Zeilen mit 🔊 sind besonders laut – oft Lachen, Rufen oder starke Reaktionen.

Finde ${opts.count} Clips mit ${goal.what}. Jeder Clip muss für sich allein funktionieren, ohne dass man den Rest des Videos kennt.
Regeln:
- Jeder Clip ist ${opts.minLen} bis ${opts.maxLen} Sekunden lang. Clips dürfen sich nicht überschneiden.
- Start an einem Satzanfang (Zeitstempel einer Zeile), Ende ${goal.end}.
- Gibt es weniger passende Momente, nimm die besten, die es gibt. Sortiere vom stärksten zum schwächsten.
Für jeden Clip:
- "start", "end": Sekunden als Zahl
- "hook": Titel, der groß im Video steht. Beschreibt konkret und neugierig machend, wer was macht – mit Namen, wenn sie im Video fallen – und endet mit 2 bis 3 passenden Emojis. 6 bis 12 Wörter, Sprache des Videos. Beispiele für den Stil: "Willy zieht Olise und macht Tim nach 😂😱‼️", "Max sieht zum ersten Mal sein Zimmer in der Minecraft-Villa 😭🏠👀"
- "caption": Post-Text: der Titel, optional ein kurzer Zusatz, der den Zusammenhang zum Originalvideo herstellt (worum es dort geht${context.creator ? `, wer ${String(context.creator).slice(0, 80)} ist` : ""}), höchstens 150 Zeichen. Den Verweis auf das Originalvideo hängt ClipLab selbst an.
- "hashtags": 4 bis 6 Hashtags ohne #-Zeichen: Namen der Personen, Thema/Spiel, dazu "viral" und "fyp"
- "score": 1 bis 10, ${goal.how}
- "reason": ein kurzer Satz, warum der Moment funktioniert
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

async function findHighlights(tr, loud, duration, opts, context = {}) {
  if (config.claude.apiKey && tr.segments.length) {
    try { return { clips: await byClaude(tr, loud, duration, opts, context), method: "claude" }; }
    catch (e) { return { clips: byRules(tr, loud, duration, opts, context), method: "regeln", note: `Claude nicht erreichbar (${e.message}), einfache Regeln verwendet` }; }
  }
  return { clips: byRules(tr, loud, duration, opts, context), method: "regeln", note: config.claude.apiKey ? null : "Ohne Claude-Schlüssel: Auswahl nach Lachen und Lautstärke" };
}

module.exports = { findHighlights, byRules, snap, LAUGH, GOALS };

// Quelle eines Videos automatisch bestimmen:
//  - aus den Link-Daten (Kanal, Handle, Titel) Format und Folge ableiten (Claude, sonst Regeln)
//  - Quellen-Gedächtnis pro Nutzer: einmal eingetragene Formate/Handles je Kanal wiederverwenden
const config = require("./config");
const { db, save, now } = require("./store");

const clean = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const key = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// ---------- Gedächtnis ----------
// user.sources = [{ creator, handle, format, hits, updatedAt }]
function remember(user, origin) {
  if (!user || !origin || !(origin.creator || origin.handle)) return;
  user.sources = user.sources || [];
  const k = key(origin.handle || origin.creator);
  let e = user.sources.find((x) => key(x.handle || x.creator) === k || (origin.creator && key(x.creator) === key(origin.creator)));
  if (!e) { e = { creator: "", handle: "", format: "", hits: 0 }; user.sources.push(e); }
  if (origin.creator && !e.creator) e.creator = clean(origin.creator, 80);   // erste Schreibweise behalten
  if (origin.handle) e.handle = clean(origin.handle, 60).replace(/^@+/, "");
  if (origin.format) e.format = clean(origin.format, 80);
  e.hits = (e.hits || 0) + 1; e.updatedAt = now();
  user.sources = user.sources.sort((a, b) => (b.hits || 0) - (a.hits || 0)).slice(0, 50);
  save();
}
function recall(user, { creator, handle }) {
  const list = (user && user.sources) || [];
  const kh = key(handle), kc = key(creator);
  return list.find((x) => (kh && key(x.handle) === kh) || (kc && key(x.creator) === kc)) || null;
}

// ---------- Format / Folge ableiten ----------
const SEP = /\s*(?:[|–—\-:•·]|\(|\[|#)\s*/;
function guessByRules({ title, creator }) {
  const t = clean(title, 200), c = clean(creator, 80);
  if (!t) return { format: "", episode: "" };
  // "30 Dishes Bangkok | Folge 12", "Reaktion auf X – Folge 3", "XY #12", "XY S2E4"
  const parts = t.split(SEP).map((x) => x.trim()).filter(Boolean);
  const epNum = (t.match(/\b(?:folge|episode|ep\.?|teil|tag|day|runde|#)\s*(\d{1,3})\b/i) || [])[1];
  // Format: Kanalname, wenn er im Titel vorkommt, sonst der erste Titelteil, wenn er kurz ist
  let format = "";
  const cw = c.replace(/\b(germany|deutschland|official|tv|official channel)\b/gi, "").trim();
  if (cw && new RegExp(cw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(t)) format = cw;
  else if (parts.length > 1 && parts[0].split(" ").length <= 4) format = parts[0];
  // Folge: Teil, der nicht das Format ist und keine reine Nummer – erster kurzer Rest
  let episode = "";
  const rest = parts.filter((p) => key(p) !== key(format) && !/^\d+$/.test(p));
  if (format) {
    const m = t.match(new RegExp(format.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[:\\-–—|]?\\s*([^|–—\\-:#(\\[]{2,40})", "i"));
    if (m) episode = m[1].trim().replace(/\b(folge|episode|ep\.?|teil)\s*\d+/i, "").trim();
  }
  // Ohne Format ergibt eine „Folge“ keinen Sinn (sonst würde der ganze Titel zum Hashtag)
  if (!format) episode = "";
  episode = episode.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F]/gu, "").replace(/^(in|im|aus|bei|auf|vs\.?|mit)\s+/i, "").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ");
  if (epNum && format && !/\d/.test(episode)) episode = (episode ? episode + " " : "") + "Folge " + epNum;
  return { format: format.slice(0, 80), episode: episode.slice(0, 80) };
}

async function guessByClaude({ title, creator, description }) {
  const prompt = `Ein Clipper schneidet aus diesem Video kurze Clips und braucht für die Caption, zu welchem Format (Serie/Reihe/Show) und welcher Folge es gehört.
Kanal: ${clean(creator, 80) || "unbekannt"}
Titel: ${clean(title, 200)}
${description ? "Beschreibung (Anfang): " + clean(description, 500) : ""}
Antworte nur mit JSON: {"format":"Name des Formats oder leer, wenn es kein wiederkehrendes Format ist","episode":"kurzer Name/Thema der Folge oder leer"}
Regeln: format ohne Kanal-Zusätze wie "Germany" (z. B. "30 Dishes", nicht "30 Dishes Germany"); episode höchstens 4 Wörter (z. B. "Bangkok", "Folge 12", "Thailand Tag 3"); keine Erklärungen.`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": config.claude.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: config.claude.model, max_tokens: 200, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json().catch(() => ({}));
  const text = (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (!r.ok || a < 0) throw new Error("keine Antwort");
  const o = JSON.parse(text.slice(a, b + 1));
  return { format: clean(o.format, 80), episode: clean(o.episode, 80) };
}

/**
 * Vollständige Quelle bestimmen. given = vom Nutzer eingetragen (hat Vorrang), meta = aus dem Link.
 * Reihenfolge für Format/Handle: Nutzer → Gedächtnis → Claude/Regeln aus dem Titel.
 */
async function resolve(user, given = {}, meta = {}) {
  const o = {
    creator: clean(given.creator || meta.creator, 80), handle: clean(given.handle || meta.handle, 60).replace(/^@+/, ""),
    format: clean(given.format, 80), episode: clean(given.episode, 80), title: clean(given.title || meta.title, 160), url: clean(given.url || meta.url, 500),
  };
  let known = recall(user, o);
  // Kein Kanal angegeben: passt eine bekannte Quelle zum Titel/Dateinamen?
  if (!known && !o.creator) {
    const hay = key(o.title || meta.hint || "");
    known = ((user && user.sources) || []).find((x) => hay && ((x.creator && hay.includes(key(x.creator))) || (x.format && key(x.format).length >= 4 && hay.includes(key(x.format))))) || null;
  }
  if (known) { if (!o.format || key(o.format) === key(known.creator)) o.format = known.format || o.format; if (!o.handle) o.handle = known.handle || ""; if (known.creator) o.creator = known.creator; }   // Schreibweise aus dem Gedächtnis
  let guessTitle = o.title || clean(meta.hint, 160);   // hint = z. B. Dateiname, wird nicht als Titel gespeichert
  // Kanalname aus dem Titel nehmen, damit er nicht als „Folge“ durchgeht ("30 Dishes Germany - Tokio" → "30 Dishes - Tokio")
  if (o.creator && o.format && key(o.creator) !== key(o.format)) guessTitle = guessTitle.replace(new RegExp(o.creator.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), o.format);
  if ((!o.format || !o.episode) && guessTitle) {
    let g = null;
    if (config.claude.apiKey) { try { g = await guessByClaude({ title: guessTitle, creator: o.creator, description: meta.description }); } catch {} }
    if (!g) g = guessByRules({ title: guessTitle, creator: o.creator });
    if (!o.format) o.format = g.format; if (!o.episode) o.episode = g.episode;
  }
  return o;
}

module.exports = { resolve, remember, recall, guessByRules };

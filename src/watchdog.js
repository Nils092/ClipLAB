// Aufpasser: prüft alle paar Minuten, ob ClipLab gesund läuft, und meldet sich bei den Admins,
// wenn ein Scan hängt, der Dienst abgestürzt ist, das Mitschreib-Kontingent erschöpft ist,
// der Speicherplatz knapp wird oder sich fehlgeschlagene Posts häufen.
const fs = require("fs");
const os = require("os");
const path = require("path");
const config = require("./config");
const { db, save, id, now } = require("./store");
const push = require("./push");
const mail = require("./mail");

const MARK = path.join(config.dataDir, "run.json");
const RUNNING = ["download", "transkription", "analyse", "rendern"];
const STUCK_MIN = 35;                 // so lange ohne jede Bewegung gilt ein Scan als hängend
const DISK_MIN_GB = 3, DISK_MIN_PCT = 8;
const HOUR = 3600_000;
const started = Date.now();
let boots = [];                       // Startzeiten der letzten 24 Stunden
let crashed = null;                   // { at } wenn der letzte Lauf nicht sauber beendet wurde

const alerts = () => (db.alerts = db.alerts || []);
const cool = new Map();               // Schlüssel → letzter Alarm (damit dieselbe Meldung nicht dauernd kommt)

// level: "hoch" (auch per E-Mail) | "mittel" (Mitteilung) | "info" (nur in der Liste)
function alert(key, level, title, text, { cooldownH = 6, userId = null } = {}) {
  const last = cool.get(key) || (alerts().find((a) => a.key === key) ? new Date(alerts().find((a) => a.key === key).t).getTime() : 0);
  if (Date.now() - last < cooldownH * HOUR) return false;
  cool.set(key, Date.now());
  const a = { id: id("al"), t: now(), key, level, title: String(title).slice(0, 120), text: String(text).slice(0, 400) };
  db.alerts = [a, ...alerts()].slice(0, 60);
  save();
  console.error(`[Aufpasser] ${level}: ${a.title} – ${a.text}`);
  if (level === "info") return true;
  const admins = db.users.filter((u) => u.role === "admin");
  const targets = new Set(admins.map((u) => u.id)); if (userId) targets.add(userId);
  for (const uid of targets) push.notify(uid, { title: "ClipLab: " + a.title, body: a.text.slice(0, 180), url: admins.some((u) => u.id === uid) ? "/admin" : "/streams" });
  if (level === "hoch" && mail.enabled()) {
    for (const u of admins) if (u.email) mail.send({ to: u.email, subject: `ClipLab-Aufpasser: ${a.title}`, text: `${a.text}\n\nZeit: ${new Date(a.t).toLocaleString("de-DE", { timeZone: "Europe/Berlin" })}\nÜbersicht: ${config.baseUrl}/admin\n\nDiese Mail kommt vom Aufpasser deiner ClipLab-Installation.` })
      .catch((e) => console.error("[Aufpasser] Mail fehlgeschlagen –", e.message));
  }
  return true;
}

// ---------- Start: wurde der letzte Lauf sauber beendet? ----------
function boot() {
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(MARK, "utf8")); } catch {}
  boots = ((prev && prev.boots) || []).filter((t) => Date.now() - t < 24 * HOUR);
  boots.push(Date.now());
  if (prev && prev.clean === false && prev.beat) crashed = { at: prev.beat, uptimeMin: Math.round((prev.beat - (prev.started || prev.beat)) / 60_000) };
  beat(false);
  const stop = () => { beat(true); process.exit(0); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
}
function beat(clean) {
  try { fs.writeFileSync(MARK, JSON.stringify({ started, beat: Date.now(), clean, boots })); } catch {}
}

async function disk() {
  try { const s = await fs.promises.statfs(config.dataDir); const free = s.bavail * s.bsize, total = s.blocks * s.bsize; return { freeGB: free / 1e9, totalGB: total / 1e9, pct: total ? (free / total) * 100 : 100 }; }
  catch { return null; }
}

// ---------- Ein Prüfdurchgang ----------
async function check() {
  beat(false);
  // 1. Absturz bzw. Absturz-Schleife
  if (crashed) {
    const recent = boots.filter((t) => Date.now() - t < HOUR).length;
    if (recent >= 3) alert("crashloop", "hoch", "ClipLab stürzt immer wieder ab", `${recent} Neustarts in der letzten Stunde. Meist reicht der Arbeitsspeicher nicht (${(os.totalmem() / 1e9).toFixed(1)} GB) oder ein Scan bringt den Dienst jedes Mal zu Fall. Sieh mit „journalctl -u cliplab -n 60 --no-pager“ nach.`, { cooldownH: 3 });
    else alert("crash:" + crashed.at, "mittel", "ClipLab wurde unerwartet neu gestartet", `Der Dienst lief ${crashed.uptimeMin} Min. und wurde nicht sauber beendet (Absturz oder Server-Neustart). Laufende Scans wurden fortgesetzt.`, { cooldownH: 1 });
    crashed = null;
  }
  // 2. Hängende Scans
  for (const p of db.projects) {
    if (!RUNNING.includes(p.status)) continue;
    const idle = (Date.now() - new Date(p.updatedAt).getTime()) / 60_000;
    const waiting = /Groq-Limit/.test(p.note || "");
    if (idle > STUCK_MIN && !waiting) {
      const owner = db.users.find((u) => u.id === p.userId);
      alert("stuck:" + p.id + ":" + p.status, "hoch", "Ein Scan hängt", `„${p.name}“ (${owner ? owner.name : "?"}) steht seit ${Math.round(idle)} Min. bei „${p.status}“. Solange er hängt, warten alle anderen Scans. Abbrechen: Scan öffnen und „Scan abbrechen“.`, { cooldownH: 2, userId: p.userId });
    }
    // 3. Mitschreib-Kontingent erschöpft
    if (waiting) alert("groq", "mittel", "Groq-Limit erreicht", `Das kostenlose Mitschreib-Kontingent ist aufgebraucht. „${p.name}“ wartet und macht von selbst weiter (${p.note}). Wenn das oft passiert: kürzere Fenster scannen oder bei Groq den Dev-Tarif freischalten.`, { cooldownH: 4 });
  }
  // 4. Warteschlange staut sich
  const waitingProjects = db.projects.filter((p) => p.status === "wartet");
  const oldest = waitingProjects.map((p) => new Date(p.createdAt).getTime()).sort()[0];
  if (waitingProjects.length >= 4 && oldest && Date.now() - oldest > 2 * HOUR) alert("queue", "mittel", "Scans stauen sich", `${waitingProjects.length} Scans warten, der älteste seit ${Math.round((Date.now() - oldest) / HOUR)} Stunden. Der Server schafft immer nur einen Scan gleichzeitig.`, { cooldownH: 6 });
  // 5. Speicherplatz
  const d = await disk();
  if (d && (d.freeGB < DISK_MIN_GB || d.pct < DISK_MIN_PCT)) alert("disk", "hoch", "Speicherplatz wird knapp", `Nur noch ${d.freeGB.toFixed(1)} GB frei (${Math.round(d.pct)} %). Ist die Platte voll, schlagen Scans und Uploads fehl. Alte Scans unter „Clips“ löschen schafft Platz.`, { cooldownH: 12 });
  // 6. Fehlgeschlagene Posts häufen sich
  const failed = db.posts.filter((p) => p.status === "fehler" && Date.now() - new Date(p.updatedAt || p.scheduledAt || 0).getTime() < 6 * HOUR);
  if (failed.length >= 3) alert("posts", "mittel", "Mehrere Posts fehlgeschlagen", `${failed.length} Posts sind in den letzten sechs Stunden fehlgeschlagen. Häufigster Grund: ${mostCommon(failed.map((p) => String(p.error || "unbekannt").slice(0, 90)))}. Oft muss ein Account neu verbunden werden.`, { cooldownH: 12 });
  // 7. Fehlgeschlagene Scans häufen sich
  const bad = db.projects.filter((p) => p.status === "fehler" && Date.now() - new Date(p.updatedAt).getTime() < 6 * HOUR);
  if (bad.length >= 3) alert("scans", "mittel", "Mehrere Scans fehlgeschlagen", `${bad.length} Scans sind in den letzten sechs Stunden fehlgeschlagen. Häufigster Grund: ${mostCommon(bad.map((p) => String(p.error || "unbekannt").slice(0, 90)))}.`, { cooldownH: 12 });
}
const mostCommon = (xs) => { const g = {}; xs.forEach((x) => (g[x] = (g[x] || 0) + 1)); return Object.entries(g).sort((a, b) => b[1] - a[1])[0][0]; };

async function status() {
  const d = await disk();
  const run = db.projects.find((p) => RUNNING.includes(p.status));
  return {
    uptimeMin: Math.round((Date.now() - started) / 60_000), boots24h: boots.length, restartsLastHour: Math.max(0, boots.filter((t) => Date.now() - t < HOUR).length - 1),
    disk: d ? { freeGB: Math.round(d.freeGB * 10) / 10, totalGB: Math.round(d.totalGB), pct: Math.round(d.pct) } : null,
    ramGB: Math.round((os.totalmem() / 1e9) * 10) / 10, cores: os.cpus().length,
    running: run ? { name: run.name, status: run.status, idleMin: Math.round((Date.now() - new Date(run.updatedAt).getTime()) / 60_000), note: run.note || null } : null,
    waiting: db.projects.filter((p) => p.status === "wartet").length,
    mail: mail.enabled(),
  };
}

function register(app, auth) {
  app.get("/api/admin/watch", auth.requireAdmin, async (req, res) => res.json({ status: await status(), alerts: alerts().slice(0, 30) }));
  app.delete("/api/admin/watch", auth.requireAdmin, (req, res) => { db.alerts = []; cool.clear(); save(); res.json({ ok: true }); });
}

function start() {
  boot();
  setInterval(() => check().catch((e) => console.error("[Aufpasser]", e)), 5 * 60_000);
  setInterval(() => beat(false), 60_000);
  setTimeout(() => check().catch((e) => console.error("[Aufpasser]", e)), 45_000);
}

module.exports = { register, start, check, status, alert, _boot: boot };

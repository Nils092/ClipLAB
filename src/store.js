// Kleine Datei-Datenbank (JSON) ohne native Abhängigkeiten.
// Reicht für einige Dutzend Clipper und tausende Posts. Für mehr: auf Postgres umziehen.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, "videos"), { recursive: true });
const DB_FILE = path.join(config.dataDir, "db.json");

const empty = { users: [], accounts: [], clips: [], posts: [] };
let db;
try {
  db = { ...empty, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  db = structuredClone(empty);
}

let timer = null;
function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 50);
}
function flush() {
  const tmp = DB_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
}
process.on("exit", () => { clearTimeout(timer); try { flush(); } catch {} });

const id = (p) => p + "_" + crypto.randomBytes(9).toString("base64url");
const now = () => new Date().toISOString();

// ---- Token-Verschlüsselung (AES-256-GCM) ----
const key = crypto.createHash("sha256").update("tokens:" + config.secret).digest();
function enc(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const out = Buffer.concat([c.update(String(text), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), out].map((b) => b.toString("base64url")).join(".");
}
function dec(blob) {
  if (!blob) return null;
  const [iv, tag, data] = blob.split(".").map((s) => Buffer.from(s, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

module.exports = { db, save, id, now, enc, dec, videoDir: path.join(config.dataDir, "videos") };

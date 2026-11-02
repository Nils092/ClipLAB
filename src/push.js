// Web-Push-Benachrichtigungen (RFC 8291 + VAPID RFC 8292) ohne Zusatzpakete.
// Die App (PWA) meldet sich an; ClipLab schickt eine Nachricht, wenn ein Clip online ist oder etwas schiefgeht.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");
const { db, save, id, now } = require("./store");

const b64u = (b) => Buffer.from(b).toString("base64url");
const unb64u = (s) => Buffer.from(String(s), "base64url");

// ---------- VAPID-Schlüssel (einmalig erzeugt, liegen im Datenordner) ----------
const KEY_FILE = path.join(config.dataDir, "vapid.json");
let vapid;
function keys() {
  if (vapid) return vapid;
  try { vapid = JSON.parse(fs.readFileSync(KEY_FILE, "utf8")); }
  catch {
    const ecdh = crypto.createECDH("prime256v1");
    ecdh.generateKeys();
    vapid = { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
    fs.writeFileSync(KEY_FILE, JSON.stringify(vapid), { mode: 0o600 });
  }
  return vapid;
}
function privateKeyObject() {
  const k = keys(), pub = unb64u(k.publicKey);
  return crypto.createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", d: k.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
}

function vapidHeader(endpoint) {
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:info@imakio.de" }));
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key: privateKeyObject(), dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys().publicKey}`;
}

// ---------- Verschlüsselung (aes128gcm) ----------
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
function encrypt(payload, sub, { asPrivate, salt } = {}) {
  const uaPublic = unb64u(sub.keys.p256dh), authSecret = unb64u(sub.keys.auth);
  const ecdh = crypto.createECDH("prime256v1");
  if (asPrivate) ecdh.setPrivateKey(asPrivate); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  salt = salt || crypto.randomBytes(16);
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const c = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ct = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, ct]);
}

async function sendTo(sub, data) {
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: { Authorization: vapidHeader(sub.endpoint), TTL: "86400", Urgency: "normal", "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream" },
    body: encrypt(JSON.stringify(data), sub),
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status === 404 || r.status === 410) return "weg";
  if (!r.ok) throw new Error(`Push ${r.status}: ${(await r.text().catch(() => "")).slice(0, 200)}`);
  return "ok";
}

// Nachricht an alle Geräte eines Nutzers; abgemeldete Geräte werden entfernt
async function notify(userId, { title, body, url = "/" }) {
  const subs = (db.pushSubs || []).filter((s) => s.userId === userId);
  for (const s of subs) {
    try {
      if ((await sendTo(s, { title, body, url })) === "weg") { db.pushSubs.splice(db.pushSubs.indexOf(s), 1); save(); }
    } catch (e) { console.error("Push", e.message); }
  }
}
const notifySafe = (userId, msg) => { notify(userId, msg).catch((e) => console.error("Push", e.message)); };

function register(app, auth) {
  db.pushSubs = db.pushSubs || [];
  app.get("/api/push/key", (req, res) => res.json({ publicKey: keys().publicKey }));
  app.post("/api/push/subscribe", auth.requireUser, (req, res) => {
    const s = req.body.subscription || {};
    if (!/^https:\/\//.test(s.endpoint || "") || !s.keys?.p256dh || !s.keys?.auth) return res.status(400).json({ error: "Ungültige Anmeldung" });
    const old = db.pushSubs.find((x) => x.endpoint === s.endpoint);
    if (old) Object.assign(old, { userId: req.user.id, keys: s.keys });
    else db.pushSubs.push({ id: id("psh"), userId: req.user.id, endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, createdAt: now() });
    save();
    res.json({ ok: true, devices: db.pushSubs.filter((x) => x.userId === req.user.id).length });
  });
  app.post("/api/push/unsubscribe", auth.requireUser, (req, res) => {
    db.pushSubs = db.pushSubs.filter((x) => !(x.userId === req.user.id && x.endpoint === req.body.endpoint));
    save();
    res.json({ ok: true });
  });
  app.post("/api/push/test", auth.requireUser, async (req, res) => {
    await notify(req.user.id, { title: "ClipLab", body: "Push-Nachrichten funktionieren 🎉", url: "/" });
    res.json({ ok: true });
  });
}

module.exports = { register, notify: notifySafe, encrypt, keys };

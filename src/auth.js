const crypto = require("crypto");
const config = require("./config");
const { db, save, id, now } = require("./store");

const COOKIE = "cl_session";
const MAX_AGE = 30 * 24 * 3600 * 1000;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return salt.toString("hex") + ":" + hash.toString("hex");
}
function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(pw, Buffer.from(salt, "hex"), 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}
const sign = (v) => crypto.createHmac("sha256", config.secret).update(v).digest("base64url");

function setSession(res, userId) {
  const exp = Date.now() + MAX_AGE;
  const v = `${userId}.${exp}`;
  res.cookie(COOKIE, `${v}.${sign(v)}`, {
    httpOnly: true, sameSite: "lax", secure: config.baseUrl.startsWith("https://"), maxAge: MAX_AGE, path: "/",
  });
}
function clearSession(res) { res.clearCookie(COOKIE, { path: "/" }); }

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function userFromRequest(req) {
  const h = req.headers.authorization || "";
  if (h.startsWith("Bearer ")) {
    const k = h.slice(7).trim();
    const kh = crypto.createHash("sha256").update(k).digest("hex");
    return db.users.find((u) => u.apiKeyHash === kh && !u.disabled) || null;
  }
  const c = parseCookies(req)[COOKIE];
  if (!c) return null;
  const parts = c.split(".");
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  const expected = sign(`${uid}.${exp}`);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  return db.users.find((u) => u.id === uid && !u.disabled && u.verified !== false) || null;
}

function requireUser(req, res, next) {
  const u = userFromRequest(req);
  if (!u) return res.status(401).json({ error: "Nicht angemeldet" });
  req.user = u;
  return next();
}
function requireAdmin(req, res, next) {
  return requireUser(req, res, () => (req.user.role === "admin" ? next() : res.status(403).json({ error: "Nur für Admins" })));
}

function createUser({ email, name, password, role = "clipper" }) {
  email = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Bitte eine gültige E-Mail-Adresse angeben");
  if (!password || password.length < 10) throw new Error("Das Passwort muss mindestens 10 Zeichen haben");
  if (db.users.some((u) => u.email === email)) throw new Error("Diese E-Mail ist bereits registriert");
  const user = {
    id: id("usr"), email, name: String(name || email.split("@")[0]).slice(0, 60), role,
    passwordHash: hashPassword(password), apiKeyHash: null, clippingAppKey: null, createdAt: now(),
  };
  if (!db.users.length) user.role = "admin"; // erster Nutzer wird Admin
  db.users.push(user);
  save();
  return user;
}

function newApiKey(user) {
  const k = "cl_" + crypto.randomBytes(24).toString("base64url");
  user.apiKeyHash = crypto.createHash("sha256").update(k).digest("hex");
  save();
  return k;
}

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, hasApiKey: Boolean(u.apiKeyHash), hasClippingAppKey: Boolean(u.clippingAppKey) });

module.exports = { setSession, clearSession, requireUser, requireAdmin, createUser, checkPassword, newApiKey, publicUser, userFromRequest };

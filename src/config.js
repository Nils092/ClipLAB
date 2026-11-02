const path = require("path");
const fs = require("fs");

// .env einlesen (ohne Zusatzpaket). Bereits gesetzte Umgebungsvariablen haben Vorrang.
try {
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}

const env = (k, d = "") => (process.env[k] ?? d).toString().trim();

const config = {
  port: Number(env("PORT", "3000")),
  baseUrl: env("PUBLIC_BASE_URL", "http://localhost:3000").replace(/\/+$/, ""),
  secret: env("APP_SECRET"),
  inviteCode: env("INVITE_CODE"),
  dataDir: path.resolve(path.join(__dirname, ".."), env("DATA_DIR", "./data")),
  retentionDays: Number(env("RETENTION_DAYS", "14")),
  tiktok: {
    clientKey: env("TIKTOK_CLIENT_KEY"),
    clientSecret: env("TIKTOK_CLIENT_SECRET"),
    unaudited: env("TIKTOK_UNAUDITED", "true") !== "false",
  },
  instagram: {
    appId: env("INSTAGRAM_APP_ID"),
    appSecret: env("INSTAGRAM_APP_SECRET"),
    version: env("INSTAGRAM_API_VERSION", "v21.0"),
  },
  clippingAppUrl: env("CLIPPING_APP_URL").replace(/\/+$/, ""),
};

if (!config.secret || config.secret.length < 32) {
  console.error("APP_SECRET fehlt oder ist zu kurz (mind. 32 Zeichen). Siehe .env.example.");
  process.exit(1);
}

config.tiktok.enabled = Boolean(config.tiktok.clientKey && config.tiktok.clientSecret);
config.instagram.enabled = Boolean(config.instagram.appId && config.instagram.appSecret);

module.exports = config;

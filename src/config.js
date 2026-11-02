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
  // Auto-Clips: Transkription (Whisper auf dem eigenen Server) und Auswahl (Claude)
  whisper: {
    python: env("WHISPER_PYTHON", path.join(__dirname, "..", ".venv", "bin", "python")),
    model: env("WHISPER_MODEL", "small"),
    language: env("WHISPER_LANGUAGE", "auto"),
    threads: env("WHISPER_THREADS", ""),
  },
  groq: {
    apiKey: env("GROQ_API_KEY"),
    model: env("GROQ_MODEL", "whisper-large-v3-turbo"),
  },
  claude: {
    apiKey: env("ANTHROPIC_API_KEY"),
    model: env("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
  },
  maxProjectMB: Number(env("MAX_PROJECT_MB", "4000")),
  // E-Mail-Versand (Bestätigung neuer Clipper)
  smtp: {
    host: env("SMTP_HOST"), port: Number(env("SMTP_PORT", "465")), user: env("SMTP_USER"), pass: env("SMTP_PASS"),
    from: env("MAIL_FROM") || (env("SMTP_USER") ? `ClipLab <${env("SMTP_USER")}>` : ""),
  },
  // Registrierung: "mail" (offen, mit E-Mail-Bestätigung), "invite" (nur mit Code), "closed"; leer = automatisch
  registration: env("REGISTRATION"),
};

if (!config.secret || config.secret.length < 32) {
  console.error("APP_SECRET fehlt oder ist zu kurz (mind. 32 Zeichen). Siehe .env.example.");
  process.exit(1);
}

config.tiktok.enabled = Boolean(config.tiktok.clientKey && config.tiktok.clientSecret);
config.instagram.enabled = Boolean(config.instagram.appId && config.instagram.appSecret);

module.exports = config;

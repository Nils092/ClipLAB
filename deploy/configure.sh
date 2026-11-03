#!/usr/bin/env bash
# ClipLab einrichten bzw. reparieren – fragt alles Nötige ab, ohne Texteditor. Als root ausführen:
#   bash /opt/cliplab/deploy/configure.sh
# Vorhandene Einstellungen bleiben erhalten; Enter übernimmt jeweils den bisherigen Wert.
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/cliplab}"
ENV="$APP_DIR/.env"
TTY_IN="${CONFIGURE_IN:-/dev/tty}"; TTY="${CONFIGURE_OUT:-/dev/tty}"
SERVICE="${SERVICE:-$(basename "$APP_DIR")}"   # cliplab oder cliplab-test

say() { printf '\n\033[1;32m●\033[0m %s\n' "$*"; }
get() { grep -E "^$1=" "$ENV" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
# Wert setzen: alte Zeile(n) entfernen, neue anhängen (sicher für Sonderzeichen)
set_kv() {
  local tmp; tmp="$(mktemp)"
  grep -vE "^$1=" "$ENV" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > "$ENV"; rm -f "$tmp"
}
ask() {   # ask "Frage" VAR [geheim]
  local prompt="$1" var="$2" secret="${3:-}" cur ans
  cur="$(get "$var")"
  if [ -n "$secret" ]; then
    printf '%s %s: ' "$prompt" "$([ -n "$cur" ] && echo '[Enter = behalten]' || echo '[Enter = überspringen]')" > "$TTY"
    IFS= read -rs ans < "$TTY_IN" || true; printf '\n' > "$TTY"
  else
    printf '%s [%s]: ' "$prompt" "${cur:-leer}" > "$TTY"
    IFS= read -r ans < "$TTY_IN" || true
  fi
  [ -n "$ans" ] && set_kv "$var" "$ans"
  return 0
}

[ "$(id -u)" -eq 0 ] || { echo "Bitte als root ausführen."; exit 1; }
[ -d "$APP_DIR" ] || { echo "ClipLab ist nicht installiert ($APP_DIR fehlt)."; exit 1; }
touch "$ENV"

# 1. Grundeinstellungen reparieren, falls die Datei leer oder kaputt ist
if [ -z "$(get APP_SECRET)" ] || [ "$(get APP_SECRET | wc -c)" -lt 33 ]; then
  say "Einstellungsdatei war leer – Grundeinstellungen werden neu angelegt"
  DOMAIN="$(get PUBLIC_BASE_URL | sed -E 's#^https?://##')"; DOMAIN="${DOMAIN:-cliplab.imakio.de}"
  set_kv PORT 3000
  set_kv PUBLIC_BASE_URL "https://$DOMAIN"
  set_kv APP_SECRET "$(openssl rand -hex 32)"
  set_kv DATA_DIR /var/lib/cliplab
  set_kv RETENTION_DAYS 14
  set_kv TIKTOK_UNAUDITED true
  set_kv INSTAGRAM_API_VERSION v21.0
  set_kv WHISPER_MODEL small
  set_kv WHISPER_LANGUAGE auto
  set_kv MAX_PROJECT_MB 4000
  echo "  Hinweis: Alle müssen sich einmal neu anmelden (Konten und Passwörter bleiben erhalten)."
fi
[ -n "$(get INVITE_CODE)" ] || set_kv INVITE_CODE "$(openssl rand -hex 4)"

# 2. E-Mail (Bestätigung neuer Clipper) über IONOS
say "E-Mail-Versand (Bestätigungs-Mails kommen von info@imakio.de)"
[ -n "$(get SMTP_HOST)" ] || set_kv SMTP_HOST smtp.ionos.de
[ -n "$(get SMTP_PORT)" ] || set_kv SMTP_PORT 465
[ -n "$(get SMTP_USER)" ] || set_kv SMTP_USER info@imakio.de
[ -n "$(get MAIL_FROM)" ] || set_kv MAIL_FROM "ClipLab <info@imakio.de>"
echo "  Postfach: $(get SMTP_USER) über $(get SMTP_HOST):$(get SMTP_PORT)"
ask "  Passwort des Postfachs $(get SMTP_USER) (unsichtbar)" SMTP_PASS geheim

# 3. Accounts: Instagram- und TikTok-App (Schlüssel aus den Developer-Portalen)
say "Instagram (developers.facebook.com → App ClipLab)"
echo "  Weiterleitungs-URL bei Meta eintragen: $(get PUBLIC_BASE_URL)/auth/instagram/callback"
echo "  App-ID und App-Geheimcode: App-Einstellungen → Allgemeines"
ask "  Meta-App-ID" INSTAGRAM_APP_ID
ask "  Meta-App-Geheimcode (unsichtbar)" INSTAGRAM_APP_SECRET geheim
echo "  Konfigurations-ID: Anwendungsfall Instagram → API setup with Unified login → deine Konfiguration"
ask "  Konfigurations-ID (config_id)" INSTAGRAM_CONFIG_ID
say "TikTok (developers.tiktok.com → deine App)"
echo "  Redirect URI dort eintragen: $(get PUBLIC_BASE_URL)/auth/tiktok/callback"
ask "  TikTok Client Key" TIKTOK_CLIENT_KEY
ask "  TikTok Client Secret (unsichtbar)" TIKTOK_CLIENT_SECRET geheim

# 4. Optionale Schlüssel
say "Optionale Schlüssel"
ask "  Groq-Schlüssel für schnelle Untertitel (gsk_…, unsichtbar)" GROQ_API_KEY geheim
ask "  Claude-Schlüssel für lustige Stellen und Titel (sk-ant-…, unsichtbar)" ANTHROPIC_API_KEY geheim

chmod 600 "$ENV"
chown cliplab:cliplab "$ENV" 2>/dev/null || true

# 5. Neu starten und prüfen
say "ClipLab neu starten"
systemctl restart "$SERVICE"
sleep 3
if curl -fsS "http://localhost:$(get PORT)/api/session" >/dev/null 2>&1; then
  echo "  ClipLab läuft."
else
  echo "  ClipLab startet nicht – Logs: journalctl -u $SERVICE -n 30 --no-pager"; exit 1
fi
mark() { [ -n "$(get "$1")" ] && echo "eingetragen" || echo "leer"; }
cat <<EOF

  Adresse:          $(get PUBLIC_BASE_URL)
  E-Mail-Passwort:  $(mark SMTP_PASS)  → Registrierung $( [ -n "$(get SMTP_PASS)" ] && echo "offen mit Mail-Bestätigung" || echo "nur mit Einladungscode $(get INVITE_CODE)")
  Instagram:        $( [ -n "$(get INSTAGRAM_APP_ID)" ] && [ -n "$(get INSTAGRAM_APP_SECRET)" ] && echo "eingerichtet" || echo "leer")
  TikTok:           $( [ -n "$(get TIKTOK_CLIENT_KEY)" ] && [ -n "$(get TIKTOK_CLIENT_SECRET)" ] && echo "eingerichtet" || echo "leer")
  Groq:             $(mark GROQ_API_KEY)
  Claude:           $(mark ANTHROPIC_API_KEY)

  Später ändern: einfach dieses Programm nochmal starten.
EOF

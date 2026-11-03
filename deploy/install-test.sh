#!/usr/bin/env bash
# Richtet die Testversion von ClipLab neben der echten Version ein (als root, einmalig; erneut ausführen ist gefahrlos):
#   bash /opt/cliplab/deploy/install-test.sh test.cliplab.imakio.de
#
# Testversion: eigener Ordner, eigene Datenbank, eigener Port (3001), Code aus dem Git-Branch "test".
# Werkzeuge (Whisper, yt-dlp) und Modelle werden von der echten Version mitbenutzt.
set -euo pipefail

DOMAIN="${1:-test.cliplab.imakio.de}"; DOMAIN="${DOMAIN,,}"
PROD_DIR=/opt/cliplab
APP_DIR=/opt/cliplab-test
DATA_DIR=/var/lib/cliplab-test
PROD_DATA=/var/lib/cliplab
APP_USER=cliplab
PORT=3001
BRANCH=test
REPO_URL="$(git -C "$PROD_DIR" remote get-url origin 2>/dev/null || echo https://github.com/Nils092/ClipLAB.git)"

say() { printf '\n\033[1;33m●\033[0m %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Bitte als root ausführen."; exit 1; }
[ -d "$PROD_DIR" ] || { echo "Zuerst die echte Version installieren (deploy/install.sh)."; exit 1; }

IP="$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')"
RESOLVED="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
if [ "$RESOLVED" != "$IP" ]; then
  echo "Achtung: ${DOMAIN} zeigt noch nicht auf diesen Server (${RESOLVED:-keine Adresse} statt ${IP})."
  echo "Bei IONOS einen A-Record anlegen: Hostname \"${DOMAIN%%.imakio.de}\" → ${IP}. HTTPS startet automatisch, sobald er aktiv ist."
fi

say "Code aus dem Branch \"$BRANCH\" holen"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin
  git -C "$APP_DIR" checkout -q "$BRANCH" 2>/dev/null || git -C "$APP_DIR" checkout -q -b "$BRANCH" "origin/$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO_URL" "$APP_DIR" 2>/dev/null || { echo "Branch \"$BRANCH\" fehlt – nehme main"; git clone -q "$REPO_URL" "$APP_DIR"; git -C "$APP_DIR" checkout -q -b "$BRANCH"; }
fi

say "Einstellungen für die Testversion"
mkdir -p "$DATA_DIR"
# Modelle (Whisper, Gesichtserkennung) mit der echten Version teilen
[ -e "$DATA_DIR/models" ] || ln -s "$PROD_DATA/models" "$DATA_DIR/models"
ENV="$APP_DIR/.env"
if [ ! -f "$ENV" ]; then
  # Schlüssel (Mail, Groq, Claude, Instagram, TikTok) übernehmen, alles andere eigenständig
  grep -E '^(SMTP_|MAIL_FROM|GROQ_|ANTHROPIC_|INSTAGRAM_|TIKTOK_|YOUTUBE_|WHISPER_MODEL|WHISPER_LANGUAGE|MAX_PROJECT_MB|RETENTION_DAYS)' "$PROD_DIR/.env" > "$ENV" || true
  {
    echo "APP_ENV=test"
    echo "PORT=$PORT"
    echo "PUBLIC_BASE_URL=https://$DOMAIN"
    echo "APP_SECRET=$(openssl rand -hex 32)"
    echo "INVITE_CODE=$(openssl rand -hex 4)"
    echo "DATA_DIR=$DATA_DIR"
    echo "WHISPER_PYTHON=$PROD_DIR/.venv/bin/python"
  } >> "$ENV"
fi
chmod 600 "$ENV"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"

say "Dienst cliplab-test einrichten"
cat > /etc/systemd/system/cliplab-test.service <<EOF
[Unit]
Description=ClipLab (Testversion)
After=network-online.target
Wants=network-online.target

[Service]
User=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=${DATA_DIR} ${PROD_DATA}/models ${APP_DIR}

[Install]
WantedBy=multi-user.target
EOF

if ! grep -q "^${DOMAIN} {" /etc/caddy/Caddyfile; then
  cat >> /etc/caddy/Caddyfile <<EOF

${DOMAIN} {
	encode gzip
	request_body {
		max_size 4GB
	}
	reverse_proxy localhost:${PORT} {
		transport http {
			read_timeout 30m
			write_timeout 30m
		}
	}
}
EOF
fi

systemctl daemon-reload
systemctl enable --now cliplab-test >/dev/null 2>&1
systemctl restart cliplab-test
systemctl reload caddy 2>/dev/null || systemctl restart caddy
sleep 2
if curl -fsS "http://localhost:${PORT}/api/session" >/dev/null; then
  say "Fertig! Die Testversion läuft."
else
  echo "Testversion startet nicht. Logs: journalctl -u cliplab-test -n 50 --no-pager"; exit 1
fi
cat <<EOF

  Testversion:   https://${DOMAIN}   (eigene Konten – einfach neu registrieren)
  Aktualisieren: bash ${APP_DIR}/deploy/update-test.sh
  Einstellungen: APP_DIR=${APP_DIR} bash ${APP_DIR}/deploy/configure.sh

EOF

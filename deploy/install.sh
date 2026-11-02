#!/usr/bin/env bash
# ClipLab – Einrichtung auf einem frischen Ubuntu-Server (22.04 oder 24.04), z. B. Hostinger VPS.
#
# Aufruf als root:
#   curl -fsSL https://raw.githubusercontent.com/Nils092/ClipLAB/main/deploy/install.sh | bash -s -- cliplab.de
#
# Ohne Domain-Angabe wird eine kostenlose Test-Adresse <IP>.sslip.io verwendet.
# Installiert: Node.js 22, ffmpeg, Caddy (automatisches HTTPS), Firewall, systemd-Dienst.
# Erneutes Ausführen ist gefahrlos: bestehende .env und Daten bleiben erhalten.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Nils092/ClipLAB.git}"
APP_DIR=/opt/cliplab
DATA_DIR=/var/lib/cliplab
APP_USER=cliplab
PORT=3000

say() { printf '\n\033[1;31m●\033[0m %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Bitte als root ausführen (sudo -i)."; exit 1; }
command -v apt-get >/dev/null || { echo "Dieses Skript braucht Ubuntu oder Debian."; exit 1; }

IP="$(curl -fsS4 https://api.ipify.org || hostname -I | awk '{print $1}')"
DOMAIN="${1:-${IP//./-}.sslip.io}"
DOMAIN="${DOMAIN,,}"
say "Richte ClipLab für https://${DOMAIN} ein (Server-IP ${IP})"

if [[ "$DOMAIN" != *sslip.io ]]; then
  RESOLVED="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
  if [ "$RESOLVED" != "$IP" ]; then
    echo "Achtung: ${DOMAIN} zeigt noch nicht auf diesen Server (${RESOLVED:-keine Adresse} statt ${IP})."
    echo "Lege beim Domain-Anbieter einen A-Record für ${DOMAIN} auf ${IP} an."
    echo "HTTPS klappt erst, wenn der Eintrag aktiv ist. Caddy versucht es automatisch weiter."
  fi
fi

say "Systempakete installieren"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git ffmpeg ufw debian-keyring debian-archive-keyring apt-transport-https >/dev/null

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  say "Node.js 22 installieren"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

if ! command -v caddy >/dev/null; then
  say "Caddy installieren (Webserver mit automatischem HTTPS)"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

say "Benutzer und Ordner anlegen"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$DATA_DIR"

git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
if [ -d "$APP_DIR/.git" ]; then
  say "Code aktualisieren"
  git -C "$APP_DIR" pull --ff-only
else
  say "Code von GitHub holen"
  rm -rf "$APP_DIR"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi

if [ ! -f "$APP_DIR/.env" ]; then
  say "Konfiguration erzeugen"
  SECRET="$(openssl rand -hex 32)"
  INVITE="$(openssl rand -hex 4)"
  sed -e "s|^PORT=.*|PORT=${PORT}|" \
      -e "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://${DOMAIN}|" \
      -e "s|^APP_SECRET=.*|APP_SECRET=${SECRET}|" \
      -e "s|^INVITE_CODE=.*|INVITE_CODE=${INVITE}|" \
      -e "s|^DATA_DIR=.*|DATA_DIR=${DATA_DIR}|" \
      "$APP_DIR/.env.example" > "$APP_DIR/.env"
else
  sed -i "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://${DOMAIN}|" "$APP_DIR/.env"
fi
chmod 600 "$APP_DIR/.env"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR"

say "Dienst einrichten"
cat > /etc/systemd/system/cliplab.service <<EOF
[Unit]
Description=ClipLab
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
ReadWritePaths=${DATA_DIR} ${APP_DIR}

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/caddy/Caddyfile <<EOF
${DOMAIN} {
	encode gzip
	request_body {
		max_size 520MB
	}
	reverse_proxy localhost:${PORT} {
		transport http {
			read_timeout 30m
			write_timeout 30m
		}
	}
}
EOF
if [[ "$DOMAIN" != www.* && "$DOMAIN" != *sslip.io ]]; then
  printf '\nwww.%s {\n\tredir https://%s{uri} permanent\n}\n' "$DOMAIN" "$DOMAIN" >> /etc/caddy/Caddyfile
fi

say "Firewall: nur SSH, HTTP und HTTPS offen"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

systemctl daemon-reload
systemctl enable --now cliplab >/dev/null 2>&1
systemctl restart cliplab
systemctl reload caddy 2>/dev/null || systemctl restart caddy

sleep 2
if curl -fsS "http://localhost:${PORT}/api/session" >/dev/null; then
  say "Fertig! ClipLab läuft."
else
  echo "ClipLab startet nicht. Logs ansehen mit: journalctl -u cliplab -n 50"
  exit 1
fi

cat <<EOF

  Adresse:          https://${DOMAIN}
  Einladungscode:   $(grep '^INVITE_CODE=' "$APP_DIR/.env" | cut -d= -f2)
  Konfiguration:    ${APP_DIR}/.env   (TikTok- und Instagram-Schlüssel hier eintragen)
  Daten:            ${DATA_DIR}

  Nächste Schritte:
  1. https://${DOMAIN} öffnen – das erste Konto wird Admin.
  2. Redirect-URIs bei TikTok und Meta:
       https://${DOMAIN}/auth/tiktok/callback
       https://${DOMAIN}/auth/instagram/callback
  3. Nach Änderungen an der .env:  systemctl restart cliplab
  4. Updates von GitHub holen:     bash ${APP_DIR}/deploy/update.sh

EOF

#!/usr/bin/env bash
# Richtet die Auto-Clips-Werkzeuge ein bzw. aktualisiert sie (als root, mehrfach ausführbar):
#   Whisper (Untertitel), Pillow + Emoji-Schrift (Titel), yt-dlp (YouTube-Links)
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/cliplab}"
APP_USER="${APP_USER:-cliplab}"
envval() { grep -E "^$1=" "$APP_DIR/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'" || true; }
DATA_DIR="$(envval DATA_DIR)"; DATA_DIR="${DATA_DIR:-/var/lib/cliplab}"
MODEL="$(envval WHISPER_MODEL)"; MODEL="${MODEL:-small}"

echo "● Auto-Clips: Python, Emoji-Schrift und Werkzeuge installieren"
export DEBIAN_FRONTEND=noninteractive
apt-get install -y -qq python3-venv python3-pip fonts-noto-color-emoji >/dev/null

[ -x "$APP_DIR/.venv/bin/python" ] || python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install -q --upgrade pip
"$APP_DIR/.venv/bin/pip" install -q --upgrade faster-whisper pillow opencv-python-headless "yt-dlp[default]"

mkdir -p "$DATA_DIR/models"
# Gesichtserkennung für das Personen-Tracking (YuNet, ca. 230 KB)
FACE="$DATA_DIR/models/face_detection_yunet.onnx"
if [ ! -s "$FACE" ]; then
  curl -fsSL -o "$FACE.tmp" https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx \
    && [ "$(stat -c %s "$FACE.tmp")" -gt 100000 ] && mv "$FACE.tmp" "$FACE" \
    || { rm -f "$FACE.tmp"; echo "  Gesichtsmodell nicht geladen – Personen-Tracking nutzt die einfache Erkennung"; }
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR/.venv" "$DATA_DIR"

echo "● Whisper-Modell \"$MODEL\" laden (einmalig, kann ein paar Minuten dauern)"
sudo -u "$APP_USER" env HF_HOME="$DATA_DIR/models/hf" HF_HUB_DISABLE_TELEMETRY=1 "$APP_DIR/.venv/bin/python" -c \
  "from faster_whisper import WhisperModel; WhisperModel('$MODEL', device='cpu', compute_type='int8', download_root='$DATA_DIR/models')" \
  && echo "  Modell bereit" || echo "  Modell konnte nicht vorab geladen werden – wird beim ersten Video geladen"

# Größere Uploads für Rohmaterial erlauben
if [ -f /etc/caddy/Caddyfile ] && grep -q "max_size 520MB" /etc/caddy/Caddyfile; then
  sed -i 's/max_size 520MB/max_size 4GB/' /etc/caddy/Caddyfile
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
fi
echo "● Auto-Clips bereit"

#!/usr/bin/env bash
# Holt die neueste Version von GitHub und startet ClipLab neu. Als root ausführen.
set -euo pipefail
cd /opt/cliplab
git config --global --add safe.directory /opt/cliplab 2>/dev/null || true
git pull --ff-only
chown -R cliplab:cliplab /opt/cliplab
systemctl restart cliplab
sleep 2
systemctl is-active --quiet cliplab && echo "ClipLab aktualisiert auf $(git log -1 --format='%h %s')" || { echo "Start fehlgeschlagen:"; journalctl -u cliplab -n 30 --no-pager; exit 1; }

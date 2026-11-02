#!/usr/bin/env bash
# Holt den neuesten Stand aus dem Branch "test" und startet die Testversion neu. Als root ausführen.
set -euo pipefail
cd /opt/cliplab-test
git config --global --add safe.directory /opt/cliplab-test 2>/dev/null || true
git fetch -q origin
git reset -q --hard origin/test
chown -R cliplab:cliplab /opt/cliplab-test
systemctl restart cliplab-test
sleep 2
systemctl is-active --quiet cliplab-test && echo "Testversion aktualisiert auf $(git log -1 --format='%h %s')" || { echo "Start fehlgeschlagen:"; journalctl -u cliplab-test -n 30 --no-pager; exit 1; }

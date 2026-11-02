#!/usr/bin/env bash
# Sichert Datenbank und Konfiguration nach /root/cliplab-backups (Videos werden ausgelassen).
# Täglich per Cron:  echo "30 3 * * * root bash /opt/cliplab/deploy/backup.sh" > /etc/cron.d/cliplab-backup
set -euo pipefail
DEST=/root/cliplab-backups
mkdir -p "$DEST"
tar czf "$DEST/cliplab-$(date +%F).tar.gz" -C / var/lib/cliplab/db.json opt/cliplab/.env
find "$DEST" -name 'cliplab-*.tar.gz' -mtime +30 -delete
echo "Backup: $DEST/cliplab-$(date +%F).tar.gz"

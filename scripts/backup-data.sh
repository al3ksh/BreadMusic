#!/usr/bin/env bash
# Backs up the Bread SQLite database and OAuth sessions with rotation.
# Intended for cron:  15 */6 * * * /path/to/scripts/backup-data.sh
set -euo pipefail

SOURCE_DIR="${BREAD_DATA_DIR:-/home/alexpi/apps/discord-bot/data}"
BACKUP_DIR="${BREAD_BACKUP_DIR:-/home/alexpi/backups/bread}"
KEEP_DAYS="${BREAD_BACKUP_KEEP_DAYS:-14}"

STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"

if [ -f "$SOURCE_DIR/bread.sqlite" ]; then
  sqlite3 "$SOURCE_DIR/bread.sqlite" ".backup '$BACKUP_DIR/bread-$STAMP.sqlite'"
  echo "[$STAMP] database backed up"
fi

if [ -d "$SOURCE_DIR/sessions" ]; then
  tar -czf "$BACKUP_DIR/sessions-$STAMP.tar.gz" -C "$SOURCE_DIR" sessions
  echo "[$STAMP] sessions backed up"
fi

find "$BACKUP_DIR" -name 'bread-*.sqlite' -mtime "+$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'sessions-*.tar.gz' -mtime "+$KEEP_DAYS" -delete
echo "[$STAMP] rotation done (keep $KEEP_DAYS days)"

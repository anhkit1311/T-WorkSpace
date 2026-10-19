#!/bin/sh
# Q5: nightly PostgreSQL backup with rotation. Custom format (pg_restore can pick tables), one file per run.
#   scripts/ops/backup-db.sh                 # dev: pg_dump inside the infra-postgres-1 container
#   POSTGRES_CONTAINER= DATABASE_URL=... scripts/ops/backup-db.sh   # host pg_dump against a URL
# Cron (02:30 every night):  30 2 * * * cd /srv/nexo && scripts/ops/backup-db.sh >> backups/backup.log 2>&1
# Check a dump restores: npm run verify:restore. Media files (MEDIA_DIR) are backed up separately (rsync/S3).
set -eu

DIR="${BACKUP_DIR:-backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
DB="${POSTGRES_DB:-realtime_workspace}"
CONTAINER="${POSTGRES_CONTAINER-infra-postgres-1}"
mkdir -p "$DIR"
FILE="$DIR/$DB-$(date +%Y%m%d-%H%M%S).dump"

if [ -n "$CONTAINER" ]; then
  docker exec "$CONTAINER" pg_dump -U "${POSTGRES_USER:-workspace}" --format=c --no-owner "$DB" > "$FILE.part"
else
  pg_dump --format=c --no-owner "${DATABASE_URL:?DATABASE_URL is required without a container}" > "$FILE.part"
fi
# A dump is kept only when complete and readable.
if [ -n "$CONTAINER" ]; then
  docker exec -i "$CONTAINER" pg_restore --list < "$FILE.part" > /dev/null
else
  pg_restore --list "$FILE.part" > /dev/null
fi
mv "$FILE.part" "$FILE"
find "$DIR" -name "$DB-*.dump" -type f -mtime +"$KEEP_DAYS" -delete
echo "$(date -Iseconds) backup ok: $FILE ($(wc -c < "$FILE") bytes), keeping $KEEP_DAYS days"

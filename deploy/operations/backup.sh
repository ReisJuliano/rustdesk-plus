#!/bin/sh
set -eu

cd "$(dirname "$0")/../.."

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi
compose() {
  if $SUDO docker compose version >/dev/null 2>&1; then
    $SUDO docker compose "$@"
  else
    $SUDO docker-compose "$@"
  fi
}

RETENTION_DAYS="${RETENTION_DAYS:-30}"
BACKUP_DIR="${BACKUP_DIR:-$(pwd)/backups}"
timestamp=$(date -u '+%Y%m%dT%H%M%SZ')
destination="$BACKUP_DIR/$timestamp"

case "$BACKUP_DIR" in
  /*/backups|*/rustdesk-plus/backups) ;;
  *) echo "BACKUP_DIR deve terminar em /backups." >&2; exit 2 ;;
esac
[ "$BACKUP_DIR" != "/backups" ] || { echo "BACKUP_DIR não pode ser /backups." >&2; exit 2; }

mkdir -p "$destination"
chmod 700 "$BACKUP_DIR" "$destination"

compose exec -T postgres pg_dump -U plusapi -d plusapi -Fc > "$destination/postgres.dump"
tar -czf "$destination/server-files.tar.gz" .env data/rustdesk data/deployment data/generated 2>/dev/null

cat > "$destination/manifest.txt" <<EOF
created_at=$timestamp
database=postgres.dump
server_files=server-files.tar.gz
restore_requires_same_or-compatible-rustdesk-plus-version=true
EOF

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name '20??????T??????Z' -mtime "+$RETENTION_DAYS" -exec rm -rf -- {} +
printf 'Backup concluído: %s\n' "$destination"

#!/usr/bin/env bash
set -euo pipefail

backup_directory="${VINIFERA_BACKUP_DIRECTORY:-/opt/supabase-staging/backups}"
database_container="${VINIFERA_DB_CONTAINER:-supabase-db}"
retention_days="${VINIFERA_BACKUP_RETENTION_DAYS:-14}"

if [[ ! "$retention_days" =~ ^[0-9]+$ ]] || (( retention_days < 1 )); then
  echo "VINIFERA_BACKUP_RETENTION_DAYS must be a positive integer." >&2
  exit 1
fi

if ! docker inspect "$database_container" >/dev/null 2>&1; then
  echo "Database container is unavailable: $database_container" >&2
  exit 1
fi

postgres_password="$(docker exec "$database_container" printenv POSTGRES_PASSWORD)"
database_name="$(docker exec "$database_container" printenv POSTGRES_DB 2>/dev/null || true)"
database_user="$(docker exec "$database_container" printenv POSTGRES_USER 2>/dev/null || true)"
database_name="${database_name:-postgres}"
database_user="${database_user:-postgres}"
: "${postgres_password:?POSTGRES_PASSWORD is required in the database container}"

if [[ "${1:-}" == "--check" ]]; then
  docker exec \
    -e PGPASSWORD="$postgres_password" \
    "$database_container" \
    pg_isready --username "$database_user" --dbname "$database_name" >/dev/null
  echo "Staging database backup prerequisites passed."
  exit 0
fi

if [[ $# -ne 0 ]]; then
  echo "Usage: staging-db-backup.sh [--check]" >&2
  exit 2
fi

install -d -m 700 "$backup_directory"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
final_path="$backup_directory/vinifera-staging-$timestamp.dump"
temporary_path="$final_path.in-progress"

cleanup() {
  if [[ -f "$temporary_path" ]]; then
    rm -- "$temporary_path"
  fi
}
trap cleanup EXIT

docker exec \
  -e PGPASSWORD="$postgres_password" \
  "$database_container" \
  pg_dump \
    --username "$database_user" \
    --dbname "$database_name" \
    --format=custom \
    --no-owner \
    --no-acl >"$temporary_path"

if [[ ! -s "$temporary_path" ]]; then
  echo "Database backup was empty." >&2
  exit 1
fi

chmod 600 "$temporary_path"
mv -- "$temporary_path" "$final_path"
trap - EXIT

find "$backup_directory" \
  -type f \
  -name 'vinifera-staging-*.dump' \
  -mtime "+$retention_days" \
  -delete

echo "Created staging database backup: $final_path"

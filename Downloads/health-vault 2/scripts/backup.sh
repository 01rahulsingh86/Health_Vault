#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="${DATA_DIR:-$ROOT/data}"
BACKUP_DIR="$ROOT/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/health-vault-backup-$STAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

if [ ! -d "$DATA_DIR" ]; then
  echo "Data directory not found: $DATA_DIR" >&2
  exit 1
fi

if [ -f "$ROOT/.env" ]; then
  cp "$ROOT/.env" "$BACKUP_DIR/.env.backup-$STAMP"
fi

tar -czf "$TARGET" -C "$ROOT" data

printf '\nBackup created at %s\n' "$TARGET"
if [ -f "$BACKUP_DIR/.env.backup-$STAMP" ]; then
  printf 'Environment backup created at %s\n' "$BACKUP_DIR/.env.backup-$STAMP"
fi

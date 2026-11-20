#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
command -v openssl >/dev/null || { echo 'Se requiere openssl para generar secretos locales.' >&2; exit 1; }
if [[ -e .env || -L .env ]]; then
  echo '.env ya existe; no se ha sobrescrito.' >&2
  exit 1
fi
umask 077
set -o noclobber
{
  printf 'ATELIER_PORT=3001\n'
  for name in POSTGRES_PASSWORD APP_DB_PASSWORD AI_DB_PASSWORD AI_INTERNAL_KEY; do
    secret=$(openssl rand -hex 32)
    printf '%s=%s\n' "$name" "$secret"
  done
} > .env
chmod 600 .env
printf 'Configuración local generada en .env (no compartir ni versionar).\n'

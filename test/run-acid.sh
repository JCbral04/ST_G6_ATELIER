#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export DB_HOST="${DB_HOST:-127.0.0.1}"
export DB_PORT="${DB_PORT:-5432}"
export DB_USER="${DB_USER:-postgres}"

: "${DB_PASSWORD:?Configura DB_PASSWORD antes de ejecutar las pruebas}"

export PGPASSWORD="$DB_PASSWORD"
export DB_NAME="atelier_test_$(date +%s)_$$"
export ACID_TEST_RUN=1

echo "Base de pruebas temporal: $DB_NAME"

# Crear una base nueva. Si ya existe, detener la ejecución.
createdb -w \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  "$DB_NAME"

cleanup() {
  local status=$?

  echo "Eliminando base temporal: $DB_NAME"

  if ! dropdb -w --if-exists \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    "$DB_NAME"; then
    echo "ERROR: No se pudo eliminar la base temporal"
    status=1
  fi

  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

PSQL=(
  psql
  -X
  -w
  -h "$DB_HOST"
  -p "$DB_PORT"
  -U "$DB_USER"
  -d "$DB_NAME"
  -v ON_ERROR_STOP=1
)

echo "Cargando esquema..."

# Eliminar las instrucciones que apuntan a atelier_db.
sed \
  -e '/^CREATE DATABASE atelier_db;$/d' \
  -e '/^\\c atelier_db$/d' \
  db/schema.sql | "${PSQL[@]}"

echo "Cargando datos iniciales..."

sed '/^\\c atelier_db$/d' \
  db/seed.sql | "${PSQL[@]}"

echo "Aplicando migraciones..."

for migration in db/migrations/*.sql; do
  echo "Aplicando: $migration"

  "${PSQL[@]}" \
    --single-transaction \
    -f "$migration"
done

echo "Ejecutando suite ACID..."

cd "$ROOT/backend"

npm run test:acid

#!/usr/bin/env bash
set -euo pipefail

# Exclusivo del volumen de demostración de Compose.
[[ "$POSTGRES_DB" == atelier_demo ]] || { echo 'Inicialización restringida a atelier_demo' >&2; exit 1; }
: "${APP_DB_PASSWORD:?Falta APP_DB_PASSWORD}"
: "${AI_DB_PASSWORD:?Falta AI_DB_PASSWORD}"
export APP_DB_PASSWORD AI_DB_PASSWORD

psql_demo() {
  psql -X -w --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -v ON_ERROR_STOP=1 "$@"
}

# La imagen oficial ya creó atelier_demo: no crear otra base ni cambiar de conexión.
sed -E '/^[[:space:]]*CREATE DATABASE atelier_db;[[:space:]]*$/d; /^[[:space:]]*\\c[[:space:]]+atelier_db[[:space:]]*$/d' \
  /atelier/db/schema.sql | psql_demo --single-transaction --file=-
sed -E '/^[[:space:]]*\\c[[:space:]]+atelier_db[[:space:]]*$/d' \
  /atelier/db/seed.sql | psql_demo --single-transaction --file=-

# Aplicar todas las migraciones disponibles, incluidas las futuras, en orden lexical.
for migration in /atelier/db/migrations/*.sql; do
  psql_demo --single-transaction --file="$migration"
done

# El fixture está restringido a atelier_demo y contiene su propia transacción.
psql_demo --file=/atelier/db/fixtures/ventas_ia_demo.sql

# Contraseñas leídas desde el entorno, sin interpolación directa en el SQL.
psql_demo --single-transaction <<'SQL'
\getenv app_password APP_DB_PASSWORD
\getenv ai_password AI_DB_PASSWORD
CREATE ROLE atelier_app LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
GRANT CONNECT ON DATABASE atelier_demo TO atelier_app;
GRANT USAGE ON SCHEMA public TO atelier_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO atelier_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO atelier_app;
ALTER ROLE ai_readonly PASSWORD :'ai_password';
SQL

# Impide considerar sano un volumen con una inicialización parcial.
touch "$PGDATA/.atelier-init-complete"
echo 'ATELIER: esquema, migraciones, fixture y roles inicializados.'

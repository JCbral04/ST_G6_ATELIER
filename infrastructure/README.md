# ATELIER — Infraestructura declarativa local

Entorno de demostración aislado con Docker Compose: PostgreSQL 16, Node.js 22 y Python 3.12. Express sirve también el frontend; el servicio de IA se comunica por la red de Compose. No se publican puertos de PostgreSQL ni FastAPI. El puerto HTTP se limita a 127.0.0.1:3001 por defecto.

## Arranque

Desde la raíz del repositorio, con Docker Engine, Compose, Bash y OpenSSL disponibles:

```bash
bash infrastructure/setup-env.sh
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 240
docker compose ps
bash test/smoke-compose.sh
```

El generador de secretos se ejecuta una sola vez. Si `.env` ya existe, conservarlo. No imprimirlo ni versionarlo. Se usan credenciales de base de datos distintas para administrador, aplicación y servicio de IA.

- ERP: http://127.0.0.1:3001/
- IA: http://127.0.0.1:3001/ia.html
- Salud: http://127.0.0.1:3001/api/health

Usuarios del seed: `admin@atelier.com`, `vendedor@atelier.com`, contraseña de demostración `123456`. No son credenciales de producción. La interfaz principal puede tener componentes mock; el smoke test verifica la API real, no una venta desde la interfaz.

## Persistencia e inicialización

Compose crea su propia base `atelier_demo` en un volumen administrado por Docker. No utiliza las bases instaladas en el host. El script de inicialización aplica esquema, seed, migraciones y fixture sintético una sola vez al crear un volumen nuevo. Un marcador evita que un volumen inicializado a medias se considere saludable. Las migraciones nuevas sobre un volumen existente requieren un procedimiento de migración explícito; reconstruir imágenes no las aplica.

```bash
docker compose logs --tail=100 db ai backend
docker compose down
```

`down` conserva los datos. No utilizar `down -v` sobre datos que deban conservarse. Si falla la inicialización, inspeccionar los logs antes de reintentar; un volumen parcialmente creado necesita reparación o recreación explícita de un entorno descartable. Cambiar las contraseñas en `.env` no actualiza las contraseñas ya almacenadas en el volumen.

### Migración `003_auditoria.sql` y permisos en volúmenes existentes

En volúmenes de PostgreSQL (`atelier_demo`) inicializados antes de incorporar `RNF-09`, aplicar la migración de auditoría como superusuario (`postgres`) y asignar los privilegios mínimos al rol de aplicación (`atelier_app`, revocando `UPDATE`, `DELETE` y `TRUNCATE` sobre `auditoria`):

```bash
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d atelier_demo < db/migrations/003_auditoria.sql
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d atelier_demo <<'SQL'
GRANT SELECT, INSERT ON TABLE auditoria TO atelier_app;
GRANT USAGE, SELECT ON SEQUENCE auditoria_id_seq TO atelier_app;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE auditoria FROM atelier_app;
SQL
```

## Alcance

Los Dockerfiles usan versiones mayores de bases de imagen, y Python conserva los rangos de dependencias del proyecto: no se garantiza reproducibilidad bit a bit. Node 22 se propone para el contenedor; el CI existente usa Node 20. El smoke test exige predicción real, no fallback, y revisa los permisos del rol analítico. La suite ACID existente sigue siendo necesaria.

Esta configuración es local, no un despliegue remoto ni un sustituto de la finalización de autenticación, compras e inventario. La configuración TLS/Neon, el Blueprint de Render y el smoke test en CI quedan para las siguientes fases. No exponer este entorno directamente a Internet.
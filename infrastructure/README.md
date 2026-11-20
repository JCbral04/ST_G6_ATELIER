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
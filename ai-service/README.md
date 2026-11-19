# ATELIER AI — Reposición inteligente de inventario

## Descripción

Microservicio de inteligencia artificial integrado al ERP ATELIER, orientado a la predicción de demanda por SKU y la generación de recomendaciones de reposición de inventario.

## Arquitectura

- Frontend: HTML, CSS y JavaScript.
- Backend transaccional: Node.js + Express.
- Microservicio analítico: Python + FastAPI.
- Base de datos: PostgreSQL.
- Machine Learning: Scikit-learn.
- Pruebas automatizadas: Pytest.

El microservicio consulta PostgreSQL mediante un usuario de solo lectura. Las operaciones transaccionales permanecen bajo responsabilidad del backend principal.

## Modelos predictivos

| Historial disponible | Modelo |
|---|---|
| 21 días o más | Regresión Ridge |
| Entre 7 y 20 días | Suavizado exponencial |
| Menos de 7 días | Estimación por categoría o historial parcial |
| Sin información suficiente | Umbral estático |

El modelo Ridge utiliza medias móviles exponenciales de 7 y 14 días y características del día de la semana.

La evaluación utiliza los últimos siete días históricos como conjunto de validación temporal independiente del entrenamiento correspondiente.

## Funcionalidades

- Predicción de demanda diaria por SKU.
- Cálculo dinámico del stock de seguridad.
- Punto de reorden.
- Días estimados de cobertura.
- Clasificación del riesgo de desabastecimiento.
- Cantidades sugeridas de reposición.
- Descuento de mercancía en tránsito.
- Exclusión de ventas canceladas.
- Degradación controlada mediante alertas estáticas.

## Instalación

Requisitos:

- Python 3.10 o superior.
- Node.js 18 o superior.
- PostgreSQL 14 o superior.

Desde la raíz del repositorio:

```bash
cd ai-service
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env
chmod 600 .env
```

Configurar las variables de entorno:

| Variable | Descripción |
|---|---|
| AI_DATABASE_URL | Conexión PostgreSQL |
| PGPASSWORD | Contraseña del rol ai_readonly |
| AI_INTERNAL_KEY | Clave interna compartida con Express |

## Base de datos de demostración

Crear una base independiente denominada `atelier_demo`.

Desde la raíz del repositorio:

```bash
sed 's/atelier_db/atelier_demo/g' db/schema.sql | \
psql -h 127.0.0.1 -p 5433 -U postgres -d postgres -v ON_ERROR_STOP=1

sed 's/atelier_db/atelier_demo/g' db/seed.sql | \
psql -h 127.0.0.1 -p 5433 -U postgres -d atelier_demo -v ON_ERROR_STOP=1
```

Aplicar las migraciones existentes en orden:

```bash
for f in db/migrations/*.sql; do
  psql -h 127.0.0.1 -p 5433 -U postgres \
    -d atelier_demo -v ON_ERROR_STOP=1 \
    --single-transaction -f "$f" || break
done
```

Si alguna migración falla, detener el proceso y corregir el error.

Asignar una contraseña al rol `ai_readonly` mediante `\password ai_readonly` dentro de psql.

Cargar el historial sintético:

```bash
psql -h 127.0.0.1 -p 5433 -U postgres \
  -d atelier_demo -v ON_ERROR_STOP=1 \
  -f db/fixtures/ventas_ia_demo.sql
```

Ajustar el puerto según la instalación local de PostgreSQL. No ejecutar el fixture sobre bases de producción.

## Ejecución

### Microservicio Python

```bash
cd ai-service
source .venv/bin/activate

python -m uvicorn main:app \
  --host 127.0.0.1 \
  --port 8000 \
  --env-file .env
```

### Backend Express

Configurar en `backend/.env`:

```dotenv
AI_SERVICE_URL=http://127.0.0.1:8000
AI_INTERNAL_KEY=""
```

La clave interna debe coincidir con la configurada en Python.

```bash
cd backend
npm ci
DB_NAME=atelier_demo npm run dev
```

### Interfaz administrativa

Abrir:

http://localhost:3000/ia.html

Autenticarse como administrador y ejecutar el análisis de inventario.

## Contratos API

| Método | Endpoint | Autorización |
|---|---|---|
| GET | /health | Servicio interno |
| POST | /api/v1/predict/restock | X-Internal-API-Key |
| POST | /api/ia/reposicion | Bearer Token, administrador |

Parámetros de ejemplo:

```json
{
  "horizon_days": 15,
  "lead_days": 7
}
```

## Seguridad

- Autenticación entre microservicios.
- Autorización exclusiva para administradores.
- Revocación de sesiones.
- Limitación de solicitudes.
- Usuario PostgreSQL de solo lectura.
- Consultas bajo aislamiento REPEATABLE READ.
- Tiempo máximo de espera HTTP de 3000 ms.
- Credenciales excluidas del control de versiones.
- FastAPI restringido a la interfaz local en la demostración.

## Tolerancia a fallos

Cuando el servicio de IA no está disponible, Express consulta las alertas tradicionales de inventario.

La interfaz identifica explícitamente que los resultados corresponden a un modo estático y no a predicciones.

La recuperación del microservicio no requiere reiniciar Express.

## Pruebas

```bash
python -m pytest -v
```

Resultados verificados el 19 de noviembre de 2026:

| Validación | Resultado |
|---|---|
| Pruebas automatizadas Python | 8 PASS / 0 FAIL |
| Comprobaciones de integración y autorización | 7 PASS / 0 FAIL |
| Predicción directa de FastAPI | HTTP 200 |
| Acceso sin clave interna | HTTP 401 |
| Acceso de vendedor a IA | HTTP 403 |
| Token revocado | HTTP 401 |
| Permisos de escritura del rol IA sobre tablas verificadas | Denegados |
| Activación de fallback | Exitosa |
| Recuperación del microservicio | Exitosa |

## Resultados experimentales

Base de demostración: `atelier_demo`.

- 140 ventas sintéticas.
- 350 unidades vendidas.
- 35 días históricos por SKU.
- 4 variantes analizadas.
- Horizonte predictivo de 15 días.
- Tiempo de entrega supuesto de 7 días.

| SKU | Stock | Demanda diaria | Cobertura | MAE | Riesgo | Reposición |
|---|---:|---:|---:|---:|---|---:|
| CAM-NEG-M | 68 | 2.424 | 28.06 | 1.096 | Bajo | 0 |
| CAM-BLA-M | 40 | 2.453 | 16.31 | 1.029 | Bajo | 2 |
| JEA-AZU-32 | 30 | 2.583 | 11.61 | 0.972 | Medio | 14 |
| CHA-AZU-L | 15 | 2.552 | 5.88 | 0.858 | Crítico | 29 |

Total de unidades recomendadas: 45.

## Limitaciones

- Los resultados corresponden a datos sintéticos, no a ventas comerciales reales.
- No se corrige la demanda censurada por desabastecimiento.
- El tiempo de entrega es un parámetro supuesto.
- Las recomendaciones requieren decisión humana.
- No se crean órdenes de compra automáticamente.
- El panel administrativo utiliza una ruta y autenticación independientes del frontend principal.
- La integración de las recomendaciones con la auditoría transaccional y la automatización de las pruebas de integración en CI quedan pendientes.

## Proyecto académico

Universidad Manuela Beltrán.

Sistemas Transaccionales — Grupo 6.

ATELIER — ERP para tienda de ropa.
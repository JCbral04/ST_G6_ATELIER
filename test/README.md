# Pruebas de integridad transaccional — ATELIER

## Objetivo

Validar la integridad transaccional de las operaciones de venta
y cancelación mediante Jest, Supertest y PostgreSQL real.

Implementación correspondiente al issue #28.

## Casos de prueba

| ID | Descripción | Resultado local |
|---|---|---|
| ACID-01 | Venta exitosa y descuento atómico de stock | PASS |
| ACID-02 | Rollback ante fallo intermedio | PASS |
| ACID-03 | Dos ventas concurrentes de la última unidad | PASS |
| ACID-04 | Anulación y devolución de existencias | PASS |

## Infraestructura

- Jest 30.
- Supertest 7.
- Express.
- PostgreSQL 16.
- Base de datos temporal por ejecución.
- Aplicación automática del esquema, seed y migraciones.
- Limpieza de datos entre casos.
- Eliminación automática de la base temporal.

Las pruebas utilizan las rutas y middleware reales del backend.
No se emplean mocks de PostgreSQL.

## Ejecución local

Instalar las dependencias:

```bash
cd backend
npm ci
cd ..
```

Configurar las variables de conexión a PostgreSQL:

- DB_HOST
- DB_PORT
- DB_USER
- DB_PASSWORD

Ejecutar desde la raíz del repositorio:

```bash
bash test/run-acid.sh
```

La contraseña debe proporcionarse mediante variables de entorno
y no debe incorporarse al control de versiones.

## Resultados experimentales

Fecha: 19 de noviembre de 2026.

| Ejecución | PASS | FAIL | Tiempo |
|---|---:|---:|---:|
| Código original | 4 | 0 | 14.18 s |
| Mutación controlada | 2 | 2 | 15.12 s |
| Código restaurado | 4 | 0 | 12.287 s |

## Prueba de mutación

Se eliminó temporalmente la instrucción BEGIN de la ruta
de registro de ventas.

La suite detectó dos regresiones:

### ACID-02 — Pérdida de atomicidad

- Stock esperado después del rollback: 10 unidades.
- Stock obtenido con el código mutado: 8 unidades.
- Resultado: FAIL.

### ACID-03 — Pérdida de aislamiento

- Respuestas HTTP esperadas: 201 y 409.
- Respuestas obtenidas: 201 y 500.
- Resultado: FAIL.

La restricción de integridad de PostgreSQL impidió almacenar
existencias negativas.

Después de restaurar el código original, las cuatro pruebas
volvieron a ejecutarse satisfactoriamente.

El código mutado no se incorporó al control de versiones.

## Aislamiento y limpieza

Se verificó la ausencia de bases de datos temporales residuales
después de las ejecuciones.

Las bases atelier_db y atelier_demo se conservaron.

## Integración continua

La suite se incorpora como job test en:

.github/workflows/devsecops-pipeline.yml

El job provisiona PostgreSQL 16 como servicio del runner,
instala las dependencias mediante npm ci y ejecuta las pruebas.

El job de despliegue depende del éxito de las pruebas ACID
y de los controles de seguridad.

## Observaciones

El error ACID_TEST_FALLO_CONTROLADO durante ACID-02 es
intencional y permite comprobar un rollback real.

La prueba de concurrencia realiza peticiones HTTP simultáneas.
No fuerza de forma determinista el solapamiento transaccional.

El bloqueo de merges mediante estas pruebas requiere configurar
el check correspondiente como obligatorio en la protección
de la rama main.

## Trazabilidad

- Issue #25: Cancelación de ventas con devolución de stock.
- Issue #28: Pruebas automatizadas de transacciones ACID.
- Guía 7: Documento Maestro.
- Guía 8: Validación y evidencias del prototipo.
## Auditoría de dependencias

Resultados del 19 de noviembre de 2026:

- Jest: 30.5.2.
- Supertest: 7.3.2.
- Vulnerabilidades críticas: 0.
- Vulnerabilidades altas: 0.
- Vulnerabilidades moderadas: 18.
- Dependencias de producción: 0 vulnerabilidades reportadas.

Las observaciones corresponden a dependencias transitivas
del entorno de desarrollo y pruebas, principalmente glob
y minimatch.

Se conserva temporalmente la versión validada de Jest para
evitar cambios incompatibles antes de la entrega académica.

Referencias:

- GHSA-3g3m-2fjr-6pw4.
- GHSA-g3hv-75wg-m249.

Queda pendiente actualizar las dependencias afectadas y
ejecutar nuevamente la suite de regresión.

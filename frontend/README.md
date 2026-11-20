# ATELIER — Panel interno del ERP (Fase III)

Herramienta de uso interno para el personal de la tienda (administrador y vendedores).
No es una tienda en línea: no hay cuentas de clientes ni compras desde la web. Las ventas
las registra un empleado en el punto de venta del mostrador.

Construido a partir del prototipo de alta fidelidad (`docs/prototipo/index.html`) con la
paleta del equipo: violeta `#9314EB` (marca, acciones y lo que hay que reponer), azul
`#129AED` (información y estados OK), blanco y negro. HTML + CSS + JavaScript sin
dependencias ni build, para que corra igual en cualquier equipo del grupo. La migración a
React queda para la Fase 4.

## Pantallas

| Ruta | Pantalla | Roles | Requisitos |
|---|---|---|---|
| — | Acceso del personal contra `POST /api/auth/login`, o modo demo elegido a propósito | administrador, vendedor | RF-01 |
| `#/pos` | **Vista principal.** Venta en mostrador: prendas, cantidades y confirmación contra `POST /api/pedidos` | administrador, vendedor | RF-11, RF-12 |
| `#/dashboard` | Resumen: ventas del día, últimas ventas y variantes por reponer. El administrador puede anular una venta | administrador, vendedor | RF-10, #25 |
| `#/inventario` | Fichas talla × color, lista por variante y movimientos (ajustes manuales e historial), con filtros por categoría, talla, color y estado | administrador, vendedor | RF-06, RF-07, RF-09, RF-10, #26 |
| `#/compras` | Pedir al proveedor (armar y enviar órdenes de compra), órdenes por recibir/recibidas y directorio | administrador | RF-16..18 |

La interfaz es responsive (RNF-06): en celular la navegación lateral pasa a un menú
desplegable (☰) y las tablas se desplazan horizontalmente.

## Cómo ejecutarla

**Con el backend (datos reales):**

```bash
cd backend && npm run dev
# abrir http://localhost:3000/
```

Express sirve esta carpeta como estática, así que la interfaz y la API comparten origen.

**Sin backend (modo demo):** abrir `frontend/index.html` en el navegador, o servir la carpeta, y
entrar con **Demo como administrador** o **Demo como vendedor**:

```bash
cd frontend && python3 -m http.server 8080   # http://localhost:8080
```

El login no muestra credenciales: las cuentas reales son las del entorno (en local, las de
`db/seed.sql`) y la demo usa usuarios ficticios sin contraseña. Antes de publicar, las cuentas
del seed deben cambiarse en el entorno remoto. Solo entran los roles `administrador` y
`vendedor`; cualquier otro rol (por ejemplo el legado `cliente`) se rechaza al iniciar o
recuperar la sesión, y el token que alcanzó a entregar el servidor se revoca.

## Datos: sesión real o modo demo

Son dos modos separados y nunca se mezclan (`src/js/api.js`):

- **Sesión real** (botón *Ingresar*): todo sale de la API y cada petición lleva
  `Authorization: Bearer <token>`. Si un recurso no carga (404, 403, 500, sin conexión o
  respuesta con otro formato) queda vacío y marcado como no disponible; **no** se reemplaza
  por datos de prueba. Las operaciones que dependen de él se desactivan y la pantalla explica
  por qué. Si el servidor no responde al iniciar sesión, el login lo dice y no entra solo a demo.
  Si la API responde 401 (token vencido o revocado), el panel vuelve al login.
- **Modo demo** (botones *Demo como…*): usa solo `src/js/data.js` en memoria y no hace
  ninguna petición a la API, aunque el servidor esté encendido. Una franja arriba del contenido
  y el indicador del encabezado avisan que nada se guarda.

El indicador del encabezado muestra **Conectado a la base de datos**, **Conexión parcial (n de m)**
(con el detalle de lo que falta al pasar el cursor) o **Modo demo: no se guarda**.

| Recurso | Endpoint | Estado | Sin él, en sesión real |
|---|---|---|---|
| Variantes con stock | `GET /api/inventario` | integrado (PR #15) | ventas, ajustes y pedidos a proveedores desactivados |
| Sesión | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout` | PR #34 | no se puede entrar (solo demo) |
| Pedidos | `GET /api/pedidos`, `POST /api/pedidos`, `POST /api/pedidos/:id/cancelar` | PR #11 y #34 | resumen de ventas y anulación sin datos |
| Movimientos | `GET /api/inventario/movimientos`, `POST /api/inventario/movimientos` | PR #30; autenticación pendiente (PR #37) | historial y ajustes sin datos |
| Compras | `GET /api/compras`, `POST /api/compras`, `PATCH /api/compras/:id` | integrado (PR #44) | órdenes desactivadas |
| Proveedores | `GET /api/proveedores` | integrado (PR #44) | pedidos a proveedores desactivados |

**Ajustes manuales:** el navegador no envía `id_usuario`; el servidor lo toma del token. El
registro real de ajustes queda apagado con la constante `AJUSTES_REALES = false` de `api.js`
hasta que se integre el PR #37 y se valide contra su contrato (`POST` con sesión, rol
administrador o vendedor y actor tomado del token). En la demo funciona normal.

**Aislamiento entre sesiones:** cada sesión tiene un contexto (generación, token y modo). Al
iniciar, cerrar o vencer una sesión se crea uno nuevo y se cancelan con `AbortController` las
peticiones pendientes del anterior. Toda respuesta que llega de un contexto viejo se descarta:
no escribe en el store, un 401 viejo no cierra la sesión nueva y no aparecen confirmaciones de
operaciones de otra sesión. Las cargas juntan las respuestas aparte y solo las escriben si la
sesión sigue siendo la misma. El cierre de sesión es local e inmediato y la revocación en el
servidor se pide con el token viejo, sin volver a tocar el estado. En el login solo puede haber
un intento de entrada a la vez (real o demo).

**Reponer en compras:** el botón *Completar al doble del mínimo* es una regla fija del panel
(`stock_minimo × 2 − stock − en camino`), no la predicción del microservicio de IA.

## Pruebas de sesión

`test/sesiones.e2e.js` reproduce en Chromium los escenarios SES-01 a SES-10 (logout durante una
carga, cambio real a demo, administrador a vendedor, 401 de una sesión anterior, login real y
demo a la vez, logout lento, recuperación invalidada, recarga después de una operación,
verificación de movimientos y expiración). Usa una API simulada con demoras controladas, así que
no necesita base de datos ni credenciales reales:

```bash
cd frontend/test
npm install
npx playwright install chromium
npm test
```

Imprime una tabla con el resultado de cada escenario (PASS o FAIL) y termina con código 1 si
alguno falla.

Forma que espera el panel para las compras:

```json
// GET /api/compras
[{ "id_compra": 2, "fecha": "2026-10-17T15:30:00Z", "estado": "pendiente", "total": 480000,
   "proveedor": "Moda Premium Ltda.",
   "items": [{ "id_variante": 5, "sku": "CAM-ROJ-S", "cantidad": 20, "costo_unitario": 24000 }] }]

// POST /api/compras  (body)
{ "id_proveedor": 2, "items": [{ "id_variante": 6, "cantidad": 7, "costo_unitario": 60000 }] }
// respuesta 201
{ "id_compra": 3, "total": 420000, "estado": "pendiente" }

// PATCH /api/compras/:id  (body)  -> dispara trg_stock_compra
{ "estado": "recibida" }
```

Forma de cada fila de `GET /api/inventario` (la que espera la interfaz):

```json
{ "id_variante": 1, "sku": "CAM-NEG-M", "id_producto": 1, "producto": "Camiseta básica algodón",
  "categoria": "Camisetas", "talla": "M", "color": "Negro", "codigo_hex": "#000000",
  "precio": 45000, "stock": 68, "stock_minimo": 10 }
```

La alerta de stock se activa cuando `stock <= stock_minimo`.

## Estructura

```
frontend/
├── index.html            # login + shell (navegación lateral, topbar)
├── test/                 # pruebas de aislamiento de sesión (Playwright)
└── src/
    ├── css/styles.css    # paleta del equipo (#9314EB, #129AED, blanco, negro) + responsive
    ├── fonts/            # Bricolage Grotesque y Hanken Grotesk (OFL), sin depender de internet
    └── js/
        ├── utils.js      # formato de moneda, escape HTML, toast, sesión
        ├── data.js       # datos de prueba (solo modo demo)
        ├── api.js        # sesión real o demo, carga y validación de la API
        ├── app.js        # sesión, roles, navegación y router por hash
        └── views/        # login, pos, dashboard, inventario, compras
```

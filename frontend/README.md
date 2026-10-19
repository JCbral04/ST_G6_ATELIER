# ATELIER — Interfaz web (Fase III)

Pantallas principales del ERP, construidas a partir del prototipo de alta fidelidad
(`docs/prototipo/index.html`). HTML + CSS + JavaScript sin dependencias ni build,
para que corra igual en cualquier equipo del grupo. La migración a React queda para la Fase 4.

## Pantallas

| Ruta | Pantalla | Roles | Requisitos |
|---|---|---|---|
| — | Login con validación visual de campos obligatorios | todos | RF-01 (provisional) |
| `#/dashboard` | KPIs, últimas ventas y alertas de stock mínimo | administrador, vendedor | RF-10 |
| `#/pos` | Punto de venta: carrito, cantidades y confirmación | administrador, vendedor | RF-11, RF-12 (lógica en #9) |
| `#/inventario` | Existencias por variante, nivel y estado | administrador, vendedor | RF-09, RF-10 |
| `#/catalogo` | Catálogo con filtros por categoría, talla, color y precio | todos | RF-06, RF-07 |
| `#/compras` | Órdenes de compra y directorio de proveedores | administrador | RF-16..18 |

La interfaz es responsive (RNF-06): en celular la navegación lateral pasa a un menú
desplegable (☰) y las tablas se desplazan horizontalmente.

## Cómo ejecutarla

**Con el backend (datos reales):**

```bash
cd backend && npm run dev
# abrir http://localhost:3000/
```

Express sirve esta carpeta como estática, así que la interfaz y la API comparten origen.

**Sin backend (modo demo):** abrir `frontend/index.html` en el navegador, o servir la carpeta:

```bash
cd frontend && python3 -m http.server 8080   # http://localhost:8080
```

Usuarios de prueba (los del `db/seed.sql`), contraseña `123456`:
`admin@atelier.com` · `vendedor@atelier.com` · `cliente@atelier.com`.

## Datos: API real o modo demo

`src/js/api.js` consulta cada recurso en la API; si el endpoint aún no existe usa los datos
de `src/js/data.js` (espejo del seed). El indicador del encabezado muestra
**Datos en vivo**, **API parcial (n/4)** o **Modo demo**.

| Recurso | Endpoint esperado | Estado |
|---|---|---|
| Variantes con stock | `GET /api/inventario` | pendiente (#10) |
| Pedidos | `GET /api/pedidos`, `POST /api/pedidos` | PR #11 |
| Compras | `GET /api/compras`, `PATCH /api/compras/:id` | Fase 4 |
| Proveedores | `GET /api/proveedores` | Fase 4 |

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
└── src/
    ├── css/styles.css    # paleta del prototipo + reglas responsive
    └── js/
        ├── utils.js      # formato de moneda, escape HTML, toast, sesión
        ├── data.js       # datos de respaldo (modo demo)
        ├── api.js        # carga desde la API con respaldo
        ├── app.js        # sesión, roles, navegación y router por hash
        └── views/        # login, dashboard, pos, inventario, catalogo, compras
```

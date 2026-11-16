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
| — | Acceso del personal con validación visual de campos obligatorios | administrador, vendedor | RF-01 (provisional) |
| `#/pos` | **Vista principal.** Venta en mostrador: prendas, cantidades y confirmación contra `POST /api/pedidos` | administrador, vendedor | RF-11, RF-12 |
| `#/dashboard` | Resumen: ventas del día, últimas ventas y variantes por reponer | administrador, vendedor | RF-10 |
| `#/inventario` | Existencias por variante (SKU, talla, color, stock y mínimo) con filtros por categoría, talla, color y estado | administrador, vendedor | RF-06, RF-07, RF-09, RF-10 |
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

Cuentas de prueba del personal, contraseña `123456`: `admin@atelier.com` y
`vendedor@atelier.com`. También aparecen en el login para llenarlo con un clic.

## Datos: API real o modo demo

`src/js/api.js` consulta cada recurso en la API; si el endpoint aún no existe usa los datos
de `src/js/data.js` (espejo del seed). El indicador del encabezado muestra
**Conectado a la base de datos**, **Conexión parcial (n de 4)** o **Datos de prueba**.

| Recurso | Endpoint esperado | Estado |
|---|---|---|
| Variantes con stock | `GET /api/inventario` | pendiente (PR #15) |
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
    ├── css/styles.css    # paleta del equipo (#9314EB, #129AED, blanco, negro) + responsive
    ├── fonts/            # Bricolage Grotesque y Hanken Grotesk (OFL), sin depender de internet
    └── js/
        ├── utils.js      # formato de moneda, escape HTML, toast, sesión
        ├── data.js       # datos de respaldo (modo demo)
        ├── api.js        # carga desde la API con respaldo
        ├── app.js        # sesión, roles, navegación y router por hash
        └── views/        # login, pos, dashboard, inventario, compras
```

# ATELIER — ERP para Tienda de Ropa

![Estado](https://img.shields.io/badge/estado-en%20desarrollo-yellow)
![Universidad](https://img.shields.io/badge/UMB-Sistema%20Transaccional-red)

**ATELIER** es un sistema transaccional tipo ERP (Enterprise Resource Planning) para la gestión integral de una tienda de ropa. La plataforma centraliza la administración de productos, inventario, ventas, compras a proveedores y reportes gerenciales, garantizando la consistencia de la información y la trazabilidad de las operaciones.

Proyecto académico desarrollado en la **Universidad Manuela Beltrán** — asignatura Sistema Transaccional, Grupo 6.

---

## Objetivo general

Desarrollar un ERP que permita gestionar de manera eficiente e integrada los procesos de una tienda de ropa —catálogo de productos, inventario, ventas, compras a proveedores y análisis de datos—, garantizando la consistencia de la información, la trazabilidad de las operaciones y la generación de reportes de apoyo a la toma de decisiones.

## Módulos del sistema

| Módulo | Descripción |
|---|---|
| Autenticación y usuarios | Registro, inicio de sesión y administración de usuarios y roles |
| Catálogo de productos | CRUD de productos, categorías, tallas, colores y precios |
| Inventario | Entradas, salidas, actualización automática de stock y alertas de stock mínimo |
| Ventas | Carrito de compras, registro de pedidos, seguimiento de estados e historial |
| Compras | Gestión de proveedores y compras con recepción de mercancía |
| Reportes gerenciales | Tableros de indicadores integrados con Power BI |

## Roles de usuario

- **Cliente / Vendedor:** registrarse e iniciar sesión, consultar productos y disponibilidad en tiempo real, filtrar por categoría, talla, color y precio, agregar productos al carrito, realizar compras y consultar su historial de pedidos.
- **Administrador:** gestionar productos (CRUD), administrar categorías, tallas y colores, controlar inventario (entradas, salidas, stock mínimo), gestionar ventas, pedidos y compras a proveedores, administrar usuarios y roles, y visualizar reportes gerenciales (Power BI).

## Stack tecnológico

- **Frontend:** React *(Fase 4)*
- **Backend:** Node.js + Express (API REST)
- **Base de datos:** PostgreSQL 14+
- **Analítica:** Microsoft Power BI
- **Control de versiones:** Git + GitHub

## Estructura del repositorio

```
ST_G6_ATELIER/
├── docs/                  # Documentación de análisis y diseño (Fases 1-2)
│   ├── analisis-y-diseno-ATELIER.md
│   ├── ATELIER_Analisis_y_Diseno.pdf
│   └── diagrams/
├── db/                    # Base de datos (Fase 3)
│   ├── schema.sql         # Creación de BD, tablas, claves, restricciones y triggers
│   └── seed.sql           # Datos iniciales de prueba
└── backend/               # API REST (Fase 3: estructura inicial)
    ├── server.js
    ├── package.json
    ├── .env.example
    └── src/
        ├── config/db.js   # Conexión a PostgreSQL
        └── routes/        # Rutas (módulos CRUD en Fase 4)
```

## Ejecución

### 1. Base de datos (PostgreSQL 14+)

```bash
psql -U postgres -f db/schema.sql                  # crea atelier_db, tablas, claves y triggers
psql -U postgres -d atelier_db -f db/seed.sql      # datos iniciales de prueba
```

### 2. Backend (Node.js 18+)

```bash
cd backend
npm install
cp .env.example .env        # completar DB_PASSWORD
npm run dev
```

### 3. Verificación

- API: `http://localhost:3000/api/health` → `{ "api": "ATELIER operativa", "base_de_datos": true }`
- El script SQL de verificación al final de `db/seed.sql` muestra los stocks actualizados automáticamente por los triggers.

## Metodología

El proyecto se desarrolla bajo el modelo de ciclo de vida en cascada (SDLC):

- [x] **Fase 1 — Planificación:** alcance, factibilidad, riesgos, costos y cronograma
- [x] **Fase 2 — Análisis y diseño:** requisitos, casos de uso, modelo de clases y modelo relacional
- [x] **Fase 3 — Construcción inicial:** base de datos y estructura del backend
- [ ] **Fase 4 — Implementación:** operaciones CRUD e integración frontend
- [ ] **Fase 5 — Pruebas**
- [ ] **Fase 6 — Despliegue y documentación final**

## Documentación

- `docs/ATELIER_Analisis_y_Diseno.pdf` — documento de análisis y diseño (entrega Fase 2).
- `docs/analisis-y-diseno-ATELIER.md` — fuente editable del mismo documento.

## Autores

- **Juan Esteban Cabral Bautista**
- **Laura Valentina Ruiz Vaca**
- **Steven Rusinque Gutierrez**

Universidad Manuela Beltrán — Grupo 6
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

## Stack tecnológico (propuesto)

- **Frontend:** React
- **Backend:** Node.js / Python (API REST)
- **Base de datos:** PostgreSQL / MySQL
- **Analítica:** Microsoft Power BI
- **Control de versiones:** Git + GitHub

## Metodología

El proyecto se desarrolla bajo el modelo de ciclo de vida en cascada (SDLC):

- [x] **Fase 1 — Planificación:** alcance, factibilidad, riesgos, costos y cronograma
- [x] **Fase 2 — Análisis de requisitos:** RF, RNF, reglas de negocio y casos de uso
- [ ] **Fase 3 — Diseño:** arquitectura, UML y modelo de datos
- [ ] **Fase 4 — Implementación**
- [ ] **Fase 5 — Pruebas**
- [ ] **Fase 6 — Despliegue y documentación**

## Documentación

La documentación inicial del proyecto (fases 1 y 2 del SDLC) se encuentra en la carpeta `/docs`.

## Autores

- **Juan Esteban Cabral Bautista**
- **Laura Valentina Ruiz Vaca**
- **Steven Rusinque Gutierrez**

Universidad Manuela Beltrán — Grupo 6
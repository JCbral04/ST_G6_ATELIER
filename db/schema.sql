-- =============================================================
-- ATELIER - ERP para Tienda de Ropa
-- Fase 3: Script de creación de la base de datos
-- Motor: PostgreSQL 14+ | Basado en el modelo relacional (Fase 2)
-- Ejecutar:  psql -U postgres -f db/schema.sql
-- =============================================================

-- 1. Base de datos
CREATE DATABASE atelier_db;

\c atelier_db

-- Extension para contraseñas (preparación para Fase 4)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================
-- 2. Tablas principales (en orden de dependencia)
-- =============================================================

CREATE TABLE categoria (
    id_categoria SERIAL PRIMARY KEY,
    nombre       VARCHAR(60)  NOT NULL UNIQUE,
    descripcion  TEXT
);

CREATE TABLE talla (
    id_talla SERIAL PRIMARY KEY,
    etiqueta VARCHAR(10) NOT NULL UNIQUE   -- XS, S, M, L, XL
);

CREATE TABLE color (
    id_color  SERIAL PRIMARY KEY,
    nombre    VARCHAR(40) NOT NULL UNIQUE,
    codigo_hex CHAR(7)    NOT NULL          -- ej.: #1F4E4E
);

CREATE TABLE usuario (
    id_usuario       SERIAL PRIMARY KEY,
    nombre           VARCHAR(100) NOT NULL,
    correo           VARCHAR(120) NOT NULL UNIQUE,
    contrasena_hash  VARCHAR(255) NOT NULL,          -- cifrado con pgcrypto (Fase 4)
    rol              VARCHAR(20)  NOT NULL
        CHECK (rol IN ('cliente', 'vendedor', 'administrador')),
    fecha_registro   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE producto (
    id_producto  SERIAL PRIMARY KEY,
    nombre       VARCHAR(120)    NOT NULL,
    descripcion  TEXT,
    precio       NUMERIC(10,2)   NOT NULL CHECK (precio > 0),
    imagen_url   VARCHAR(255),
    stock_minimo INT             NOT NULL DEFAULT 5 CHECK (stock_minimo >= 0),
    activo       BOOLEAN         NOT NULL DEFAULT TRUE,
    id_categoria INT             NOT NULL REFERENCES categoria(id_categoria)
);

CREATE TABLE variante_producto (
    id_variante  SERIAL PRIMARY KEY,
    sku          VARCHAR(40) NOT NULL UNIQUE,
    stock        INT         NOT NULL DEFAULT 0 CHECK (stock >= 0),
    id_producto  INT         NOT NULL REFERENCES producto(id_producto),
    id_talla     INT         NOT NULL REFERENCES talla(id_talla),
    id_color     INT         NOT NULL REFERENCES color(id_color),
    UNIQUE (id_producto, id_talla, id_color)        -- no variantes duplicadas
);

CREATE TABLE pedido (
    id_pedido  SERIAL PRIMARY KEY,
    fecha      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado     VARCHAR(20)    NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'confirmado', 'despachado', 'entregado', 'cancelado')),
    total      NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (total >= 0),
    id_usuario INT            NOT NULL REFERENCES usuario(id_usuario)
);

CREATE TABLE detalle_pedido (
    id_detalle      SERIAL PRIMARY KEY,
    cantidad        INT            NOT NULL CHECK (cantidad > 0),
    precio_unitario NUMERIC(10,2)  NOT NULL CHECK (precio_unitario > 0),
    subtotal        NUMERIC(12,2)  NOT NULL CHECK (subtotal >= 0),
    id_pedido       INT            NOT NULL REFERENCES pedido(id_pedido),
    id_variante     INT            NOT NULL REFERENCES variante_producto(id_variante)
);

CREATE TABLE movimiento_inventario (
    id_movimiento SERIAL PRIMARY KEY,
    tipo          VARCHAR(10)  NOT NULL CHECK (tipo IN ('entrada', 'salida')),
    cantidad      INT          NOT NULL CHECK (cantidad > 0),
    motivo        VARCHAR(200) NOT NULL,
    fecha         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    id_variante   INT          NOT NULL REFERENCES variante_producto(id_variante),
    id_usuario    INT          NOT NULL REFERENCES usuario(id_usuario)
);

CREATE TABLE proveedor (
    id_proveedor SERIAL PRIMARY KEY,
    nombre       VARCHAR(120) NOT NULL,
    contacto     VARCHAR(100),
    correo       VARCHAR(120) UNIQUE,
    telefono     VARCHAR(20)
);

CREATE TABLE compra (
    id_compra    SERIAL PRIMARY KEY,
    fecha        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado       VARCHAR(20)   NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'recibida', 'cancelada')),
    total        NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
    id_proveedor INT           NOT NULL REFERENCES proveedor(id_proveedor)
);

CREATE TABLE detalle_compra (
    id_detalle      SERIAL PRIMARY KEY,
    cantidad        INT            NOT NULL CHECK (cantidad > 0),
    costo_unitario  NUMERIC(10,2)  NOT NULL CHECK (costo_unitario > 0),
    subtotal        NUMERIC(12,2)  NOT NULL CHECK (subtotal >= 0),
    id_compra       INT            NOT NULL REFERENCES compra(id_compra),
    id_variante     INT            NOT NULL REFERENCES variante_producto(id_variante)
);

-- =============================================================
-- 3. Triggers de actualización automática de stock
--    (regla de negocio RN del catálogo: ventas y compras)
-- =============================================================

-- Venta: al agregar un detalle de pedido, descuenta stock
CREATE OR REPLACE FUNCTION fn_stock_venta() RETURNS TRIGGER AS $$
BEGIN
    UPDATE variante_producto
    SET stock = stock - NEW.cantidad
    WHERE id_variante = NEW.id_variante;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_venta
    AFTER INSERT ON detalle_pedido
    FOR EACH ROW EXECUTE FUNCTION fn_stock_venta();

-- Compra: al pasar a estado 'recibida', incrementa stock
CREATE OR REPLACE FUNCTION fn_stock_compra() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.estado <> 'recibida' AND NEW.estado = 'recibida' THEN
        UPDATE variante_producto v
        SET stock = stock + dc.cantidad
        FROM detalle_compra dc
        WHERE dc.id_compra = NEW.id_compra
          AND v.id_variante = dc.id_variante;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_compra
    AFTER UPDATE OF estado ON compra
    FOR EACH ROW EXECUTE FUNCTION fn_stock_compra();
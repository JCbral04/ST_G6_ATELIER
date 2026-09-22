-- =============================================================
-- ATELIER - Datos iniciales de prueba
-- Ejecutar DESPUÉS de schema.sql:
--   psql -U postgres -d atelier_db -f db/seed.sql
-- =============================================================

\c atelier_db

-- Catálogos base
INSERT INTO categoria (nombre, descripcion) VALUES
('Camisetas', 'Camisetas básicas y estampadas'),
('Pantalones', 'Jeans, joggers y pantalones de vestir'),
('Chaquetas', 'Chaquetas y prendas de abrigo'),
('Accesorios', 'Gorras, cinturones y complementos');

INSERT INTO talla (etiqueta) VALUES ('XS'), ('S'), ('M'), ('L'), ('XL');

INSERT INTO color (nombre, codigo_hex) VALUES
('Negro',  '#000000'),
('Blanco', '#FFFFFF'),
('Azul',   '#1F4E79'),
('Rojo',   '#C00000');

-- Usuarios de prueba (contraseña: '123456' -> reemplazar con hash real en Fase 4)
INSERT INTO usuario (nombre, correo, contrasena_hash, rol) VALUES
('Admin ATELIER',      'admin@atelier.com',    crypt('123456', gen_salt('bf')), 'administrador'),
('Cliente de prueba',  'cliente@atelier.com',  crypt('123456', gen_salt('bf')), 'cliente'),
('Vendedor de prueba', 'vendedor@atelier.com', crypt('123456', gen_salt('bf')), 'vendedor');

-- Proveedores
INSERT INTO proveedor (nombre, contacto, correo, telefono) VALUES
('Textiles del Norte S.A.S.', 'Carlos Ríos',    'ventas@textilesnorte.co',   '6017458890'),
('Moda Premium Ltda.',        'Andrea Salazar', 'comercial@modapremium.co',  '6013126677');

-- Productos
INSERT INTO producto (nombre, descripcion, precio, imagen_url, stock_minimo, id_categoria) VALUES
('Camiseta básica algodón', 'Camiseta 100% algodón, corte regular', 45000, '/img/camiseta-basica.jpg', 10, 1),
('Jean clásico azul',       'Jean corte recto, tela rígida',      129900, '/img/jean-clasico.jpg',     5, 2),
('Chaqueta denim',          'Chaqueta vaquera unisex',            199900, '/img/chaqueta-denim.jpg',   3, 3);

-- Variantes (producto x talla x color)
INSERT INTO variante_producto (sku, stock, id_producto, id_talla, id_color) VALUES
('CAM-NEG-M',  50, 1, 3, 1),   -- Camiseta negra M
('CAM-BLA-M',  40, 1, 3, 2),   -- Camiseta blanca M
('JEA-AZU-32', 30, 2, 3, 3),   -- Jean azul M
('CHA-AZU-L',  15, 3, 4, 3);   -- Chaqueta azul L

-- Compra a proveedor (se recibe: trigger suma 20 a CAM-NEG-M -> 70)
INSERT INTO compra (id_proveedor, total, estado) VALUES
(1, 700000, 'pendiente');

INSERT INTO detalle_compra (cantidad, costo_unitario, subtotal, id_compra, id_variante) VALUES
(20, 35000, 700000, 1, 1);

UPDATE compra SET estado = 'recibida' WHERE id_compra = 1;   -- dispara trg_stock_compra

-- Movimiento de inventario (trazabilidad de la recepción)
INSERT INTO movimiento_inventario (tipo, cantidad, motivo, id_variante, id_usuario) VALUES
('entrada', 20, 'Compra #1 recibida - Textiles del Norte', 1, 1);

-- Pedido de prueba (trigger descuenta 2 a CAM-NEG-M -> 68)
INSERT INTO pedido (id_usuario, total, estado) VALUES
(2, 90000, 'confirmado');

INSERT INTO detalle_pedido (cantidad, precio_unitario, subtotal, id_pedido, id_variante) VALUES
(2, 45000, 90000, 1, 1);

INSERT INTO movimiento_inventario (tipo, cantidad, motivo, id_variante, id_usuario) VALUES
('salida', 2, 'Venta pedido #1', 1, 3);

-- Verificación rápida
SELECT v.sku, v.stock FROM variante_producto v ORDER BY v.id_variante;
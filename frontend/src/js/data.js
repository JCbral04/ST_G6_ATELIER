/* =============================================================
   ATELIER — datos de respaldo (modo demo)
   Espejo de db/seed.sql DESPUÉS de ejecutar los triggers.
   Se usan solo si la API no responde; cuando el backend expone
   los endpoints (issue #10) la interfaz toma los datos reales.
   ============================================================= */
(function (A) {
  'use strict';

  // En modo demo el pedido del seed aparece como venta de hoy
  function hoyALas(h, m) { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); }

  A.mock = {
    categorias: ['Camisetas', 'Pantalones', 'Chaquetas', 'Accesorios'],
    tallas: ['XS', 'S', 'M', 'L', 'XL'],
    colores: [
      { nombre: 'Negro', codigo_hex: '#000000' },
      { nombre: 'Blanco', codigo_hex: '#FFFFFF' },
      { nombre: 'Azul', codigo_hex: '#1F4E79' },
      { nombre: 'Rojo', codigo_hex: '#C00000' },
    ],

    // Personal de la tienda (login provisional; autenticación real = RF-01, Fase 4).
    // El panel es de uso interno: no hay cuentas de clientes.
    usuarios: [
      { id_usuario: 1, nombre: 'Admin ATELIER', correo: 'admin@atelier.com', rol: 'administrador' },
      { id_usuario: 3, nombre: 'Vendedor de prueba', correo: 'vendedor@atelier.com', rol: 'vendedor' },
    ],

    // Forma esperada de GET /api/inventario (una fila por variante).
    // `imagen` es opcional: si falta, la interfaz dibuja la prenda con su color.
    variantes: [
      { id_variante: 1, sku: 'CAM-NEG-M', id_producto: 1, producto: 'Camiseta básica algodón', categoria: 'Camisetas', talla: 'M', color: 'Negro', codigo_hex: '#000000', precio: 45000, stock: 68, imagen: 'src/img/prendas/camiseta-negra.webp', stock_minimo: 10 },
      { id_variante: 2, sku: 'CAM-BLA-M', id_producto: 1, producto: 'Camiseta básica algodón', categoria: 'Camisetas', talla: 'M', color: 'Blanco', codigo_hex: '#FFFFFF', precio: 45000, stock: 40, imagen: 'src/img/prendas/camiseta-blanca.webp', stock_minimo: 10 },
      { id_variante: 3, sku: 'JEA-AZU-32', id_producto: 2, producto: 'Jean clásico azul', categoria: 'Pantalones', talla: 'M', color: 'Azul', codigo_hex: '#1F4E79', precio: 129900, stock: 30, imagen: 'src/img/prendas/jean-azul.webp', stock_minimo: 5 },
      { id_variante: 4, sku: 'CHA-AZU-L', id_producto: 3, producto: 'Chaqueta denim', categoria: 'Chaquetas', talla: 'L', color: 'Azul', codigo_hex: '#1F4E79', precio: 199900, stock: 15, imagen: 'src/img/prendas/chaqueta-azul.webp', stock_minimo: 3 },
      // Solo demo: dos variantes con stock bajo para visualizar las alertas (RF-10).
      // Propuesta para #10: agregarlas también a db/seed.sql.
      { id_variante: 5, sku: 'CAM-ROJ-S', id_producto: 1, producto: 'Camiseta básica algodón', categoria: 'Camisetas', talla: 'S', color: 'Rojo', codigo_hex: '#C00000', precio: 45000, stock: 8, imagen: 'src/img/prendas/camiseta-roja.webp', stock_minimo: 10 },
      { id_variante: 6, sku: 'JEA-NEG-S', id_producto: 2, producto: 'Jean clásico azul', categoria: 'Pantalones', talla: 'S', color: 'Negro', codigo_hex: '#000000', precio: 129900, stock: 3, imagen: 'src/img/prendas/jean-negro.webp', stock_minimo: 5 },
      // Solo demo: más tallas para que el punto de venta muestre la selección por talla.
      { id_variante: 7, sku: 'CAM-NEG-S', id_producto: 1, producto: 'Camiseta básica algodón', categoria: 'Camisetas', talla: 'S', color: 'Negro', codigo_hex: '#000000', precio: 45000, stock: 12, imagen: 'src/img/prendas/camiseta-negra.webp', stock_minimo: 10 },
      { id_variante: 8, sku: 'CAM-NEG-L', id_producto: 1, producto: 'Camiseta básica algodón', categoria: 'Camisetas', talla: 'L', color: 'Negro', codigo_hex: '#000000', precio: 45000, stock: 25, imagen: 'src/img/prendas/camiseta-negra.webp', stock_minimo: 10 },
      { id_variante: 9, sku: 'JEA-AZU-L', id_producto: 2, producto: 'Jean clásico azul', categoria: 'Pantalones', talla: 'L', color: 'Azul', codigo_hex: '#1F4E79', precio: 129900, stock: 18, imagen: 'src/img/prendas/jean-azul.webp', stock_minimo: 5 },
      { id_variante: 10, sku: 'CHA-AZU-M', id_producto: 3, producto: 'Chaqueta denim', categoria: 'Chaquetas', talla: 'M', color: 'Azul', codigo_hex: '#1F4E79', precio: 199900, stock: 9, imagen: 'src/img/prendas/chaqueta-azul.webp', stock_minimo: 3 },
      { id_variante: 11, sku: 'CHA-NEG-L', id_producto: 3, producto: 'Chaqueta denim', categoria: 'Chaquetas', talla: 'L', color: 'Negro', codigo_hex: '#000000', precio: 199900, stock: 0, imagen: 'src/img/prendas/chaqueta-negra.webp', stock_minimo: 3 },
    ],

    // Misma forma que GET /api/pedidos (PR #11)
    pedidos: [
      { id_pedido: 1, fecha: hoyALas(9, 12), estado: 'confirmado', total: 90000, usuario: 'Vendedor de prueba' },
      // Solo demo: más ventas de hoy para que el resumen muestre varios tiquetes.
      { id_pedido: 2, fecha: hoyALas(10, 47), estado: 'confirmado', total: 199900, usuario: 'Admin ATELIER' },
      { id_pedido: 3, fecha: hoyALas(11, 20), estado: 'pendiente', total: 174900, usuario: 'Vendedor de prueba' },
    ],

    // Forma esperada de GET /api/compras
    compras: [
      { id_compra: 1, fecha: '2026-10-15T10:00:00', estado: 'recibida', total: 700000, proveedor: 'Textiles del Norte S.A.S.',
        items: [{ sku: 'CAM-NEG-M', cantidad: 20, costo_unitario: 35000 }] },
      { id_compra: 2, fecha: '2026-10-17T15:30:00', estado: 'pendiente', total: 900000, proveedor: 'Moda Premium Ltda.',
        items: [{ sku: 'CAM-ROJ-S', cantidad: 20, costo_unitario: 45000 }] },
    ],

    // Forma esperada de GET /api/proveedores
    proveedores: [
      { id_proveedor: 1, nombre: 'Textiles del Norte S.A.S.', contacto: 'Carlos Ríos', correo: 'ventas@textilesnorte.co', telefono: '311 745 8890' },
      { id_proveedor: 2, nombre: 'Moda Premium Ltda.', contacto: 'Andrea Salazar', correo: 'comercial@modapremium.co', telefono: '322 312 6677' },
    ],
  };
})(window.Atelier);

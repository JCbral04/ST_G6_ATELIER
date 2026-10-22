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

    // Usuarios del seed (para el login provisional; autenticación real = RF-01, Fase 4)
    usuarios: [
      { id_usuario: 1, nombre: 'Admin ATELIER', correo: 'admin@atelier.com', rol: 'administrador' },
      { id_usuario: 2, nombre: 'Cliente de prueba', correo: 'cliente@atelier.com', rol: 'cliente' },
      { id_usuario: 3, nombre: 'Vendedor de prueba', correo: 'vendedor@atelier.com', rol: 'vendedor' },
    ],

    // Forma esperada de GET /api/inventario (una fila por variante)
    variantes: [
      { id_variante: 1, sku: 'CAM-NEG-M', id_producto: 1, producto: 'Camiseta básica algodón', categoria: 'Camisetas', talla: 'M', color: 'Negro', codigo_hex: '#000000', precio: 45000, stock: 68, stock_minimo: 10 },
      { id_variante: 2, sku: 'CAM-BLA-M', id_producto: 1, producto: 'Camiseta básica algodón', categoria: 'Camisetas', talla: 'M', color: 'Blanco', codigo_hex: '#FFFFFF', precio: 45000, stock: 40, stock_minimo: 10 },
      { id_variante: 3, sku: 'JEA-AZU-32', id_producto: 2, producto: 'Jean clásico azul', categoria: 'Pantalones', talla: 'M', color: 'Azul', codigo_hex: '#1F4E79', precio: 129900, stock: 30, stock_minimo: 5 },
      { id_variante: 4, sku: 'CHA-AZU-L', id_producto: 3, producto: 'Chaqueta denim', categoria: 'Chaquetas', talla: 'L', color: 'Azul', codigo_hex: '#1F4E79', precio: 199900, stock: 15, stock_minimo: 3 },
      // Solo demo: dos variantes con stock bajo para visualizar las alertas (RF-10).
      // Propuesta para #10: agregarlas también a db/seed.sql.
      { id_variante: 5, sku: 'CAM-ROJ-S', id_producto: 1, producto: 'Camiseta básica algodón', categoria: 'Camisetas', talla: 'S', color: 'Rojo', codigo_hex: '#C00000', precio: 45000, stock: 8, stock_minimo: 10 },
      { id_variante: 6, sku: 'JEA-NEG-S', id_producto: 2, producto: 'Jean clásico azul', categoria: 'Pantalones', talla: 'S', color: 'Negro', codigo_hex: '#000000', precio: 129900, stock: 3, stock_minimo: 5 },
    ],

    // Misma forma que GET /api/pedidos (PR #11)
    pedidos: [
      { id_pedido: 1, fecha: hoyALas(9, 12), estado: 'confirmado', total: 90000, usuario: 'Cliente de prueba' },
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

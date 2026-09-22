const { Router } = require('express');
const { pool } = require('../config/db');

const router = Router();

// Health check (verificación de que API + BD responden)
router.get('/health', async (req, res) => {
  try {
    const db = await pool.query('SELECT 1 AS ok');
    res.json({ api: 'ATELIER operativa', base_de_datos: db.rows[0].ok === 1 });
  } catch (err) {
    res.status(500).json({ api: 'ATELIER operativa', base_de_datos: false });
  }
});

// Módulos pendientes para Fase 4 (operaciones CRUD):
// router.use('/auth', require('./auth.routes'));          // RF-01..03 autenticación
// router.use('/productos', require('./producto.routes')); // RF-04..08 catálogo
// router.use('/pedidos', require('./pedido.routes'));     // RF-09..12 ventas
// router.use('/inventario', require('./inventario.routes')); // RF-13..15 inventario
// router.use('/compras', require('./compra.routes'));     // RF-16..18 compras/proveedores

module.exports = router;
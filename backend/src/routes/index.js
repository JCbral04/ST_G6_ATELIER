const { Router } = require('express');
const { pool } = require('../config/db');

const router = Router();

// Health check (verificación de que API + BD responden)
router.get('/health', async (req, res) => {
  try {
    const db = await pool.query('SELECT 1 AS ok');
    res.json({ api: 'ATELIER operativa', base_de_datos: db.rows[0].ok === 1 });
  } catch (err) {
    console.error('Error en health check:', err.message);
    res.status(500).json({ api: 'ATELIER operativa', base_de_datos: false });
  }
});

// Módulos pendientes para Fase 4 (operaciones CRUD):
// router.use('/productos', require('./producto.routes'));  // RF-04..08 catálogo
// router.use('/inventario', require('./inventario.routes')); // RF-13..15 inventario
// router.use('/compras', require('./compra.routes'));      // RF-16..18 compras/proveedores

// Módulos activos
router.use('/pedidos', require('./pedido.routes'));
router.use('/auth', require('./auth.routes'));
router.use('/inventario/movimientos', require('./movimiento.routes')); // Issue #26
router.use('/auditoria', require('./auditoria.routes')); // Issue #27 (RNF-09)

// Microservicio de IA
router.use('/ia', require('./ia.routes'));

module.exports = router;
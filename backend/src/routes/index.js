const { Router } = require('express');
const { pool } = require('../config/db');
const gestionRoutes = require('./gestion.routes');

const router = Router();

// Health check (verificación de que API + BD responden)
router.get('/health', async (req, res) => {
  try {
    const db = await pool.query('SELECT 1 AS ok');
    res.json({ api: 'ATELIER operativa', base_de_datos: db.rows[0].ok === 1 });
  } catch (err) {
    console.error('Error en health check:', err.message);
    res.status(500).json({
      api: 'ATELIER operativa',
      base_de_datos: false,
      status: 'error',
      message: 'Error de conexión a la base de datos',
    });
  }
});

// Módulos activos
router.use('/pedidos', require('./pedido.routes'));
router.use('/auth', require('./auth.routes'));
router.use('/inventario/movimientos', require('./movimiento.routes')); // Issue #26
router.use('/auditoria', require('./auditoria.routes')); // Issue #27 (RNF-09)
router.use('/compras', require('./compra.routes'));
router.use('/proveedores', require('./proveedor.routes'));

// Rutas de gestión de información (RF-06, RF-09, RF-10)
router.use('/', gestionRoutes);

// Microservicio de IA
router.use('/ia', require('./ia.routes'));

module.exports = router;
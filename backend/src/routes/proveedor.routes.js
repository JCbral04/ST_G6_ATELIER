const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
const { autenticar, permitirRoles } = require('../middleware/auth');

const router = Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 100,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intenta más tarde' } }));
router.use(autenticar, permitirRoles('administrador'));

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`SELECT id_proveedor, nombre, contacto, correo, telefono
      FROM proveedor ORDER BY nombre, id_proveedor`);
    return res.json(result.rows);
  } catch (err) {
    console.error('Error al consultar proveedores:', err.code);
    return res.status(500).json({ error: 'No se pudieron consultar los proveedores' });
  }
});
module.exports = router;

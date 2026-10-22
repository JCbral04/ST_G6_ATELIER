const { Router } = require('express');
const { pool } = require('../config/db');
const gestionRoutes = require('./gestion.routes');

const router = Router();

// Endpoint de estado
router.get('/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({
      status: 'ok',
      timestamp: result.rows[0].now
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// Rutas de gestión de información (RF-06, RF-09, RF-10)
router.use('/', gestionRoutes);

module.exports = router;

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
    res.status(500).json({ api: 'ATELIER operativa', base_de_datos: false });
  }
});

// Rutas de gestión de información (RF-06, RF-09, RF-10)
router.use('/', gestionRoutes);

module.exports = router;
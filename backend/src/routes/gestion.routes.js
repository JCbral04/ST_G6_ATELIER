const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { getProductosConStock, getAlertasStockBajo } = require('../controllers/productoController');

const router = Router();

// Limita a máximo 100 solicitudes por IP cada 15 minutos
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

// Rutas con rate limiting
router.get('/productos', limiter, getProductosConStock);
router.get('/inventario/alertas', limiter, getAlertasStockBajo);

module.exports = router;
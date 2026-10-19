const { Router } = require('express');
const { getProductosConStock, getAlertasStockBajo } = require('../controllers/productoController');

const router = Router();

// Ruta para ver productos con su stock (Tarea 2)
router.get('/productos', getProductosConStock);

// Ruta para ver alertas de stock bajo (Tarea 3)
router.get('/inventario/alertas', getAlertasStockBajo);

module.exports = router;
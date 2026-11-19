const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
const { autenticar, permitirRoles } = require('../middleware/auth');
const router = Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));
router.use(autenticar, permitirRoles('administrador'));

router.post('/reposicion', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { horizon_days = 15, lead_days = 7 } = req.body || {};
  if (!Number.isSafeInteger(horizon_days) || !Number.isSafeInteger(lead_days) ||
      lead_days < 1 || horizon_days < lead_days || horizon_days > 30) {
    return res.status(400).json({ error: 'Horizonte y plazo deben ser enteros válidos (1–30 días).' });
  }
  try {
    if (!process.env.AI_INTERNAL_KEY) throw new Error('IA sin configurar');
    const base = (process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
    const response = await fetch(`${base}/api/v1/predict/restock`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': process.env.AI_INTERNAL_KEY },
      body: JSON.stringify({ horizon_days, lead_days }), signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error('Servicio de IA no disponible');
    return res.json(await response.json());
  } catch (err) {
    console.warn('ATELIER IA no disponible; usando alertas estáticas');
    try {
      const result = await pool.query(`SELECT v.id_variante,v.sku,p.nombre AS producto,c.nombre AS categoria,
        v.stock,p.stock_minimo,COALESCE(t.cantidad,0) AS transito,
        GREATEST(0,p.stock_minimo-v.stock-COALESCE(t.cantidad,0)) AS cantidad_sugerida
        FROM variante_producto v JOIN producto p ON p.id_producto=v.id_producto
        JOIN categoria c ON c.id_categoria=p.id_categoria
        LEFT JOIN (SELECT d.id_variante,SUM(d.cantidad) AS cantidad FROM detalle_compra d JOIN compra c ON c.id_compra=d.id_compra
          WHERE c.estado='pendiente' GROUP BY d.id_variante) t ON t.id_variante=v.id_variante
        WHERE p.activo AND v.stock<=p.stock_minimo ORDER BY v.stock,v.sku`);
      return res.json({ modo: 'alerta_estatica', advertencias: ['IA no disponible; resultados basados en stock mínimo, no son predicciones.'], items: result.rows });
    } catch (_) {
      return res.status(503).json({ error: 'No fue posible consultar la reposición.' });
    }
  }
});
module.exports = router;

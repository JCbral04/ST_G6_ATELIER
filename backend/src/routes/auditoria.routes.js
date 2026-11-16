const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
const { autenticar, permitirRoles } = require('../middleware/auth');

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intenta más tarde' },
});

router.use(limiter);
router.use(autenticar);
router.use(permitirRoles('administrador'));

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

// GET /api/auditoria — consulta de bitácora (solo administrador)
// Filtros opcionales: ?entidad=pedido&fecha_desde=2026-11-01&fecha_hasta=2026-11-30&limite=100
router.get('/', async (req, res) => {
  const filtros = [];
  const valores = [];

  if (req.query.entidad !== undefined && req.query.entidad !== '') {
    if (typeof req.query.entidad !== 'string' || req.query.entidad.trim().length > 50) {
      return res.status(400).json({ error: 'El parámetro entidad no es válido' });
    }
    valores.push(req.query.entidad.trim());
    filtros.push(`a.entidad = $${valores.length}`);
  }

  const fechaDesde = req.query.fecha_desde || req.query.desde;
  if (fechaDesde !== undefined && fechaDesde !== '') {
    const valor = String(fechaDesde).trim();
    if (!FECHA_REGEX.test(valor) || Number.isNaN(Date.parse(valor))) {
      return res.status(400).json({ error: 'fecha_desde debe tener formato YYYY-MM-DD o ISO-8601' });
    }
    valores.push(valor);
    filtros.push(`a.fecha >= $${valores.length}::timestamptz`);
  }

  const fechaHasta = req.query.fecha_hasta || req.query.hasta;
  if (fechaHasta !== undefined && fechaHasta !== '') {
    const valor = String(fechaHasta).trim();
    if (!FECHA_REGEX.test(valor) || Number.isNaN(Date.parse(valor))) {
      return res.status(400).json({ error: 'fecha_hasta debe tener formato YYYY-MM-DD o ISO-8601' });
    }
    valores.push(valor);
    if (valor.length === 10) {
      filtros.push(`a.fecha < ($${valores.length}::date + INTERVAL '1 day')`);
    } else {
      filtros.push(`a.fecha <= $${valores.length}::timestamptz`);
    }
  }

  let limite = 100;
  if (req.query.limite !== undefined) {
    const parsed = Number(req.query.limite);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
      return res.status(400).json({ error: 'limite debe ser un entero entre 1 y 500' });
    }
    limite = parsed;
  }
  valores.push(limite);

  try {
    const result = await pool.query(
      `SELECT a.id,
              a.id_usuario,
              u.nombre AS usuario,
              a.accion,
              a.entidad,
              a.id_entidad,
              a.detalle,
              a.fecha
       FROM auditoria a
       JOIN usuario u ON u.id_usuario = a.id_usuario
       ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''}
       ORDER BY a.fecha DESC, a.id DESC
       LIMIT $${valores.length}`,
      valores
    );

    return res.json(result.rows);
  } catch (err) {
    console.error('Error al consultar la bitácora de auditoría:', err.message);
    return res.status(500).json({ error: 'Error al consultar la bitácora de auditoría' });
  }
});

module.exports = router;
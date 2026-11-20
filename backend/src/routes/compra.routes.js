const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { pool } = require('../config/db');
const { autenticar, permitirRoles } = require('../middleware/auth');
const { registrarAuditoria } = require('../middleware/auditoria');

const router = Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 100,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intenta más tarde' } }));
router.use(autenticar, permitirRoles('administrador'));

const MAX_INT = 2147483647;
const MAX_TOTAL_CENTS = 999999999999n; // NUMERIC(12,2)
const entero = (n) => Number.isInteger(n) && n > 0 && n <= MAX_INT;
const dinero = (cents) => `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;

// NUMERIC(10,2): se aceptan números JSON positivos, con hasta dos decimales.
// BigInt mantiene exactitud durante el cálculo de subtotales y total.
function costoCentavos(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const m = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!m) return null;
  const cents = BigInt(m[1]) * 100n + BigInt((m[2] || '').padEnd(2, '0'));
  return cents > 0n ? cents : null;
}

function validarOrden(body) {
  if (!body || !entero(body.id_proveedor) || !Array.isArray(body.items) ||
      body.items.length < 1 || body.items.length > 100) return null;
  const vistos = new Set();
  const lineas = [];
  let total = 0n;
  for (const item of body.items) {
    if (!item || !entero(item.id_variante) || !entero(item.cantidad) ||
        vistos.has(item.id_variante)) return null;
    const costo = costoCentavos(item.costo_unitario);
    if (costo === null) return null;
    const subtotal = costo * BigInt(item.cantidad);
    total += subtotal;
    if (total > MAX_TOTAL_CENTS) return null;
    vistos.add(item.id_variante);
    lineas.push({ id: item.id_variante, cantidad: item.cantidad,
      costo: dinero(costo), subtotal: dinero(subtotal) });
  }
  return { proveedor: body.id_proveedor, lineas, total: dinero(total) };
}

// Solo responde después de COMMIT; las salidas por error también hacen rollback.
class ErrorCompra extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
async function transaccion(res, status, operacion) {
  let client;
  let destroy = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const respuesta = await operacion(client);
    await client.query('COMMIT');
    return res.status(status).json(respuesta);
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) { destroy = true; console.error('Rollback compra:', rollbackError.code); }
    }
    if (err instanceof ErrorCompra) return res.status(err.status).json({ error: err.message });
    console.error('Error en transacción de compra:', err.code);
    return res.status(500).json({ error: 'No se pudo completar la operación de compra' });
  } finally {
    if (client) client.release(destroy);
  }
}

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id_compra, c.fecha, c.estado, c.total, p.nombre AS proveedor,
        COALESCE((SELECT json_agg(json_build_object(
          'id_variante', d.id_variante, 'sku', v.sku,
          'cantidad', d.cantidad, 'costo_unitario', d.costo_unitario
        ) ORDER BY d.id_detalle)
        FROM detalle_compra d JOIN variante_producto v USING (id_variante)
        WHERE d.id_compra = c.id_compra), '[]'::json) AS items
      FROM compra c JOIN proveedor p USING (id_proveedor)
      ORDER BY c.fecha DESC, c.id_compra DESC`);
    return res.json(result.rows.map(row => ({ ...row, total: Number(row.total) })));
  } catch (err) {
    console.error('Error al consultar compras:', err.code);
    return res.status(500).json({ error: 'No se pudieron consultar las compras' });
  }
});

router.post('/', async (req, res) => {
  const orden = validarOrden(req.body);
  if (!orden) return res.status(400).json({ error: 'Proveedor e ítems válidos requeridos (1-100 líneas, variantes únicas, cantidad entera y costo positivo con hasta dos decimales; total dentro del límite)' });
  return transaccion(res, 201, async (client) => {
    const proveedor = await client.query('SELECT id_proveedor FROM proveedor WHERE id_proveedor = $1 FOR KEY SHARE', [orden.proveedor]);
    if (!proveedor.rowCount) throw new ErrorCompra(404, 'Proveedor no encontrado');
    const ids = orden.lineas.map(l => l.id);
    const variantes = await client.query(`SELECT v.id_variante FROM variante_producto v
      JOIN producto p USING (id_producto)
      WHERE v.id_variante = ANY($1::int[]) AND p.activo = true
      ORDER BY v.id_variante FOR KEY SHARE OF v`, [ids]);
    if (variantes.rowCount !== ids.length) throw new ErrorCompra(404, 'Alguna variante no existe o está inactiva');
    const compra = await client.query(`INSERT INTO compra (id_proveedor, total, estado)
      VALUES ($1, $2, 'pendiente') RETURNING id_compra, total, estado`, [orden.proveedor, orden.total]);
    const row = compra.rows[0];
    for (const l of orden.lineas) {
      await client.query(`INSERT INTO detalle_compra (id_compra, id_variante, cantidad, costo_unitario, subtotal)
        VALUES ($1, $2, $3, $4, $5)`, [row.id_compra, l.id, l.cantidad, l.costo, l.subtotal]);
    }
    await registrarAuditoria(client, {
      id_usuario: req.usuario.id_usuario,
      accion: 'CREAR',
      entidad: 'compra',
      id_entidad: row.id_compra,
      detalle: {
        id_proveedor: orden.proveedor,
        total: Number(row.total),
        estado: row.estado,
        lineas: orden.lineas.length,
      },
    });
    return { ...row, total: Number(row.total) };
  });
});

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!/^[1-9]\d*$/.test(req.params.id) || !entero(id) || req.body?.estado !== 'recibida') {
    return res.status(400).json({ error: 'ID válido y estado recibida requeridos' });
  }
  return transaccion(res, 200, async (client) => {
    const compra = await client.query('SELECT estado FROM compra WHERE id_compra = $1 FOR UPDATE', [id]);
    if (!compra.rowCount) throw new ErrorCompra(404, 'Compra no encontrada');
    if (compra.rows[0].estado !== 'pendiente') throw new ErrorCompra(409, 'Solo se puede recibir una compra pendiente');
    const detalle = await client.query(`SELECT id_variante, cantidad FROM detalle_compra
      WHERE id_compra = $1 ORDER BY id_variante`, [id]);
    const ids = detalle.rows.map(r => r.id_variante);
    // El trigger histórico UPDATE FROM exige una sola fila por variante.
    if (!ids.length || new Set(ids).size !== ids.length) throw new ErrorCompra(409, 'La compra tiene detalles vacíos o variantes duplicadas; requiere corrección');
    const variantes = await client.query(`SELECT id_variante, stock FROM variante_producto
      WHERE id_variante = ANY($1::int[]) ORDER BY id_variante FOR UPDATE`, [ids]);
    const cantidades = new Map(detalle.rows.map(r => [r.id_variante, r.cantidad]));
    if (variantes.rows.some(v => v.stock + cantidades.get(v.id_variante) > MAX_INT)) {
      throw new ErrorCompra(409, 'La recepción supera el stock máximo permitido');
    }
    // El trigger existente incrementa stock. NO realizar un segundo UPDATE de stock.
    await client.query("UPDATE compra SET estado = 'recibida' WHERE id_compra = $1", [id]);
    await client.query(`INSERT INTO movimiento_inventario (tipo, cantidad, motivo, id_variante, id_usuario)
      SELECT 'entrada', cantidad, $2, id_variante, $3
      FROM detalle_compra WHERE id_compra = $1`, [id, `Recepción de compra #${id}`, req.usuario.id_usuario]);
    await registrarAuditoria(client, {
      id_usuario: req.usuario.id_usuario,
      accion: 'RECIBIR',
      entidad: 'compra',
      id_entidad: id,
      detalle: {
        estado_anterior: 'pendiente',
        estado_nuevo: 'recibida',
        items_recibidos: detalle.rows.length,
      },
    });
    return { id_compra: id, estado: 'recibida', mensaje: 'Mercancía recibida correctamente' };
  });
});

module.exports = router;
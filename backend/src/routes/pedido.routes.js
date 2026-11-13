const { Router } = require('express');
const { pool } = require('../config/db');
const rateLimit = require('express-rate-limit');

const router = Router();

// Límite de peticiones por IP (seguridad: mitigación de abuso/DoS) resueltos comentarios de codeQL y dependabot sobre las fallas
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // ventana de 15 minutos
  max: 100,                  // máximo 100 peticiones por IP por ventana
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intenta más tarde' },
});

router.use(limiter);


//En caso de que tengamos X o Y problema de seguridad o vulnerabilidad en el codigo codeQL nos lo dira :))

// GET /api/pedidos — historial de ventas (RF-13)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id_pedido, p.fecha, p.estado, p.total, u.nombre AS usuario
       FROM pedido p
       JOIN usuario u ON u.id_usuario = p.id_usuario
       ORDER BY p.fecha DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar los pedidos' });
  }
});

// GET /api/pedidos/:id — detalle de un pedido (RF-13)
router.get('/:id', async (req, res) => {
  try {
    const pedido = await pool.query(
      `SELECT p.id_pedido, p.fecha, p.estado, p.total, u.nombre AS usuario
       FROM pedido p JOIN usuario u ON u.id_usuario = p.id_usuario
       WHERE p.id_pedido = $1`,
      [req.params.id]
    );
    if (pedido.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    const detalle = await pool.query(
      `SELECT d.id_detalle, v.sku, pr.nombre AS producto, d.cantidad,
              d.precio_unitario, d.subtotal
       FROM detalle_pedido d
       JOIN variante_producto v ON v.id_variante = d.id_variante
       JOIN producto pr ON pr.id_producto = v.id_producto
       WHERE d.id_pedido = $1`,
      [req.params.id]
    );
    res.json({ ...pedido.rows[0], items: detalle.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar el pedido' });
  }
});

// metodo POST /api/pedidos — registrar venta (cunple con los RF-12, RN-01, RN-02, RNF-08)
// Body: { "id_usuario": 1, "items": [{ "id_variante": 3, "cantidad": 2 }] }
router.post('/', async (req, res) => {
  const { id_usuario, items } = req.body;

  // Validaciones de campos obligatorios IMPORTANTE
  if (!id_usuario || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error: 'Campos obligatorios: id_usuario y al menos un ítem (id_variante, cantidad)',
    });
  }
  for (const item of items) {
    if (!item.id_variante || !Number.isInteger(item.cantidad) || item.cantidad <= 0) {
      return res.status(400).json({
        error: 'Cada ítem debe tener id_variante y una cantidad entera mayor a 0',
      });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Validar usuario
    const usuario = await client.query(
      'SELECT id_usuario FROM usuario WHERE id_usuario = $1',
      [id_usuario]
    );
    if (usuario.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'El usuario no existe' });
    }

    // 2. Validar stock y tomar el precio real de la BD (RN-01, RN-08)
    let total = 0;
    const lineas = [];
    for (const item of items) {
      const variante = await client.query(
        `SELECT v.id_variante, v.sku, v.stock, p.precio
         FROM variante_producto v
         JOIN producto p ON p.id_producto = v.id_producto
         WHERE v.id_variante = $1
         FOR UPDATE`,
        [item.id_variante]
      );
      if (variante.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `La variante ${item.id_variante} no existe` });
      }
      const v = variante.rows[0];
      if (v.stock < item.cantidad) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Stock insuficiente para ${v.sku}: disponible ${v.stock}, solicitado ${item.cantidad}`,
        });
      }
      const subtotal = Number(v.precio) * item.cantidad;
      total += subtotal;
      lineas.push({ id_variante: v.id_variante, cantidad: item.cantidad, precio: v.precio, subtotal });
    }

    // 3. Crear el pedido en estado pendiente
    const pedido = await client.query(
      `INSERT INTO pedido (id_usuario, total) VALUES ($1, $2) RETURNING id_pedido`,
      [id_usuario, total]
    );
    const idPedido = pedido.rows[0].id_pedido;

    // 4. Insertar el detalle — el trigger trg_stock_venta descuenta el stock (RN-02)
    for (const l of lineas) {
      await client.query(
        `INSERT INTO detalle_pedido (id_pedido, id_variante, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [idPedido, l.id_variante, l.cantidad, l.precio, l.subtotal]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({
      mensaje: 'Venta registrada correctamente',
      id_pedido: idPedido,
      estado: 'pendiente',
      total,
      items: lineas.length,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al registrar la venta; no se modificó el inventario' });
  } finally {
    client.release();
  }
});
router.post('/:id/cancelar', async (req, res) => {
  const { id_usuario } = req.body;
  if (!id_usuario) {
    return res.status(400).json({ error: 'Campo obligatorio: id_usuario' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Solo un administrador puede anular ventas
    const admin = await client.query(
      `SELECT id_usuario FROM usuario WHERE id_usuario = $1 AND rol = 'administrador'`,
      [id_usuario]
    );
    if (admin.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Solo un administrador puede anular ventas' });
    }

    // 2. Bloquear el pedido (FOR UPDATE) para que nadie lo modifique durante la anulación
    const pedido = await client.query(
      'SELECT id_pedido, estado FROM pedido WHERE id_pedido = $1 FOR UPDATE',
      [req.params.id]
    );
    if (pedido.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }
    if (pedido.rows[0].estado === 'cancelado') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La venta ya está anulada' });
    }

    // 3. Marcar como cancelado — el trigger trg_stock_cancelacion devuelve el stock
    await client.query(
      `UPDATE pedido SET estado = 'cancelado' WHERE id_pedido = $1`,
      [req.params.id]
    );+
    

    // 4. Registrar la reversa como movimientos de inventario (trazabilidad)
    await client.query(
      `INSERT INTO movimiento_inventario (tipo, cantidad, motivo, id_variante, id_usuario)
       SELECT 'entrada', d.cantidad, $2, d.id_variante, $3
       FROM detalle_pedido d
       WHERE d.id_pedido = $1`,
      [req.params.id, `Anulación de la venta #${req.params.id}`, id_usuario]
    );

    await client.query('COMMIT');
    res.json({ mensaje: `Venta #${req.params.id} anulada; el stock fue devuelto al inventario` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al anular la venta; no se hizo ningún cambio' });
  } finally {
    client.release();
  }
});
module.exports = router;
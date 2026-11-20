const { Router } = require('express');
const { pool } = require('../config/db');
const rateLimit = require('express-rate-limit');
const { autenticar, permitirRoles } = require('../middleware/auth');
const { registrarAuditoria } = require('../middleware/auditoria');
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

// GET /api/pedidos — historial de ventas (RF-13)
router.get('/', permitirRoles('vendedor', 'administrador'), async (req, res) => {
  try {
    const esAdmin = req.usuario.rol === 'administrador';

    const result = await pool.query(
      `SELECT p.id_pedido, p.fecha, p.estado, p.total,
              u.nombre AS usuario
       FROM pedido p
       JOIN usuario u ON u.id_usuario = p.id_usuario
       WHERE ($1::boolean OR p.id_usuario = $2)
       ORDER BY p.fecha DESC`,
      [esAdmin, req.usuario.id_usuario]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar los pedidos' });
  }
});

// GET /api/pedidos/:id — detalle de un pedido (RF-13)
router.get('/:id', permitirRoles('vendedor', 'administrador'), async (req, res) => {
  const idPedido = Number(req.params.id);

  if (!/^[1-9]\d*$/.test(req.params.id) ||
      !Number.isSafeInteger(idPedido)) {
    return res.status(400).json({
      error: 'El ID del pedido debe ser un entero positivo'
    });
  }
  try {
    const esAdmin = req.usuario.rol === 'administrador';

    const pedido = await pool.query(
      `SELECT p.id_pedido, p.fecha, p.estado, p.total,
              u.nombre AS usuario
       FROM pedido p
       JOIN usuario u ON u.id_usuario = p.id_usuario
       WHERE p.id_pedido = $1
         AND ($2::boolean OR p.id_usuario = $3)`,
      [idPedido, esAdmin, req.usuario.id_usuario]
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
      [idPedido]
    );
    res.json({ ...pedido.rows[0], items: detalle.rows });
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar el pedido' });
  }
});

// POST /api/pedidos — registrar venta (RF-12, RN-01, RN-02, RNF-08, RNF-09)
router.post('/', permitirRoles('vendedor', 'administrador'), async (req, res) => {
  const { items } = req.body || {};
  const id_usuario = req.usuario.id_usuario;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      error: 'Debes incluir al menos un ítem (id_variante, cantidad)',
    });
  }
  for (const item of items) {
    if (
      item === null ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      !Number.isSafeInteger(item.id_variante) ||
      item.id_variante <= 0 ||
      !Number.isSafeInteger(item.cantidad) ||
      item.cantidad <= 0
    ) {
      return res.status(400).json({
        error: 'Cada ítem debe incluir id_variante y cantidad como enteros positivos'
      });
    }
  }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const usuario = await client.query(
      'SELECT id_usuario FROM usuario WHERE id_usuario = $1',
      [id_usuario]
    );
    if (usuario.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'El usuario no existe' });
    }

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

    const pedido = await client.query(
      `INSERT INTO pedido (id_usuario, total) VALUES ($1, $2) RETURNING id_pedido`,
      [id_usuario, total]
    );
    const idPedido = pedido.rows[0].id_pedido;

    for (const l of lineas) {
      await client.query(
        `INSERT INTO detalle_pedido (id_pedido, id_variante, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [idPedido, l.id_variante, l.cantidad, l.precio, l.subtotal]
      );
    }

    // Registrar creación de venta en auditoría (RNF-09)
    await registrarAuditoria(client, {
      id_usuario,
      accion: 'CREAR',
      entidad: 'pedido',
      id_entidad: idPedido,
      detalle: { total, items: lineas },
    });

    await client.query('COMMIT');
    res.status(201).json({
      mensaje: 'Venta registrada correctamente',
      id_pedido: idPedido,
      estado: 'pendiente',
      total,
      items: lineas.length,
    });
  } catch (err) {
    console.error('Error al registrar la venta:', err);

    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Error durante ROLLBACK:', rollbackErr);
      }
    }

    return res.status(500).json({
      error: 'No se pudo completar el registro de la venta'
    });
  } finally {
    if (client) {
      client.release();
    }
  }
});

// POST /api/pedidos/:id/cancelar — anular venta y devolver stock (Issue #25, RNF-09)
router.post(
  '/:id/cancelar',
  permitirRoles('administrador'),
  async (req, res) => {
    const id_usuario = req.usuario.id_usuario;
    const idPedido = Number(req.params.id);

    if (!Number.isSafeInteger(idPedido) || idPedido <= 0) {
      return res.status(400).json({
        error: 'El ID del pedido debe ser un entero positivo'
      });
    }

    if (!Number.isSafeInteger(id_usuario) || id_usuario <= 0) {
      return res.status(400).json({
        error: 'El id_usuario debe ser un entero positivo'
      });
    }

    let client;
    let transaccionIniciada = false;

    try {
      client = await pool.connect();

      await client.query('BEGIN');
      transaccionIniciada = true;

      const pedido = await client.query(
        `SELECT id_pedido, estado
         FROM pedido
         WHERE id_pedido = $1
         FOR UPDATE`,
        [idPedido]
      );

      if (pedido.rows.length === 0) {
        await client.query('ROLLBACK');
        transaccionIniciada = false;

        return res.status(404).json({
          error: 'Pedido no encontrado'
        });
      }

      if (pedido.rows[0].estado === 'cancelado') {
        await client.query('ROLLBACK');
        transaccionIniciada = false;

        return res.status(409).json({
          error: 'La venta ya está anulada'
        });
      }

      if (!['pendiente', 'confirmado'].includes(pedido.rows[0].estado)) {
        await client.query('ROLLBACK');
        transaccionIniciada = false;

        return res.status(409).json({
          error: 'No se puede anular una venta despachada o entregada'
        });
      }

      await client.query(
        `UPDATE pedido
         SET estado = 'cancelado'
         WHERE id_pedido = $1`,
        [idPedido]
      );

      await client.query(
        `INSERT INTO movimiento_inventario
           (tipo, cantidad, motivo, id_variante, id_usuario)
         SELECT 'entrada',
                d.cantidad,
                $2,
                d.id_variante,
                $3
         FROM detalle_pedido d
         WHERE d.id_pedido = $1`,
        [
          idPedido,
          `Anulación de la venta #${idPedido}`,
          id_usuario
        ]
      );

      // Registrar anulación de venta en auditoría (RNF-09)
      await registrarAuditoria(client, {
        id_usuario,
        accion: 'ANULAR',
        entidad: 'pedido',
        id_entidad: idPedido,
        detalle: {
          estado_anterior: pedido.rows[0].estado,
          estado_nuevo: 'cancelado',
        },
      });

      await client.query('COMMIT');
      transaccionIniciada = false;

      return res.status(200).json({
        mensaje: `Venta #${idPedido} anulada; el stock fue devuelto al inventario`
      });

    } catch (err) {
      console.error('Error al anular la venta:', err);

      if (client && transaccionIniciada) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          console.error('Error durante ROLLBACK:', rollbackErr);
        }
      }

      return res.status(500).json({
        error: 'No se pudo completar la anulación de la venta'
      });

    } finally {
      if (client) {
        client.release();
      }
    }
  }
);

module.exports = router;
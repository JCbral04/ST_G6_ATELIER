const { Router } = require('express');
const { pool } = require('../config/db');
const rateLimit = require('express-rate-limit');
const { autenticar, permitirRoles } = require('../middleware/auth');
const router = Router();

const MAX_INT = 2147483647;
const MAX_ITEMS = 100;
const MAX_TOTAL_CENTS = 999999999999n;

const enteroPositivo = (n) =>
  Number.isSafeInteger(n) && n > 0 && n <= MAX_INT;

function precioCentavos(value) {
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new Error('Precio inválido en base de datos');

  const cents =
    BigInt(match[1]) * 100n +
    BigInt((match[2] || '').padEnd(2, '0'));

  if (cents <= 0n) throw new Error('Precio no positivo');
  return cents;
}

function dinero(cents) {
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

// Límite de peticiones por IP (seguridad: mitigación de abuso/DoS) resueltos comentarios de codeQL y dependabot sobre las fallas
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // ventana de 15 minutos
  max: 100,                  // máximo 100 peticiones por IP por ventana
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intenta más tarde' },
});

router.use(limiter);
router.use(autenticar);

//En caso de que tengamos X o Y problema de seguridad o vulnerabilidad en el codigo codeQL nos lo dira :))

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
      !enteroPositivo(idPedido)) {
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

// metodo POST /api/pedidos — registrar venta (cunple con los RF-12, RN-01, RN-02, RNF-08)
// Body: { "items": [{ "id_variante": 3, "cantidad": 2 }] }
// Requiere Authorization: Bearer <token>
router.post('/', permitirRoles('vendedor', 'administrador'), async (req, res) => {
  const { items } = req.body || {};
  const id_usuario = req.usuario.id_usuario;

  // Validaciones de campos obligatorios IMPORTANTE
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > MAX_ITEMS
  ) {
    return res.status(400).json({
      error: 'Debes incluir entre 1 y 100 ítems',
    });
  }
  const variantesVistas = new Set();

  for (const item of items) {
    if (
      item === null ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      !enteroPositivo(item.id_variante) ||
      !enteroPositivo(item.cantidad)
    ) {
      return res.status(400).json({
        error: 'Cada ítem requiere identificador y cantidad enteros positivos válidos'
      });
    }

    if (variantesVistas.has(item.id_variante)) {
      return res.status(400).json({
        error: `La variante ${item.id_variante} está duplicada`
      });
    }

    variantesVistas.add(item.id_variante);
  }

  const itemsOrdenados = [...items].sort(
    (a, b) => a.id_variante - b.id_variante
  );

  let client;

  try {
    client = await pool.connect();
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
    let totalCentavos = 0n;
    const lineas = [];

    for (const item of itemsOrdenados) {
      const variante = await client.query(
        `SELECT v.id_variante, v.sku, v.stock, v.id_producto
         FROM variante_producto v
         WHERE v.id_variante = $1
         FOR UPDATE OF v`,
        [item.id_variante]
      );
      if (variante.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: `La variante ${item.id_variante} no existe o está inactiva` });
      }
      const v = variante.rows[0];

      // La función SQL bloquea el producto hasta finalizar
      // la transacción sin conceder UPDATE sobre el catálogo.
      const producto = await client.query(
        'SELECT public.precio_producto_activo($1) AS precio',
        [v.id_producto]
      );

      const precioActivo = producto.rows[0].precio;

      if (precioActivo === null) {
        await client.query('ROLLBACK');

        return res.status(404).json({
          error: `La variante ${item.id_variante} pertenece a un producto inactivo`
        });
      }

      if (v.stock < item.cantidad) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `Stock insuficiente para ${v.sku}: disponible ${v.stock}, solicitado ${item.cantidad}`,
        });
      }
      const precio = precioCentavos(precioActivo);
      const subtotal = precio * BigInt(item.cantidad);

      totalCentavos += subtotal;

      if (totalCentavos > MAX_TOTAL_CENTS) {
        await client.query('ROLLBACK');

        return res.status(400).json({
          error: 'El total de la venta supera el límite permitido'
        });
      }

      lineas.push({
        id_variante: v.id_variante,
        cantidad: item.cantidad,
        precio: dinero(precio),
        subtotal: dinero(subtotal)
      });
    }

    // 3. Crear el pedido en estado pendiente
    const pedido = await client.query(
      `INSERT INTO pedido (id_usuario, total) VALUES ($1, $2) RETURNING id_pedido`,
      [id_usuario, dinero(totalCentavos)]
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

    // El trigger ya descontó el stock.
    // Registrar únicamente la trazabilidad de la salida.
    await client.query(
      `INSERT INTO movimiento_inventario
         (tipo, cantidad, motivo, id_variante, id_usuario)
       SELECT 'salida',
              d.cantidad,
              $2,
              d.id_variante,
              $3
       FROM detalle_pedido d
       WHERE d.id_pedido = $1`,
      [idPedido, `Registro de venta #${idPedido}`, id_usuario]
    );

    await client.query('COMMIT');
    res.status(201).json({
      mensaje: 'Venta registrada correctamente',
      id_pedido: idPedido,
      estado: 'pendiente',
      total: Number(dinero(totalCentavos)),
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

// POST /api/pedidos/:id/cancelar — anular venta y devolver stock (Issue #25)
router.post(
  '/:id/cancelar',
  permitirRoles('administrador'),
  async (req, res) => {
  const id_usuario = req.usuario.id_usuario;
  const idPedido = Number(req.params.id);

  // Validar identificadores
  if (
    !/^[1-9]\d*$/.test(req.params.id) ||
    !enteroPositivo(idPedido)
  ) {
    return res.status(400).json({
      error: 'El ID del pedido debe ser un entero positivo'
    });
  }

  if (!enteroPositivo(id_usuario)) {
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


    // 1. Bloquear el pedido para evitar cancelaciones concurrentes
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

    // Bloquear variantes en orden determinista y validar
    // la restitución acumulada de los detalles históricos.
    const devoluciones = await client.query(
      `SELECT v.id_variante, v.stock, d.cantidad_total
       FROM variante_producto v
       JOIN (
         SELECT id_variante, SUM(cantidad) AS cantidad_total
         FROM detalle_pedido
         WHERE id_pedido = $1
         GROUP BY id_variante
       ) d ON d.id_variante = v.id_variante
       ORDER BY v.id_variante
       FOR UPDATE OF v`,
      [idPedido]
    );

    if (
      devoluciones.rows.length === 0 ||
      devoluciones.rows.some(
        v => BigInt(v.stock) + BigInt(v.cantidad_total) > BigInt(MAX_INT)
      )
    ) {
      await client.query('ROLLBACK');
      transaccionIniciada = false;

      return res.status(409).json({
        error: 'La devolución no es válida o supera el stock máximo'
      });
    }

    // 2. Actualizar estado: el trigger devuelve automáticamente el stock
    await client.query(
      `UPDATE pedido
       SET estado = 'cancelado'
       WHERE id_pedido = $1`,
      [idPedido]
    );

    // 3. Registrar los movimientos de devolución
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

    // 4. Confirmar la transacción completa
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
});


module.exports = router;
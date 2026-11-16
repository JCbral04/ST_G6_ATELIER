const { Router } = require('express');
const { pool } = require('../config/db');
const rateLimit = require('express-rate-limit');

const router = Router();

// Mismo límite que el resto de la API (mitiga abuso / DoS)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intenta más tarde' },
});

router.use(limiter);

const TIPOS = ['entrada', 'salida'];
const ROLES_PERMITIDOS = ['administrador', 'vendedor'];
const MOTIVO_MAX = 200; // igual que movimiento_inventario.motivo VARCHAR(200)

// Entero positivo: acepta 3 o "3", rechaza "abc", 1.5, -2, null
function enteroPositivo(valor) {
  if (typeof valor === 'string' && /^\d+$/.test(valor.trim())) valor = Number(valor);
  return Number.isInteger(valor) && valor > 0 ? valor : null;
}

// GET /api/inventario/movimientos — historial de movimientos
// Filtros opcionales: ?id_variante=1  ?id_producto=2  ?tipo=entrada|salida  ?limite=50
router.get('/', async (req, res) => {
  const filtros = [];
  const valores = [];

  for (const campo of ['id_variante', 'id_producto']) {
    if (req.query[campo] !== undefined) {
      const id = enteroPositivo(req.query[campo]);
      if (!id) return res.status(400).json({ error: `${campo} debe ser un número entero mayor a 0` });
      valores.push(id);
      filtros.push(`${campo === 'id_variante' ? 'v.id_variante' : 'v.id_producto'} = $${valores.length}`);
    }
  }
  if (req.query.tipo !== undefined) {
    if (!TIPOS.includes(req.query.tipo)) {
      return res.status(400).json({ error: "tipo debe ser 'entrada' o 'salida'" });
    }
    valores.push(req.query.tipo);
    filtros.push(`m.tipo = $${valores.length}`);
  }
  let limite = 100;
  if (req.query.limite !== undefined) {
    limite = enteroPositivo(req.query.limite);
    if (!limite || limite > 500) {
      return res.status(400).json({ error: 'limite debe ser un número entre 1 y 500' });
    }
  }
  valores.push(limite);

  try {
    const result = await pool.query(
      `SELECT m.id_movimiento, m.fecha, m.tipo, m.cantidad, m.motivo,
              u.nombre AS usuario,
              v.id_variante, v.sku, p.id_producto, p.nombre AS producto,
              t.etiqueta AS talla, c.nombre AS color
       FROM movimiento_inventario m
       JOIN usuario u           ON u.id_usuario  = m.id_usuario
       JOIN variante_producto v ON v.id_variante = m.id_variante
       JOIN producto p          ON p.id_producto = v.id_producto
       JOIN talla t             ON t.id_talla    = v.id_talla
       JOIN color c             ON c.id_color    = v.id_color
       ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''}
       ORDER BY m.fecha DESC, m.id_movimiento DESC
       LIMIT $${valores.length}`,
      valores
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Error al consultar los movimientos de inventario' });
  }
});

// POST /api/inventario/movimientos — ajuste manual de inventario
// Body: { "id_usuario": 1, "id_variante": 3, "tipo": "salida", "cantidad": 2, "motivo": "Prenda dañada" }
// Stock y movimiento se guardan en una sola transacción: o queda todo o no queda nada.
router.post('/', async (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const idUsuario = enteroPositivo(body.id_usuario);
  const idVariante = enteroPositivo(body.id_variante);
  const cantidad = Number.isInteger(body.cantidad) && body.cantidad > 0 ? body.cantidad : null;
  const tipo = body.tipo;
  const motivo = typeof body.motivo === 'string' ? body.motivo.trim() : '';

  const errores = [];
  if (!idUsuario) errores.push('id_usuario debe ser un número entero mayor a 0');
  if (!idVariante) errores.push('id_variante debe ser un número entero mayor a 0');
  if (!TIPOS.includes(tipo)) errores.push("tipo debe ser 'entrada' o 'salida'");
  if (!cantidad) errores.push('cantidad debe ser un número entero mayor a 0');
  if (!motivo) errores.push('motivo es obligatorio');
  else if (motivo.length > MOTIVO_MAX) errores.push(`motivo admite máximo ${MOTIVO_MAX} caracteres`);
  if (errores.length) return res.status(400).json({ error: 'Datos inválidos', detalles: errores });

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const usuario = await client.query('SELECT rol FROM usuario WHERE id_usuario = $1', [idUsuario]);
    if (usuario.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'El usuario no existe' });
    }
    if (!ROLES_PERMITIDOS.includes(usuario.rows[0].rol)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Solo el personal de la tienda puede registrar movimientos' });
    }

    // FOR UPDATE: bloquea la fila para que dos ajustes simultáneos no pisen el stock
    const variante = await client.query(
      'SELECT sku, stock FROM variante_producto WHERE id_variante = $1 FOR UPDATE',
      [idVariante]
    );
    if (variante.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: `La variante ${idVariante} no existe` });
    }
    const { sku, stock } = variante.rows[0];

    if (tipo === 'salida' && stock < cantidad) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `La salida dejaría el stock de ${sku} en negativo`,
        stock_actual: stock,
        cantidad_solicitada: cantidad,
      });
    }

    const nuevoStock = tipo === 'entrada' ? stock + cantidad : stock - cantidad;
    await client.query('UPDATE variante_producto SET stock = $1 WHERE id_variante = $2', [nuevoStock, idVariante]);

    const movimiento = await client.query(
      `INSERT INTO movimiento_inventario (tipo, cantidad, motivo, id_variante, id_usuario)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id_movimiento, fecha, tipo, cantidad, motivo, id_variante, id_usuario`,
      [tipo, cantidad, motivo, idVariante, idUsuario]
    );

    await client.query('COMMIT');
    res.status(201).json({
      mensaje: 'Movimiento registrado correctamente',
      movimiento: { ...movimiento.rows[0], sku },
      stock_anterior: stock,
      stock_actual: nuevoStock,
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: 'Error al registrar el movimiento; no se modificó el inventario' });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;

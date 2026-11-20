const express = require('express');
const request = require('supertest');

// Protección contra ejecuciones sobre bases de trabajo.
if (
  process.env.ACID_TEST_RUN !== '1' ||
  !/^atelier_test_\d+_\d+$/.test(process.env.DB_NAME || '')
) {
  throw new Error(
    'Las pruebas ACID requieren una base temporal aislada'
  );
}

const { pool } = require('../src/config/db');
const routes = require('../src/routes');

const app = express();
app.use(express.json());
app.use('/api', routes);

jest.setTimeout(30000);

let varianteA;
let varianteB;
let adminToken;
let vendedorToken;
let adminId;
let vendedorId;

async function login(correo) {
  const response = await request(app)
    .post('/api/auth/login')
    .send({
      correo,
      contrasena: '123456'
    });

  expect(response.status).toBe(200);
  expect(response.body.token).toBeDefined();

  return response.body;
}

function vender(items) {
  return request(app)
    .post('/api/pedidos')
    .set('Authorization', `Bearer ${vendedorToken}`)
    .send({ items });
}

async function stock(idVariante) {
  const result = await pool.query(
    `SELECT stock
     FROM variante_producto
     WHERE id_variante = $1`,
    [idVariante]
  );

  return result.rows[0].stock;
}

async function estadoTransaccional() {
  const result = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM pedido) AS pedidos,
      (SELECT COUNT(*)::int FROM detalle_pedido) AS detalles,
      (SELECT COUNT(*)::int FROM movimiento_inventario) AS movimientos
  `);

  return result.rows[0];
}

async function limpiarDatos() {
  await pool.query(`
    TRUNCATE TABLE
      detalle_pedido,
      pedido,
      movimiento_inventario,
      sesion_usuario
    RESTART IDENTITY
  `);

  await pool.query(
    `UPDATE variante_producto
     SET stock = 10
     WHERE id_variante IN ($1, $2)`,
    [varianteA, varianteB]
  );
}

beforeAll(async () => {
  const conexion = await pool.query(
    'SELECT current_database() AS nombre'
  );

  expect(conexion.rows[0].nombre).toBe(process.env.DB_NAME);

  const result = await pool.query(`
    SELECT id_variante, sku
    FROM variante_producto
    WHERE sku IN ('CAM-NEG-M', 'CAM-BLA-M')
  `);

  expect(result.rows).toHaveLength(2);

  varianteA = result.rows.find(
    row => row.sku === 'CAM-NEG-M'
  ).id_variante;

  varianteB = result.rows.find(
    row => row.sku === 'CAM-BLA-M'
  ).id_variante;
});

beforeEach(async () => {
  await limpiarDatos();

  const vendedor = await login('vendedor@atelier.com');
  const admin = await login('admin@atelier.com');

  vendedorToken = vendedor.token;
  vendedorId = vendedor.usuario.id_usuario;
  adminToken = admin.token;
  adminId = admin.usuario.id_usuario;
});

afterEach(async () => {
  if (varianteA && varianteB) {
    await limpiarDatos();
  }
});

afterAll(async () => {
  await pool.end();
});

describe('Issue #47 — Hardening transaccional', () => {

  test.each([2, 6])(
    'HARD-01: rechaza variantes duplicadas (cantidad %i)',
    async cantidad => {
      const response = await vender([
        { id_variante: varianteA, cantidad },
        { id_variante: varianteA, cantidad }
      ]);

      expect(response.status).toBe(400);
      expect(await stock(varianteA)).toBe(10);

      expect(await estadoTransaccional()).toEqual({
        pedidos: 0,
        detalles: 0,
        movimientos: 0
      });
    }
  );

  test('HARD-02: impide vender productos inactivos', async () => {
    const producto = await pool.query(
      `SELECT id_producto FROM variante_producto
       WHERE id_variante = $1`,
      [varianteA]
    );

    const id = producto.rows[0].id_producto;

    try {
      await pool.query(
        'UPDATE producto SET activo = FALSE WHERE id_producto = $1',
        [id]
      );

      const response = await vender([
        { id_variante: varianteA, cantidad: 1 }
      ]);

      expect(response.status).toBe(404);
      expect(await stock(varianteA)).toBe(10);

      expect(await estadoTransaccional()).toEqual({
        pedidos: 0,
        detalles: 0,
        movimientos: 0
      });
    } finally {
      await pool.query(
        'UPDATE producto SET activo = TRUE WHERE id_producto = $1',
        [id]
      );
    }
  });

  test('HARD-03: rechaza valores fuera de INTEGER', async () => {
    const invalidos = [
      [{ id_variante: 2147483648, cantidad: 1 }],
      [{ id_variante: varianteA, cantidad: 2147483648 }],
      [{ id_variante: varianteA, cantidad: 1.5 }],
      [{ id_variante: varianteA, cantidad: 0 }]
    ];

    for (const items of invalidos) {
      const response = await vender(items);
      expect(response.status).toBe(400);
    }

    expect(await stock(varianteA)).toBe(10);
    expect(await estadoTransaccional()).toEqual({
      pedidos: 0,
      detalles: 0,
      movimientos: 0
    });
  });

  test('HARD-04: dinero exacto y actor autenticado', async () => {
    const producto = await pool.query(
      `SELECT p.id_producto, p.precio
       FROM producto p
       JOIN variante_producto v USING (id_producto)
       WHERE v.id_variante = $1`,
      [varianteA]
    );

    const original = producto.rows[0];

    try {
      await pool.query(
        'UPDATE producto SET precio = 0.10 WHERE id_producto = $1',
        [original.id_producto]
      );

      const venta = await request(app)
        .post('/api/pedidos')
        .set('Authorization', `Bearer ${vendedorToken}`)
        .send({
          id_usuario: adminId,
          items: [
            { id_variante: varianteA, cantidad: 3 }
          ]
        });

      expect(venta.status).toBe(201);
      expect(venta.body.total).toBe(0.3);
      expect(await stock(varianteA)).toBe(7);

      const pedido = await pool.query(
        'SELECT total, id_usuario FROM pedido WHERE id_pedido = $1',
        [venta.body.id_pedido]
      );

      expect(pedido.rows[0].total).toBe('0.30');
      expect(pedido.rows[0].id_usuario).toBe(vendedorId);

      const movimientos = await pool.query(
        `SELECT tipo, cantidad, id_usuario, id_variante
         FROM movimiento_inventario WHERE motivo = $1`,
        [`Registro de venta #${venta.body.id_pedido}`]
      );

      expect(movimientos.rows).toEqual([{
        tipo: 'salida',
        cantidad: 3,
        id_usuario: vendedorId,
        id_variante: varianteA
      }]);
    } finally {
      await pool.query(
        'UPDATE producto SET precio = $1 WHERE id_producto = $2',
        [original.precio, original.id_producto]
      );
    }
  });

  test('HARD-05: rechaza un total monetario fuera del límite', async () => {
    const producto = await pool.query(
      `SELECT p.id_producto, p.precio
       FROM producto p
       JOIN variante_producto v USING (id_producto)
       WHERE v.id_variante = $1`,
      [varianteA]
    );

    const original = producto.rows[0];

    try {
      await pool.query(
        'UPDATE producto SET precio = 99999999.99 WHERE id_producto = $1',
        [original.id_producto]
      );

      await pool.query(
        'UPDATE variante_producto SET stock = 200 WHERE id_variante = $1',
        [varianteA]
      );

      const response = await vender([
        { id_variante: varianteA, cantidad: 101 }
      ]);

      expect(response.status).toBe(400);
      expect(await stock(varianteA)).toBe(200);

      expect(await estadoTransaccional()).toEqual({
        pedidos: 0,
        detalles: 0,
        movimientos: 0
      });
    } finally {
      await pool.query(
        'UPDATE producto SET precio = $1 WHERE id_producto = $2',
        [original.precio, original.id_producto]
      );
    }
  });

  test('HARD-06: ventas concurrentes con orden inverso', async () => {
    const items = [
      { id_variante: varianteA, cantidad: 1 },
      { id_variante: varianteB, cantidad: 1 }
    ];

    const responses = await Promise.all([
      vender(items),
      vender([...items].reverse())
    ]);

    expect(responses.map(r => r.status)).toEqual([201, 201]);

    expect(await stock(varianteA)).toBe(8);
    expect(await stock(varianteB)).toBe(8);

    expect(await estadoTransaccional()).toEqual({
      pedidos: 2,
      detalles: 4,
      movimientos: 4
    });
  });

  test('HARD-07: cancela pedido histórico con detalles duplicados', async () => {
    // Simular un pedido creado antes del hardening.
    const pedido = await pool.query(
      `INSERT INTO pedido (id_usuario, total)
       VALUES ($1, 225000) RETURNING id_pedido`,
      [vendedorId]
    );

    const idPedido = pedido.rows[0].id_pedido;

    await pool.query(
      `INSERT INTO detalle_pedido
        (id_pedido, id_variante, cantidad, precio_unitario, subtotal)
       VALUES
        ($1, $2, 2, 45000, 90000),
        ($1, $2, 3, 45000, 135000)`,
      [idPedido, varianteA]
    );

    expect(await stock(varianteA)).toBe(5);

    const cancelar = () => request(app)
      .post(`/api/pedidos/${idPedido}/cancelar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    const response = await cancelar();

    expect(response.status).toBe(200);
    expect(await stock(varianteA)).toBe(10);

    const movimientos = await pool.query(
      `SELECT SUM(cantidad)::int AS total
       FROM movimiento_inventario
       WHERE motivo = $1 AND tipo = 'entrada'
         AND id_usuario = $2`,
      [`Anulación de la venta #${idPedido}`, adminId]
    );

    expect(movimientos.rows[0].total).toBe(5);

    expect((await cancelar()).status).toBe(409);
    expect(await stock(varianteA)).toBe(10);
  });

  test('HARD-08: fallo del movimiento revierte toda la venta', async () => {
    try {
      await pool.query(`
        CREATE FUNCTION fn_hardening_fallo_movimiento()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.tipo = 'salida' THEN
            RAISE EXCEPTION 'HARDENING_TEST_FALLO_MOVIMIENTO';
          END IF;

          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);

      await pool.query(`
        CREATE TRIGGER trg_hardening_fallo_movimiento
        BEFORE INSERT ON movimiento_inventario
        FOR EACH ROW
        EXECUTE FUNCTION fn_hardening_fallo_movimiento()
      `);

      const response = await vender([
        { id_variante: varianteA, cantidad: 2 }
      ]);

      expect(response.status).toBe(500);
      expect(await stock(varianteA)).toBe(10);

      expect(await estadoTransaccional()).toEqual({
        pedidos: 0,
        detalles: 0,
        movimientos: 0
      });
    } finally {
      await pool.query(`
        DROP TRIGGER IF EXISTS trg_hardening_fallo_movimiento
        ON movimiento_inventario;

        DROP FUNCTION IF EXISTS fn_hardening_fallo_movimiento();
      `);
    }
  });

  test('HARD-09: cancelación rechaza desbordamiento de stock', async () => {
    const venta = await vender([
      { id_variante: varianteA, cantidad: 1 }
    ]);

    expect(venta.status).toBe(201);

    await pool.query(
      'UPDATE variante_producto SET stock = $1 WHERE id_variante = $2',
      [2147483647, varianteA]
    );

    const response = await request(app)
      .post(`/api/pedidos/${venta.body.id_pedido}/cancelar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(response.status).toBe(409);
    expect(await stock(varianteA)).toBe(2147483647);

    const pedido = await pool.query(
      'SELECT estado FROM pedido WHERE id_pedido = $1',
      [venta.body.id_pedido]
    );

    expect(pedido.rows[0].estado).toBe('pendiente');

    expect(await estadoTransaccional()).toEqual({
      pedidos: 1,
      detalles: 1,
      movimientos: 1
    });
  });

});

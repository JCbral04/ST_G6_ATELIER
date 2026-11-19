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

describe('Issue #28 — Integridad transaccional ACID', () => {

  test('ACID-01: venta exitosa descuenta stock atomicamente', async () => {
    const response = await vender([
      { id_variante: varianteA, cantidad: 2 },
      { id_variante: varianteB, cantidad: 3 }
    ]);

    expect(response.status).toBe(201);

    expect(await stock(varianteA)).toBe(8);
    expect(await stock(varianteB)).toBe(7);

    const pedido = await pool.query(
      `SELECT estado, total
       FROM pedido
       WHERE id_pedido = $1`,
      [response.body.id_pedido]
    );

    expect(pedido.rows).toHaveLength(1);
    expect(pedido.rows[0].estado).toBe('pendiente');
    expect(Number(pedido.rows[0].total)).toBe(225000);

    const datos = await estadoTransaccional();

    expect(datos.pedidos).toBe(1);
    expect(datos.detalles).toBe(2);
  });

  test('ACID-02: fallo intermedio revierte toda la venta', async () => {

    // La secuencia permite demostrar que el fallo ocurrió
    // después de que se insertó y descontó el primer ítem.
    // nextval no se revierte con el rollback de PostgreSQL.
    await pool.query(`
      CREATE SEQUENCE acid_rollback_witness
    `);

    try {
      await pool.query(`
        CREATE FUNCTION fn_acid_fallo_controlado()
        RETURNS TRIGGER AS $$
        BEGIN
          IF NEW.id_variante = (
            SELECT id_variante
            FROM variante_producto
            WHERE sku = 'CAM-BLA-M'
          ) THEN

            IF EXISTS (
              SELECT 1
              FROM detalle_pedido d
              JOIN variante_producto v
                ON v.id_variante = d.id_variante
              WHERE d.id_pedido = NEW.id_pedido
                AND v.sku = 'CAM-NEG-M'
                AND v.stock = 8
                AND d.cantidad = 2
            ) THEN
              PERFORM nextval('acid_rollback_witness');
            END IF;

            RAISE EXCEPTION 'ACID_TEST_FALLO_CONTROLADO';
          END IF;

          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);

      await pool.query(`
        CREATE TRIGGER trg_acid_fallo_controlado
        BEFORE INSERT ON detalle_pedido
        FOR EACH ROW
        EXECUTE FUNCTION fn_acid_fallo_controlado()
      `);

      const response = await vender([
        { id_variante: varianteA, cantidad: 2 },
        { id_variante: varianteB, cantidad: 2 }
      ]);

      expect(response.status).toBe(500);

      const witness = await pool.query(`
        SELECT is_called
        FROM acid_rollback_witness
      `);

      expect(witness.rows[0].is_called).toBe(true);

      expect(await stock(varianteA)).toBe(10);
      expect(await stock(varianteB)).toBe(10);

      expect(await estadoTransaccional()).toEqual({
        pedidos: 0,
        detalles: 0,
        movimientos: 0
      });

    } finally {
      await pool.query(`
        DROP TRIGGER IF EXISTS trg_acid_fallo_controlado
        ON detalle_pedido;

        DROP FUNCTION IF EXISTS fn_acid_fallo_controlado();

        DROP SEQUENCE IF EXISTS acid_rollback_witness;
      `);
    }
  });

  test('ACID-03: dos ventas concurrentes de la ultima unidad', async () => {
    await pool.query(
      `UPDATE variante_producto
       SET stock = 1
       WHERE id_variante = $1`,
      [varianteA]
    );

    const items = [
      { id_variante: varianteA, cantidad: 1 }
    ];

    const responses = await Promise.all([
      vender(items),
      vender(items)
    ]);

    const estados = responses
      .map(response => response.status)
      .sort((a, b) => a - b);

    expect(estados).toEqual([201, 409]);

    expect(await stock(varianteA)).toBe(0);

    const datos = await estadoTransaccional();

    expect(datos.pedidos).toBe(1);
    expect(datos.detalles).toBe(1);

    const detalle = await pool.query(
      `SELECT cantidad
       FROM detalle_pedido
       WHERE id_variante = $1`,
      [varianteA]
    );

    expect(detalle.rows).toHaveLength(1);
    expect(detalle.rows[0].cantidad).toBe(1);
  });

  test('ACID-04: anulacion restaura stock y registra devolucion', async () => {
    const venta = await vender([
      { id_variante: varianteA, cantidad: 3 },
      { id_variante: varianteB, cantidad: 2 }
    ]);

    expect(venta.status).toBe(201);
    expect(await stock(varianteA)).toBe(7);
    expect(await stock(varianteB)).toBe(8);

    const idPedido = venta.body.id_pedido;

    const cancelacion = await request(app)
      .post(`/api/pedidos/${idPedido}/cancelar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(cancelacion.status).toBe(200);

    expect(await stock(varianteA)).toBe(10);
    expect(await stock(varianteB)).toBe(10);

    const pedido = await pool.query(
      `SELECT estado
       FROM pedido
       WHERE id_pedido = $1`,
      [idPedido]
    );

    expect(pedido.rows[0].estado).toBe('cancelado');

    const movimientos = await pool.query(
      `SELECT tipo, cantidad, id_variante, id_usuario
       FROM movimiento_inventario
       WHERE motivo = $1
       ORDER BY id_variante`,
      [`Anulación de la venta #${idPedido}`]
    );

    expect(movimientos.rows).toHaveLength(2);

    expect(movimientos.rows).toEqual(
      expect.arrayContaining([
        {
          tipo: 'entrada',
          cantidad: 3,
          id_variante: varianteA,
          id_usuario: adminId
        },
        {
          tipo: 'entrada',
          cantidad: 2,
          id_variante: varianteB,
          id_usuario: adminId
        }
      ])
    );

    // La cancelación duplicada no debe devolver stock otra vez.
    const duplicada = await request(app)
      .post(`/api/pedidos/${idPedido}/cancelar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(duplicada.status).toBe(409);

    expect(await stock(varianteA)).toBe(10);
    expect(await stock(varianteB)).toBe(10);

    const datos = await estadoTransaccional();
    expect(datos.movimientos).toBe(2);
  });
});
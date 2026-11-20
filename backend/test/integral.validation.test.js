const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

// Protección contra ejecuciones sobre bases de trabajo o remotas (Neon).
if (
  process.env.ACID_TEST_RUN !== '1' ||
  !/^atelier_test_\d+_\d+$/.test(process.env.DB_NAME || '')
) {
  throw new Error(
    'La validación integral requiere una base temporal local aislada'
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
let proveedorId;
let adminToken;
let vendedorToken;
let adminId;
let vendedorId;

async function login(correo) {
  const response = await request(app)
    .post('/api/auth/login')
    .send({
      correo,
      contrasena: '123456',
    });

  expect(response.status).toBe(200);
  expect(response.body.token).toBeDefined();
  return response.body;
}

async function stock(idVariante) {
  const result = await pool.query(
    'SELECT stock FROM variante_producto WHERE id_variante = $1',
    [idVariante]
  );
  return result.rows[0].stock;
}

async function limpiarDatos() {
  await pool.query(`
    TRUNCATE TABLE
      auditoria,
      detalle_compra,
      compra,
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
  const conexion = await pool.query('SELECT current_database() AS nombre');
  expect(conexion.rows[0].nombre).toBe(process.env.DB_NAME);

  const variantes = await pool.query(`
    SELECT id_variante, sku
    FROM variante_producto
    WHERE sku IN ('CAM-NEG-M', 'CAM-BLA-M')
  `);
  expect(variantes.rows).toHaveLength(2);

  varianteA = variantes.rows.find(r => r.sku === 'CAM-NEG-M').id_variante;
  varianteB = variantes.rows.find(r => r.sku === 'CAM-BLA-M').id_variante;

  const proveedores = await pool.query(
    'SELECT id_proveedor FROM proveedor ORDER BY id_proveedor LIMIT 1'
  );
  expect(proveedores.rows).toHaveLength(1);
  proveedorId = proveedores.rows[0].id_proveedor;
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

describe('Issue #49 — Validación integral del backend y consistencia de datos', () => {
  test('INT-01: migraciones 003 y 005 en orden sobre esquema anterior conservan historial y depuran e-commerce', async () => {
    const mig003Path = path.resolve(__dirname, '../../db/migrations/003_auditoria.sql');
    const mig005Path = path.resolve(__dirname, '../../db/migrations/005_eliminar_carrito_ecommerce.sql');

    const sql003 = fs.readFileSync(mig003Path, 'utf8');
    const sql005 = fs.readFileSync(mig005Path, 'utf8');

    await pool.query(`
      DROP TABLE IF EXISTS auditoria;

      ALTER TABLE usuario DROP CONSTRAINT IF EXISTS usuario_rol_check;
      ALTER TABLE usuario
        ADD CONSTRAINT usuario_rol_check CHECK (rol IN ('cliente', 'vendedor', 'administrador'));

      CREATE TABLE IF NOT EXISTS carrito_compra (
        id_carrito SERIAL PRIMARY KEY,
        fecha_creacion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        id_usuario INT NOT NULL REFERENCES usuario(id_usuario)
      );

      CREATE TABLE IF NOT EXISTS item_carrito (
        id_item SERIAL PRIMARY KEY,
        cantidad INT NOT NULL CHECK (cantidad > 0),
        id_carrito INT NOT NULL REFERENCES carrito_compra(id_carrito),
        id_variante INT NOT NULL REFERENCES variante_producto(id_variante)
      );
    `);

    try {
      const clienteHistRes = await pool.query(`
        INSERT INTO usuario (nombre, correo, contrasena_hash, rol)
        VALUES ('Cliente Legado Historial', 'legado.hist@atelier.com', crypt('123456', gen_salt('bf')), 'cliente')
        RETURNING id_usuario
      `);
      const clienteHistId = clienteHistRes.rows[0].id_usuario;

      await pool.query(`
        INSERT INTO sesion_usuario (id_usuario, token_hash, fecha_expiracion)
        VALUES ($1, 'token_legado_hist', NOW() + INTERVAL '1 hour')
      `, [clienteHistId]);

      const pedidoHistRes = await pool.query(`
        INSERT INTO pedido (id_usuario, total, estado)
        VALUES ($1, 90000, 'entregado')
        RETURNING id_pedido
      `, [clienteHistId]);
      const pedidoHistId = pedidoHistRes.rows[0].id_pedido;

      await pool.query(`
        INSERT INTO detalle_pedido (cantidad, precio_unitario, subtotal, id_pedido, id_variante)
        VALUES (2, 45000, 90000, $1, $2)
      `, [pedidoHistId, varianteA]);

      await pool.query(`
        INSERT INTO movimiento_inventario (tipo, cantidad, motivo, id_variante, id_usuario)
        VALUES ('salida', 2, $1, $2, $3)
      `, [`Venta histórica #${pedidoHistId}`, varianteA, clienteHistId]);

      const clienteSinRes = await pool.query(`
        INSERT INTO usuario (nombre, correo, contrasena_hash, rol)
        VALUES ('Cliente Legado Sin Historial', 'legado.sin@atelier.com', crypt('123456', gen_salt('bf')), 'cliente')
        RETURNING id_usuario
      `);
      const clienteSinId = clienteSinRes.rows[0].id_usuario;

      const carritoRes = await pool.query(`
        INSERT INTO carrito_compra (id_usuario)
        VALUES ($1)
        RETURNING id_carrito
      `, [clienteSinId]);

      await pool.query(`
        INSERT INTO item_carrito (cantidad, id_carrito, id_variante)
        VALUES (1, $1, $2)
      `, [carritoRes.rows[0].id_carrito, varianteB]);

      await pool.query(sql003);
      await pool.query(sql005);

      const objetos = await pool.query(`
        SELECT
          to_regclass('public.auditoria') AS auditoria,
          to_regclass('public.carrito_compra') AS carrito_compra,
          to_regclass('public.item_carrito') AS item_carrito
      `);
      expect(objetos.rows[0]).toEqual({
        auditoria: 'auditoria',
        carrito_compra: null,
        item_carrito: null,
      });

      const pedidoConservado = await pool.query(
        'SELECT id_pedido, total, estado FROM pedido WHERE id_pedido = $1',
        [pedidoHistId]
      );
      expect(pedidoConservado.rows).toHaveLength(1);
      expect(Number(pedidoConservado.rows[0].total)).toBe(90000);

      const detalleConservado = await pool.query(
        'SELECT cantidad FROM detalle_pedido WHERE id_pedido = $1',
        [pedidoHistId]
      );
      expect(detalleConservado.rows).toHaveLength(1);
      expect(detalleConservado.rows[0].cantidad).toBe(2);

      const sinHist = await pool.query(
        'SELECT id_usuario FROM usuario WHERE id_usuario = $1',
        [clienteSinId]
      );
      expect(sinHist.rows).toHaveLength(0);

      const loginLegado = await request(app)
        .post('/api/auth/login')
        .send({ correo: 'legado.hist@atelier.com', contrasena: '123456' });
      expect(loginLegado.status).toBe(401);
    } finally {
      await pool.query('DROP TABLE IF EXISTS item_carrito');
      await pool.query('DROP TABLE IF EXISTS carrito_compra');
      await pool.query("DELETE FROM movimiento_inventario WHERE id_usuario IN (SELECT id_usuario FROM usuario WHERE rol = 'cliente')");
      await pool.query("DELETE FROM detalle_pedido WHERE id_pedido IN (SELECT id_pedido FROM pedido WHERE id_usuario IN (SELECT id_usuario FROM usuario WHERE rol = 'cliente'))");
      await pool.query("DELETE FROM pedido WHERE id_usuario IN (SELECT id_usuario FROM usuario WHERE rol = 'cliente')");
      await pool.query("DELETE FROM sesion_usuario WHERE id_usuario IN (SELECT id_usuario FROM usuario WHERE rol = 'cliente')");
      await pool.query("DELETE FROM usuario WHERE rol = 'cliente'");
      await pool.query(`
        ALTER TABLE usuario DROP CONSTRAINT IF EXISTS usuario_rol_check;
        ALTER TABLE usuario
          ADD CONSTRAINT usuario_rol_check CHECK (rol IN ('vendedor', 'administrador'));
      `);
    }
  });

  test('INT-02: ciclo integral compra, recepcion concurrente unica, venta, movimiento manual, anulacion y cuadre de stock', async () => {
    const crearCompra = await request(app)
      .post('/api/compras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        id_proveedor: proveedorId,
        items: [
          { id_variante: varianteA, cantidad: 15, costo_unitario: 22000 },
          { id_variante: varianteB, cantidad: 10, costo_unitario: 22000 },
        ],
      });
    expect(crearCompra.status).toBe(201);
    const idCompra = crearCompra.body.id_compra;

    expect(await stock(varianteA)).toBe(10);
    expect(await stock(varianteB)).toBe(10);

    const [rec1, rec2] = await Promise.all([
      request(app)
        .patch(`/api/compras/${idCompra}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ estado: 'recibida' }),
      request(app)
        .patch(`/api/compras/${idCompra}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ estado: 'recibida' }),
    ]);

    expect([rec1.status, rec2.status].sort((a, b) => a - b)).toEqual([200, 409]);
    expect(await stock(varianteA)).toBe(25);
    expect(await stock(varianteB)).toBe(20);

    const venta = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({
        items: [
          { id_variante: varianteA, cantidad: 5 },
          { id_variante: varianteB, cantidad: 4 },
        ],
      });
    expect(venta.status).toBe(201);
    const idPedido = venta.body.id_pedido;
    expect(await stock(varianteA)).toBe(20);
    expect(await stock(varianteB)).toBe(16);

    const movManual = await request(app)
      .post('/api/inventario/movimientos')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({
        id_variante: varianteA,
        tipo: 'salida',
        cantidad: 2,
        motivo: 'Muestra de exhibición en vitrina',
      });
    expect(movManual.status).toBe(201);
    expect(await stock(varianteA)).toBe(18);

    const anulacion = await request(app)
      .post(`/api/pedidos/${idPedido}/cancelar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(anulacion.status).toBe(200);
    expect(await stock(varianteA)).toBe(23);
    expect(await stock(varianteB)).toBe(20);

    const resumenMovs = await pool.query(`
      SELECT
        id_variante,
        COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN cantidad ELSE -cantidad END), 0)::int AS neto_movimientos
      FROM movimiento_inventario
      WHERE id_variante IN ($1, $2)
      GROUP BY id_variante
    `, [varianteA, varianteB]);

    const netoA = resumenMovs.rows.find(r => r.id_variante === varianteA).neto_movimientos;
    const netoB = resumenMovs.rows.find(r => r.id_variante === varianteB).neto_movimientos;

    // Las ventas ya generan movimientos de salida.
    // No descontar nuevamente sus detalles.
    expect(10 + netoA).toBe(23);
    expect(10 + netoB).toBe(20);

    const salidasVenta = await pool.query(
      `SELECT id_variante, cantidad, id_usuario
       FROM movimiento_inventario
       WHERE tipo = 'salida' AND motivo = $1
       ORDER BY id_variante`,
      [`Registro de venta #${idPedido}`]
    );

    expect(salidasVenta.rows).toHaveLength(2);
    expect(salidasVenta.rows).toEqual(
      expect.arrayContaining([
        {
          id_variante: varianteA,
          cantidad: 5,
          id_usuario: vendedorId
        },
        {
          id_variante: varianteB,
          cantidad: 4,
          id_usuario: vendedorId
        }
      ])
    );
  });

  test('INT-03: trazabilidad completa en auditoría e inmutabilidad ante rol de aplicación', async () => {
    const compra = await request(app)
      .post('/api/compras')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        id_proveedor: proveedorId,
        items: [{ id_variante: varianteA, cantidad: 5, costo_unitario: 20000 }],
      });
    expect(compra.status).toBe(201);

    const recepcion = await request(app)
      .patch(`/api/compras/${compra.body.id_compra}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estado: 'recibida' });
    expect(recepcion.status).toBe(200);

    const venta = await request(app)
      .post('/api/pedidos')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({ items: [{ id_variante: varianteA, cantidad: 2 }] });
    expect(venta.status).toBe(201);

    const mov = await request(app)
      .post('/api/inventario/movimientos')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({
        id_variante: varianteB,
        tipo: 'entrada',
        cantidad: 3,
        motivo: 'Conteo físico positivo',
      });
    expect(mov.status).toBe(201);

    const anulacion = await request(app)
      .post(`/api/pedidos/${venta.body.id_pedido}/cancelar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(anulacion.status).toBe(200);

    const bitacoraRes = await request(app)
      .get('/api/auditoria')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(bitacoraRes.status).toBe(200);
    expect(bitacoraRes.body).toHaveLength(5);

    expect(bitacoraRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id_usuario: adminId, accion: 'CREAR', entidad: 'compra' }),
        expect.objectContaining({ id_usuario: adminId, accion: 'RECIBIR', entidad: 'compra' }),
        expect.objectContaining({ id_usuario: vendedorId, accion: 'CREAR', entidad: 'pedido' }),
        expect.objectContaining({ id_usuario: vendedorId, accion: 'CREAR', entidad: 'movimiento_inventario' }),
        expect.objectContaining({ id_usuario: adminId, accion: 'ANULAR', entidad: 'pedido' }),
      ])
    );

    await pool.query(`
      DROP ROLE IF EXISTS test_atelier_app_integral;
      CREATE ROLE test_atelier_app_integral NOLOGIN;
      GRANT USAGE ON SCHEMA public TO test_atelier_app_integral;
      GRANT SELECT, INSERT ON TABLE auditoria TO test_atelier_app_integral;
      GRANT USAGE, SELECT ON SEQUENCE auditoria_id_seq TO test_atelier_app_integral;
      REVOKE UPDATE, DELETE, TRUNCATE ON TABLE auditoria FROM test_atelier_app_integral;
    `);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE test_atelier_app_integral');

      await client.query('SAVEPOINT sp_upd');
      await expect(
        client.query("UPDATE auditoria SET accion = 'ALTERADO'")
      ).rejects.toMatchObject({ code: '42501' });
      await client.query('ROLLBACK TO SAVEPOINT sp_upd');

      await client.query('SAVEPOINT sp_del');
      await expect(
        client.query('DELETE FROM auditoria')
      ).rejects.toMatchObject({ code: '42501' });
      await client.query('ROLLBACK TO SAVEPOINT sp_del');

      await client.query('RESET ROLE');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
      await pool.query(`
        REVOKE ALL PRIVILEGES ON TABLE auditoria FROM test_atelier_app_integral;
        REVOKE ALL PRIVILEGES ON SEQUENCE auditoria_id_seq FROM test_atelier_app_integral;
        REVOKE USAGE ON SCHEMA public FROM test_atelier_app_integral;
        DROP ROLE IF EXISTS test_atelier_app_integral;
      `);
    }
  });

  test('INT-04: integridad referencial activa, sin tablas de carrito y rechazo de rol cliente', async () => {
    const fks = await pool.query(`
      SELECT COUNT(*)::int AS total_fks
      FROM pg_constraint
      WHERE contype = 'f'
        AND connamespace = 'public'::regnamespace
    `);
    expect(fks.rows[0].total_fks).toBeGreaterThanOrEqual(12);

    const tablasCarrito = await pool.query(`
      SELECT
        to_regclass('public.carrito_compra') AS carrito_compra,
        to_regclass('public.item_carrito') AS item_carrito
    `);
    expect(tablasCarrito.rows[0]).toEqual({
      carrito_compra: null,
      item_carrito: null,
    });

    await expect(
      pool.query(`
        INSERT INTO usuario (nombre, correo, contrasena_hash, rol)
        VALUES ('Intento Cliente', 'rechazo.cliente@atelier.com', crypt('123456', gen_salt('bf')), 'cliente')
      `)
    ).rejects.toMatchObject({ code: '23514' });
  });
});


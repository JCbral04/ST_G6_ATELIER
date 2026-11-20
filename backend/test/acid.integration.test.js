const fs = require('node:fs');
const path = require('node:path');
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
      auditoria,
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

    const duplicada = await request(app)
      .post(`/api/pedidos/${idPedido}/cancelar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    expect(duplicada.status).toBe(409);

    expect(await stock(varianteA)).toBe(10);
    expect(await stock(varianteB)).toBe(10);

    const datos = await estadoTransaccional();
    expect(datos.movimientos).toBe(4);
  });
});

describe('Issue #27 — Bitácora de auditoría de operaciones críticas (RNF-09)', () => {

  test('AUD-01: venta y anulacion exitosas registran eventos atribuidos a la sesion correcta', async () => {
    const venta = await vender([
      { id_variante: varianteA, cantidad: 2 }
    ]);
    expect(venta.status).toBe(201);
    const idPedido = venta.body.id_pedido;

    const cancelacion = await request(app)
      .post(`/api/pedidos/${idPedido}/cancelar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(cancelacion.status).toBe(200);

    const eventos = await pool.query(
      `SELECT id_usuario, accion, entidad, id_entidad, detalle
       FROM auditoria
       WHERE entidad = 'pedido' AND id_entidad = $1
       ORDER BY id ASC`,
      [idPedido]
    );

    expect(eventos.rows).toHaveLength(2);
    expect(eventos.rows[0]).toMatchObject({
      id_usuario: vendedorId,
      accion: 'CREAR',
      entidad: 'pedido',
      id_entidad: idPedido
    });
    expect(eventos.rows[1]).toMatchObject({
      id_usuario: adminId,
      accion: 'ANULAR',
      entidad: 'pedido',
      id_entidad: idPedido,
      detalle: {
        estado_anterior: 'pendiente',
        estado_nuevo: 'cancelado'
      }
    });
  });

  test('AUD-02: fallo controlado al insertar auditoria revierte la operacion y el stock', async () => {
    await pool.query(`
      CREATE FUNCTION fn_auditoria_fallo_controlado()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'AUD_TEST_FALLO_CONTROLADO';
      END;
      $$ LANGUAGE plpgsql
    `);

    await pool.query(`
      CREATE TRIGGER trg_auditoria_fallo_controlado
      BEFORE INSERT ON auditoria
      FOR EACH ROW
      EXECUTE FUNCTION fn_auditoria_fallo_controlado()
    `);

    try {
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

      const aud = await pool.query('SELECT COUNT(*)::int AS total FROM auditoria');
      expect(aud.rows[0].total).toBe(0);
    } finally {
      await pool.query(`
        DROP TRIGGER IF EXISTS trg_auditoria_fallo_controlado ON auditoria;
        DROP FUNCTION IF EXISTS fn_auditoria_fallo_controlado();
      `);
    }
  });

  test('AUD-03: cancelacion repetida responde 409 y no genera evento adicional en auditoria', async () => {
    const venta = await vender([
      { id_variante: varianteA, cantidad: 1 }
    ]);
    expect(venta.status).toBe(201);
    const idPedido = venta.body.id_pedido;

    const primera = await request(app)
      .post(`/api/pedidos/${idPedido}/cancelar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(primera.status).toBe(200);

    const repetida = await request(app)
      .post(`/api/pedidos/${idPedido}/cancelar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(repetida.status).toBe(409);

    const eventos = await pool.query(
      `SELECT accion
       FROM auditoria
       WHERE entidad = 'pedido' AND id_entidad = $1
       ORDER BY id ASC`,
      [idPedido]
    );

    expect(eventos.rows.map(r => r.accion)).toEqual(['CREAR', 'ANULAR']);
  });

  test('AUD-04: consulta GET /api/auditoria valida sesion (401), rol (403/200) y filtros', async () => {
    await vender([{ id_variante: varianteA, cantidad: 1 }]);

    const sinSesion = await request(app).get('/api/auditoria');
    expect(sinSesion.status).toBe(401);

    const comoVendedor = await request(app)
      .get('/api/auditoria')
      .set('Authorization', `Bearer ${vendedorToken}`);
    expect(comoVendedor.status).toBe(403);

    const comoAdmin = await request(app)
      .get('/api/auditoria')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(comoAdmin.status).toBe(200);
    expect(comoAdmin.body).toHaveLength(1);
    expect(comoAdmin.body[0]).toMatchObject({
      id_usuario: vendedorId,
      accion: 'CREAR',
      entidad: 'pedido'
    });

    const filtroEntidad = await request(app)
      .get('/api/auditoria?entidad=movimiento_inventario')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(filtroEntidad.status).toBe(200);
    expect(filtroEntidad.body).toEqual([]);

    const filtroFechaFutura = await request(app)
      .get('/api/auditoria?fecha_desde=2099-01-01&fecha_hasta=2099-12-31')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(filtroFechaFutura.status).toBe(200);
    expect(filtroFechaFutura.body).toEqual([]);

    const hoy = new Date().toISOString().slice(0, 10);
    const filtroHoy = await request(app)
      .get(`/api/auditoria?fecha_desde=${hoy}&fecha_hasta=${hoy}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(filtroHoy.status).toBe(200);
    expect(filtroHoy.body).toHaveLength(1);
  });

  test('AUD-05: movimientos de inventario requieren sesion (401) e ignoran id_usuario del body', async () => {
    const sinSesion = await request(app)
      .post('/api/inventario/movimientos')
      .send({
        id_usuario: adminId,
        id_variante: varianteA,
        tipo: 'entrada',
        cantidad: 5,
        motivo: 'Intento sin token'
      });
    expect(sinSesion.status).toBe(401);
    expect(await stock(varianteA)).toBe(10);

    const autorizado = await request(app)
      .post('/api/inventario/movimientos')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .send({
        id_usuario: adminId,
        id_variante: varianteA,
        tipo: 'entrada',
        cantidad: 4,
        motivo: 'Reposición verificada'
      });

    expect(autorizado.status).toBe(201);
    expect(autorizado.body.movimiento.id_usuario).toBe(vendedorId);
    expect(await stock(varianteA)).toBe(14);

    const aud = await pool.query(
      `SELECT id_usuario, accion, entidad, id_entidad, detalle
       FROM auditoria
       WHERE entidad = 'movimiento_inventario'`
    );
    expect(aud.rows).toHaveLength(1);
    expect(aud.rows[0]).toMatchObject({
      id_usuario: vendedorId,
      accion: 'CREAR',
      entidad: 'movimiento_inventario',
      id_entidad: autorizado.body.movimiento.id_movimiento
    });
  });

  test('AUD-06: rol de aplicacion permite SELECT/INSERT en auditoria pero bloquea UPDATE y DELETE', async () => {
    await pool.query(`
      DROP ROLE IF EXISTS test_atelier_app_aud;
      CREATE ROLE test_atelier_app_aud NOLOGIN;
      GRANT USAGE ON SCHEMA public TO test_atelier_app_aud;
      GRANT SELECT, INSERT ON TABLE auditoria TO test_atelier_app_aud;
      GRANT USAGE, SELECT ON SEQUENCE auditoria_id_seq TO test_atelier_app_aud;
      REVOKE UPDATE, DELETE, TRUNCATE ON TABLE auditoria FROM test_atelier_app_aud;
    `);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE test_atelier_app_aud');

      const ins = await client.query(
        `INSERT INTO auditoria (id_usuario, accion, entidad, id_entidad, detalle)
         VALUES ($1, 'CREAR', 'pedido', 1, '{}'::jsonb)
         RETURNING id`,
        [vendedorId]
      );
      expect(ins.rows).toHaveLength(1);
      const idAud = ins.rows[0].id;

      const sel = await client.query('SELECT id FROM auditoria WHERE id = $1', [idAud]);
      expect(sel.rows).toHaveLength(1);

      await client.query('SAVEPOINT sp_update');
      await expect(
        client.query("UPDATE auditoria SET accion = 'ANULAR' WHERE id = $1", [idAud])
      ).rejects.toMatchObject({ code: '42501' });
      await client.query('ROLLBACK TO SAVEPOINT sp_update');

      await client.query('SAVEPOINT sp_delete');
      await expect(
        client.query('DELETE FROM auditoria WHERE id = $1', [idAud])
      ).rejects.toMatchObject({ code: '42501' });
      await client.query('ROLLBACK TO SAVEPOINT sp_delete');

      await client.query('RESET ROLE');
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
      await pool.query(`
        REVOKE ALL PRIVILEGES ON TABLE auditoria FROM test_atelier_app_aud;
        REVOKE ALL PRIVILEGES ON SEQUENCE auditoria_id_seq FROM test_atelier_app_aud;
        REVOKE USAGE ON SCHEMA public FROM test_atelier_app_aud;
        DROP ROLE IF EXISTS test_atelier_app_aud;
      `);
    }
  });
});

describe('Issue #10 / PR #15 — Catálogo de productos, inventario y alertas (RF-06, RF-09, RF-10)', () => {

  test('CAT-01: los tres endpoints GET rechazan peticiones sin sesión (401)', async () => {
    const rutas = ['/api/productos', '/api/inventario', '/api/inventario/alertas'];

    for (const ruta of rutas) {
      const response = await request(app).get(ruta);
      expect(response.status).toBe(401);
    }
  });

  test('CAT-02: personal autenticado consulta productos, inventario y alertas del seed (200) excluyendo inactivos', async () => {
    const prodRes = await request(app)
      .get('/api/productos')
      .set('Authorization', `Bearer ${vendedorToken}`);

    expect(prodRes.status).toBe(200);
    const camiseta = prodRes.body.find(p => p.producto === 'Camiseta básica algodón');
    const jean = prodRes.body.find(p => p.producto === 'Jean clásico azul');
    const chaqueta = prodRes.body.find(p => p.producto === 'Chaqueta denim');

    expect(camiseta).toBeDefined();
    expect(Number(camiseta.stock_total)).toBe(20);
    expect(jean).toBeDefined();
    expect(Number(jean.stock_total)).toBe(30);
    expect(chaqueta).toBeDefined();
    expect(Number(chaqueta.stock_total)).toBe(15);

    const invRes = await request(app)
      .get('/api/inventario')
      .set('Authorization', `Bearer ${vendedorToken}`);

    expect(invRes.status).toBe(200);
    expect(invRes.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sku: 'CAM-NEG-M', stock: 10, stock_minimo: 10 }),
        expect.objectContaining({ sku: 'CAM-BLA-M', stock: 10, stock_minimo: 10 }),
        expect.objectContaining({ sku: 'JEA-AZU-32', stock: 30, stock_minimo: 5 }),
        expect.objectContaining({ sku: 'CHA-AZU-L', stock: 15, stock_minimo: 3 }),
      ])
    );

    const prodInactivo = await pool.query(`
      INSERT INTO producto (nombre, descripcion, precio, stock_minimo, activo, id_categoria)
      VALUES ('Producto Inactivo Prueba', 'No debe alertar', 50000, 5, FALSE, 1)
      RETURNING id_producto
    `);
    const idProdInactivo = prodInactivo.rows[0].id_producto;

    const varInactiva = await pool.query(`
      INSERT INTO variante_producto (sku, stock, id_producto, id_talla, id_color)
      VALUES ('INA-PRU-S', 0, $1, 2, 1)
      RETURNING id_variante
    `, [idProdInactivo]);
    const idVarInactiva = varInactiva.rows[0].id_variante;

    try {
      const alertasRes = await request(app)
        .get('/api/inventario/alertas')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(alertasRes.status).toBe(200);
      const skusAlerta = alertasRes.body.map(a => a.sku);

      expect(skusAlerta).toEqual(expect.arrayContaining(['CAM-NEG-M', 'CAM-BLA-M']));
      expect(skusAlerta).not.toContain('JEA-AZU-32');
      expect(skusAlerta).not.toContain('CHA-AZU-L');
      expect(skusAlerta).not.toContain('INA-PRU-S');
    } finally {
      await pool.query('DELETE FROM variante_producto WHERE id_variante = $1', [idVarInactiva]);
      await pool.query('DELETE FROM producto WHERE id_producto = $1', [idProdInactivo]);
    }
  });
});

describe('Issue #16 — Migración 005 sobre base de datos existente', () => {
  test('MIG-05: actualiza base previa con carrito y clientes legados, conserva historial y es idempotente', async () => {
    const migracion005Path = path.resolve(
      __dirname,
      '../../db/migrations/005_eliminar_carrito_ecommerce.sql'
    );
    const migracion005Sql = fs.readFileSync(migracion005Path, 'utf8');

    await pool.query(`
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
      const resClienteHist = await pool.query(`
        INSERT INTO usuario (nombre, correo, contrasena_hash, rol)
        VALUES ('Cliente Historico', 'cliente.hist@atelier.com', crypt('123456', gen_salt('bf')), 'cliente')
        RETURNING id_usuario
      `);
      const clienteHistId = resClienteHist.rows[0].id_usuario;

      await pool.query(`
        INSERT INTO sesion_usuario (id_usuario, token_hash, fecha_expiracion)
        VALUES ($1, 'hash_sesion_cliente_hist', NOW() + INTERVAL '1 hour')
      `, [clienteHistId]);

      const resPedidoHist = await pool.query(`
        INSERT INTO pedido (id_usuario, total, estado)
        VALUES ($1, 45000, 'entregado')
        RETURNING id_pedido
      `, [clienteHistId]);
      const pedidoHistId = resPedidoHist.rows[0].id_pedido;

      const resClienteSin = await pool.query(`
        INSERT INTO usuario (nombre, correo, contrasena_hash, rol)
        VALUES ('Cliente Sin Historial', 'cliente.sin@atelier.com', crypt('123456', gen_salt('bf')), 'cliente')
        RETURNING id_usuario
      `);
      const clienteSinId = resClienteSin.rows[0].id_usuario;

      await pool.query(`
        INSERT INTO sesion_usuario (id_usuario, token_hash, fecha_expiracion)
        VALUES ($1, 'hash_sesion_cliente_sin', NOW() + INTERVAL '1 hour')
      `, [clienteSinId]);

      const resCarrito = await pool.query(`
        INSERT INTO carrito_compra (id_usuario)
        VALUES ($1)
        RETURNING id_carrito
      `, [clienteSinId]);

      await pool.query(`
        INSERT INTO item_carrito (cantidad, id_carrito, id_variante)
        VALUES (1, $1, $2)
      `, [resCarrito.rows[0].id_carrito, varianteA]);

      await pool.query(migracion005Sql);

      const tablas = await pool.query(`
        SELECT
          to_regclass('public.item_carrito') AS item_carrito,
          to_regclass('public.carrito_compra') AS carrito_compra
      `);
      expect(tablas.rows[0]).toEqual({
        item_carrito: null,
        carrito_compra: null
      });

      const sinHist = await pool.query(
        'SELECT id_usuario FROM usuario WHERE id_usuario = $1',
        [clienteSinId]
      );
      expect(sinHist.rows).toHaveLength(0);

      const conHist = await pool.query(
        'SELECT id_usuario, rol FROM usuario WHERE id_usuario = $1',
        [clienteHistId]
      );
      expect(conHist.rows).toHaveLength(1);

      const pedidoConservado = await pool.query(
        'SELECT id_pedido, id_usuario FROM pedido WHERE id_pedido = $1',
        [pedidoHistId]
      );
      expect(pedidoConservado.rows).toHaveLength(1);

      const sesionRevocada = await pool.query(
        'SELECT fecha_revocacion FROM sesion_usuario WHERE id_usuario = $1',
        [clienteHistId]
      );
      expect(sesionRevocada.rows).toHaveLength(1);
      expect(sesionRevocada.rows[0].fecha_revocacion).not.toBeNull();

      const loginLegado = await request(app)
        .post('/api/auth/login')
        .send({ correo: 'cliente.hist@atelier.com', contrasena: '123456' });
      expect(loginLegado.status).toBe(401);

      await expect(pool.query(migracion005Sql)).resolves.toBeDefined();

      const pedidoTrasReejecucion = await pool.query(
        'SELECT id_pedido FROM pedido WHERE id_pedido = $1',
        [pedidoHistId]
      );
      expect(pedidoTrasReejecucion.rows).toHaveLength(1);
    } finally {
      await pool.query('DROP TABLE IF EXISTS item_carrito');
      await pool.query('DROP TABLE IF EXISTS carrito_compra');
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
});
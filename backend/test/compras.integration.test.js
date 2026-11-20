const express = require('express');
const request = require('supertest');

if (process.env.ACID_TEST_RUN !== '1' || !/^atelier_test_\d+_\d+$/.test(process.env.DB_NAME || '')) {
  throw new Error('Las pruebas de compras requieren una base temporal aislada');
}
const { pool } = require('../src/config/db');
const app = express();
app.use(express.json());
app.use('/api', require('../src/routes'));
jest.setTimeout(30000);
let a, b, proveedor, admin, vendedor, adminId;
let baseConfirmada = false;
const auth = (token) => `Bearer ${token}`;
async function login(correo) {
  const r = await request(app).post('/api/auth/login').send({ correo, contrasena: '123456' });
  expect(r.status).toBe(200);
  return r.body;
}
async function limpiar() {
  await pool.query('TRUNCATE detalle_compra, compra, movimiento_inventario, sesion_usuario RESTART IDENTITY');
  await pool.query('UPDATE variante_producto SET stock = 10 WHERE id_variante IN ($1, $2)', [a, b]);
}
const orden = () => ({ id_proveedor: proveedor, items: [
  { id_variante: a, cantidad: 2, costo_unitario: 10.25 },
  { id_variante: b, cantidad: 3, costo_unitario: 20.1 }
] });
const crear = (body = orden()) => request(app).post('/api/compras').set('Authorization', auth(admin)).send(body);
const recibir = (id) => request(app).patch(`/api/compras/${id}`).set('Authorization', auth(admin)).send({ estado: 'recibida' });
async function estado() {
  const r = await pool.query(`SELECT
    (SELECT COUNT(*)::int FROM compra) AS compras,
    (SELECT COUNT(*)::int FROM detalle_compra) AS detalles,
    (SELECT COUNT(*)::int FROM movimiento_inventario) AS movimientos,
    (SELECT stock FROM variante_producto WHERE id_variante = $1) AS a,
    (SELECT stock FROM variante_producto WHERE id_variante = $2) AS b`, [a, b]);
  return r.rows[0];
}
beforeAll(async () => {
  const db = await pool.query('SELECT current_database() AS nombre');
  expect(db.rows[0].nombre).toBe(process.env.DB_NAME);
  const result = await pool.query("SELECT id_variante, sku FROM variante_producto WHERE sku IN ('CAM-NEG-M', 'CAM-BLA-M')");
  a = result.rows.find(v => v.sku === 'CAM-NEG-M').id_variante;
  b = result.rows.find(v => v.sku === 'CAM-BLA-M').id_variante;
  proveedor = (await pool.query('SELECT id_proveedor FROM proveedor ORDER BY id_proveedor LIMIT 1')).rows[0].id_proveedor;
  baseConfirmada = true;
});
beforeEach(async () => {
  if (!baseConfirmada) throw new Error('Base temporal no verificada');
  await limpiar();
  const u = await login('admin@atelier.com');
  admin = u.token; adminId = u.usuario.id_usuario;
  vendedor = (await login('vendedor@atelier.com')).token;
});
afterEach(async () => { if (baseConfirmada) await limpiar(); });
afterAll(async () => { await pool.end(); });

test('COM-01: las cuatro operaciones requieren administrador', async () => {
  const casos = [['get','/api/proveedores'], ['get','/api/compras'], ['post','/api/compras'], ['patch','/api/compras/1']];
  for (const [method, path] of casos) {
    expect((await request(app)[method](path)).status).toBe(401);
    expect((await request(app)[method](path).set('Authorization', auth(vendedor))).status).toBe(403);
  }
  expect(await estado()).toEqual({ compras: 0, detalles: 0, movimientos: 0, a: 10, b: 10 });
});

test('COM-02: consulta proveedores y crea compra exacta sin tocar stock', async () => {
  const p = await request(app).get('/api/proveedores').set('Authorization', auth(admin));
  expect(p.status).toBe(200);
  expect(p.body).toEqual(expect.arrayContaining([expect.objectContaining({ id_proveedor: proveedor, nombre: expect.any(String) })]));
  const r = await crear();
  expect(r.status).toBe(201);
  expect(r.body).toMatchObject({ total: 80.8, estado: 'pendiente' });
  const listado = await request(app).get('/api/compras').set('Authorization', auth(admin));
  expect(listado.status).toBe(200);
  expect(listado.body[0]).toMatchObject({ id_compra: r.body.id_compra, total: 80.8, estado: 'pendiente', proveedor: expect.any(String), items: [
    { id_variante: a, sku: 'CAM-NEG-M', cantidad: 2, costo_unitario: 10.25 },
    { id_variante: b, sku: 'CAM-BLA-M', cantidad: 3, costo_unitario: 20.1 }
  ] });
  expect(await estado()).toEqual({ compras: 1, detalles: 2, movimientos: 0, a: 10, b: 10 });
});

test('COM-03: rechaza entradas inválidas, duplicados y referencias inexistentes', async () => {
  const d = orden(); d.items.push({ ...d.items[0] });
  expect((await crear(d)).status).toBe(400);
  for (const invalido of [0, -1, 1.001, 100000000]) {
    const o = orden(); o.items[0].costo_unitario = invalido;
    expect((await crear(o)).status).toBe(400);
  }
  const o = orden(); o.items[0].cantidad = 1.5;
  expect((await crear(o)).status).toBe(400);
  expect((await crear({ ...orden(), id_proveedor: 2147483647 })).status).toBe(404);
  const v = orden(); v.items[1].id_variante = 2147483647;
  expect((await crear(v)).status).toBe(404);
  expect(await estado()).toEqual({ compras: 0, detalles: 0, movimientos: 0, a: 10, b: 10 });
});

test('COM-04: fallo del segundo detalle revierte cabecera y primer detalle', async () => {
  await pool.query(`CREATE FUNCTION fn_test_compra_detalle() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.id_variante = (SELECT id_variante FROM variante_producto WHERE sku = 'CAM-BLA-M') THEN
        RAISE EXCEPTION 'FALLO_CONTROLADO_COMPRA';
      END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER trg_test_compra_detalle BEFORE INSERT ON detalle_compra
    FOR EACH ROW EXECUTE FUNCTION fn_test_compra_detalle();`);
  try {
    expect((await crear()).status).toBe(500);
    expect(await estado()).toEqual({ compras: 0, detalles: 0, movimientos: 0, a: 10, b: 10 });
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS trg_test_compra_detalle ON detalle_compra; DROP FUNCTION IF EXISTS fn_test_compra_detalle();');
  }
});

test('COM-05: dos recepciones concurrentes solo incrementan stock una vez', async () => {
  const r = await crear(); expect(r.status).toBe(201);
  const id = r.body.id_compra;
  const responses = await Promise.all([recibir(id), recibir(id)]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  expect(await estado()).toEqual({ compras: 1, detalles: 2, movimientos: 2, a: 12, b: 13 });
  const c = await pool.query('SELECT estado FROM compra WHERE id_compra = $1', [id]);
  expect(c.rows[0].estado).toBe('recibida');
  const m = await pool.query('SELECT tipo, cantidad, id_variante, id_usuario, motivo FROM movimiento_inventario');
  expect(m.rows).toEqual(expect.arrayContaining([
    { tipo: 'entrada', cantidad: 2, id_variante: a, id_usuario: adminId, motivo: `Recepción de compra #${id}` },
    { tipo: 'entrada', cantidad: 3, id_variante: b, id_usuario: adminId, motivo: `Recepción de compra #${id}` }
  ]));
});

test('COM-06: compra inexistente o cancelada no puede recibirse', async () => {
  expect((await recibir(2147483647)).status).toBe(404);
  const r = await crear(); expect(r.status).toBe(201);
  await pool.query("UPDATE compra SET estado = 'cancelada' WHERE id_compra = $1", [r.body.id_compra]);
  expect((await recibir(r.body.id_compra)).status).toBe(409);
  expect(await estado()).toEqual({ compras: 1, detalles: 2, movimientos: 0, a: 10, b: 10 });
});

test('COM-07: fallo de trazabilidad revierte recepción y aumento de stock', async () => {
  const r = await crear(); expect(r.status).toBe(201);
  await pool.query(`CREATE FUNCTION fn_test_compra_mov() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'FALLO_CONTROLADO_MOVIMIENTO'; END; $$;
    CREATE TRIGGER trg_test_compra_mov BEFORE INSERT ON movimiento_inventario
    FOR EACH ROW EXECUTE FUNCTION fn_test_compra_mov();`);
  try {
    expect((await recibir(r.body.id_compra)).status).toBe(500);
    const c = await pool.query('SELECT estado FROM compra WHERE id_compra = $1', [r.body.id_compra]);
    expect(c.rows[0].estado).toBe('pendiente');
    expect(await estado()).toEqual({ compras: 1, detalles: 2, movimientos: 0, a: 10, b: 10 });
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS trg_test_compra_mov ON movimiento_inventario; DROP FUNCTION IF EXISTS fn_test_compra_mov();');
  }
});

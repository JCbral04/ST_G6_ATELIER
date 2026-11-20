/* =============================================================
   Pruebas de aislamiento de sesión del panel (SES-01 a SES-10)

   Corre el panel real en Chromium contra una API simulada con demoras
   controladas, para reproducir carreras entre sesiones sin depender de
   la base de datos. No usa credenciales reales: los tokens son falsos.

   Uso:
     cd frontend/test
     npm install
     npx playwright install chromium
     npm test
   ============================================================= */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const espera = ms => new Promise(r => setTimeout(r, ms));

/* ---------- Servidor estático del frontend ---------- */
function servir() {
  const srv = http.createServer((req, res) => {
    const ruta = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const archivo = path.join(RAIZ, ruta === '/' ? 'index.html' : ruta);
    if (!archivo.startsWith(RAIZ) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
    fs.createReadStream(archivo).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

/* ---------- API simulada ---------- */
// Cada login entrega un token distinto. Los datos llevan una marca con el
// número de sesión (S1, S2...) para detectar si se cuelan en otra sesión.
function crearApi() {
  const api = {
    sesiones: {},          // token -> { n, usuario, revocado }
    n: 0,
    demoras: {},           // 'GET /api/inventario' -> ms
    respuestas: {},        // 'GET /api/inventario' -> fn(token) => { status, body } | undefined
    log: [],               // peticiones recibidas
  };
  const usuarios = {
    'admin@atelier.test': { id_usuario: 1, nombre: 'Admin prueba', rol: 'administrador' },
    'vendedor@atelier.test': { id_usuario: 3, nombre: 'Vendedor prueba', rol: 'vendedor' },
    'cliente@atelier.test': { id_usuario: 2, nombre: 'Cliente prueba', rol: 'cliente' },
  };
  const datos = {
    '/api/inventario': m => [{ id_variante: 1, sku: 'SKU-' + m, id_producto: 1, producto: 'Camiseta ' + m, categoria: 'Camisetas',
      talla: 'M', color: 'Negro', codigo_hex: '#000000', precio: '45000.00', stock: 20, stock_minimo: 5 }],
    '/api/pedidos': m => [{ id_pedido: 7, fecha: '2026-11-20T15:00:00Z', estado: 'pendiente', total: '45000.00', usuario: 'Pedido ' + m }],
    '/api/inventario/movimientos': m => [{ id_movimiento: 1, fecha: '2026-11-20T15:00:00Z', tipo: 'entrada', cantidad: 5, motivo: 'Mov ' + m,
      id_variante: 1, sku: 'SKU-' + m, producto: 'Camiseta', talla: 'M', color: 'Negro', usuario: 'x' }],
    '/api/compras': m => [{ id_compra: 1, fecha: '2026-11-20T15:00:00Z', estado: 'pendiente', total: '100000.00', proveedor: 'Proveedor ' + m,
      items: [{ id_variante: 1, sku: 'SKU-' + m, cantidad: 2, costo_unitario: '50000.00' }] }],
    '/api/proveedores': m => [{ id_proveedor: 1, nombre: 'Proveedor ' + m, telefono: '300', correo: 'p@x.test' }],
  };

  api.manejar = async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const clave = req.method() + ' ' + url.pathname;
    const auth = req.headers().authorization || '';
    const token = auth.replace(/^Bearer /, '') || null;
    api.log.push({ clave, token, t: Date.now() });
    // La respuesta se calcula al recibir la petición (como un servidor que ya
    // la procesó) y se entrega después de la demora configurada.
    const ms = api.demoras[clave] || 0;
    const responder = async (status, body) => {
      if (ms) await espera(ms);
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
    };
    const especial = api.respuestas[clave] && api.respuestas[clave](token, req);
    if (especial) return responder(especial.status, especial.body);

    if (clave === 'POST /api/auth/login') {
      const { correo } = JSON.parse(req.postData() || '{}');
      const u = usuarios[correo];
      if (!u) return responder(401, { error: 'Credenciales inválidas' });
      const n = ++api.n;
      const tk = 'tok-sesion-' + n + '-' + 'x'.repeat(30);
      api.sesiones[tk] = { n, usuario: u, revocado: false };
      return responder(200, { token: tk, usuario: u });
    }
    const ses = token && api.sesiones[token];
    if (!ses || ses.revocado) return responder(401, { error: 'Sesión inválida o expirada' });
    if (clave === 'GET /api/auth/me') return responder(200, { usuario: ses.usuario });
    if (clave === 'POST /api/auth/logout') { ses.revocado = true; return responder(200, { mensaje: 'Sesión cerrada' }); }
    if (clave === 'POST /api/pedidos') return responder(201, { id_pedido: 99, total: '45000.00', estado: 'pendiente' });
    if (req.method() === 'GET' && datos[url.pathname]) {
      if (url.pathname.startsWith('/api/compras') || url.pathname.startsWith('/api/proveedores')) {
        if (ses.usuario.rol !== 'administrador') return responder(403, { error: 'Acceso denegado' });
      }
      return responder(200, datos[url.pathname]('S' + ses.n));
    }
    return responder(404, { error: 'No existe' });
  };
  return api;
}

/* ---------- Utilidades del navegador ---------- */
async function nuevaPagina(browser, base, api) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  page.errores = [];
  page.on('pageerror', e => page.errores.push(e.message));
  await page.route('**/api/**', api.manejar);
  await page.goto(base);
  await page.waitForSelector('#login:not([hidden])');
  return page;
}
async function loginReal(page, correo, { esperar = true } = {}) {
  await page.waitForSelector('#login:not([hidden])');
  await page.fill('#correo', correo);
  await page.fill('#contrasena', 'clave-de-prueba');
  // Clic inmediato, sin esperar la animación de la etiqueta (como una persona rápida)
  await page.click('button[type=submit]', { force: true });
  if (esperar) await esperarCarga(page);
}
// Espera a que el panel termine la carga inicial de la sesión
async function esperarCarga(page) {
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForFunction(() => Object.keys(Atelier.store.estado).length > 0);
}
// Deja una carga en vuelo, como la recarga que el panel hace después de cada operación
const cargaEnVuelo = page => page.evaluate(() => { Atelier.api.load().catch(() => {}); });
async function entrarDemo(page, rol) {
  await page.waitForSelector('#login:not([hidden])');
  await page.click(`[data-demo-rol="${rol}"]`, { force: true });
  await page.waitForSelector('#app:not([hidden])');
}
const estado = page => page.evaluate(() => ({
  modo: Atelier.store.modo,
  usuario: Atelier.session && Atelier.session.nombre,
  rol: Atelier.session && Atelier.session.rol,
  token: Atelier.token,
  variantes: Atelier.store.variantes.map(v => v.sku),
  pedidos: Atelier.store.pedidos.map(p => p.usuario),
  compras: Atelier.store.compras.map(c => c.proveedor),
  movimientos: Atelier.store.movimientos.map(m => m.motivo),
  app: !document.getElementById('app').hidden,
  login: !document.getElementById('login').hidden,
  error: document.getElementById('login-error').textContent,
  toast: document.getElementById('toast').classList.contains('show') ? document.getElementById('toast').textContent : '',
  guardada: sessionStorage.getItem('atelier.session'),
}));
const contiene = (lista, marca) => lista.some(x => String(x).indexOf(marca) !== -1);

/* ---------- Escenarios ---------- */
const ESCENARIOS = [
  ['SES-01', 'Logout durante la carga del inventario', 'Las respuestas antiguas no modifican el store', async (b, base) => {
    const api = crearApi();
    // a) Logout durante la carga inicial
    const p = await nuevaPagina(b, base, api);
    api.demoras['GET /api/inventario'] = 1500;
    await loginReal(p, 'admin@atelier.test', { esperar: false });
    await p.waitForSelector('#app:not([hidden])');
    await p.click('#logout-btn');
    const t0 = Date.now();
    await entrarDemo(p, 'vendedor');
    const reentrada = Date.now() - t0;
    await espera(2000);
    const a = await estado(p);
    // b) Logout durante una recarga del inventario
    delete api.demoras['GET /api/inventario'];
    await p.click('#logout-btn');
    await loginReal(p, 'admin@atelier.test');
    api.demoras['GET /api/inventario'] = 1500;
    await cargaEnVuelo(p);
    await espera(100);
    await p.click('#logout-btn');
    await entrarDemo(p, 'vendedor');
    await espera(2000);
    const e = await estado(p);
    const limpio = x => x.modo === 'demo' && x.rol === 'vendedor' && !/S\d/.test(x.variantes.join()) && x.variantes.length > 1;
    const ok = limpio(a) && limpio(e) && reentrada < 1000;
    return [ok, `carga inicial: datos reales en la demo=${/S\d/.test(a.variantes.join())}, demo disponible en ${reentrada} ms; ` +
      `recarga: modo=${e.modo}, datos reales en la demo=${/S\d/.test(e.variantes.join())}`, p];
  }],

  ['SES-02', 'Cambio de sesión real a demo', 'No aparecen datos reales en demo y la demo no llama a la API', async (b, base) => {
    const api = crearApi();
    const p = await nuevaPagina(b, base, api);
    await loginReal(p, 'admin@atelier.test');
    await espera(300);
    await p.click('#logout-btn');
    const antes = api.log.length;
    await entrarDemo(p, 'administrador');
    for (const v of ['dashboard', 'inventario', 'compras']) { await p.goto(base + '#/' + v); await espera(200); }
    await espera(500);
    const e = await estado(p);
    const llamadas = api.log.slice(antes).filter(x => x.clave !== 'POST /api/auth/logout');
    const marcas = ['variantes', 'pedidos', 'compras', 'movimientos'].some(k => contiene(e[k], 'S1'));
    const ok = e.modo === 'demo' && !marcas && llamadas.length === 0;
    return [ok, `modo=${e.modo}, datos S1 en demo=${marcas}, peticiones a la API durante la demo=${llamadas.length}`, p];
  }],

  ['SES-03', 'Cambio de administrador a vendedor', 'No se conservan datos exclusivos del administrador', async (b, base) => {
    const api = crearApi();
    const p = await nuevaPagina(b, base, api);
    await loginReal(p, 'admin@atelier.test');
    api.demoras['GET /api/compras'] = 1500;
    api.demoras['GET /api/proveedores'] = 1500;
    await cargaEnVuelo(p);
    await espera(100);
    await p.click('#logout-btn');
    await loginReal(p, 'vendedor@atelier.test');
    await espera(2000);
    const e = await estado(p);
    const nav = await p.$$eval('#nav a', a => a.map(x => x.dataset.v));
    const ok = e.rol === 'vendedor' && e.compras.length === 0 && nav.indexOf('compras') === -1 && !contiene(e.variantes, 'S1') && contiene(e.variantes, 'S2');
    return [ok, `rol=${e.rol}, compras en store=${e.compras.length}, menú=${nav.join('/')}, inventario=${e.variantes.join(',')}`, p];
  }],

  ['SES-04', 'Respuesta HTTP 401 de una sesión anterior', 'La nueva sesión permanece activa', async (b, base) => {
    const api = crearApi();
    const p = await nuevaPagina(b, base, api);
    let tokenViejo = null;
    api.respuestas['GET /api/pedidos'] = tk => (tk === tokenViejo ? { status: 401, body: { error: 'Sesión inválida o expirada' } } : undefined);
    await loginReal(p, 'admin@atelier.test');
    tokenViejo = (await estado(p)).token;
    // Una petición de la sesión vieja queda en vuelo y responderá 401
    api.demoras['GET /api/pedidos'] = 1500;
    await cargaEnVuelo(p);
    await espera(100);
    await p.click('#logout-btn');
    await loginReal(p, 'vendedor@atelier.test');
    delete api.demoras['GET /api/pedidos'];
    await espera(2000);
    const e = await estado(p);
    const ok = e.app && e.rol === 'vendedor' && !!e.token && e.token !== tokenViejo && !e.error;
    return [ok, `app visible=${e.app}, rol=${e.rol}, token nuevo activo=${!!e.token && e.token !== tokenViejo}, aviso de sesión vencida="${e.error}"`, p];
  }],

  ['SES-05', 'Login real y activación simultánea de demo', 'Solo se permite un flujo de autenticación', async (b, base) => {
    const api = crearApi();
    const p = await nuevaPagina(b, base, api);
    api.demoras['POST /api/auth/login'] = 1500;
    await loginReal(p, 'admin@atelier.test', { esperar: false });
    await espera(150);
    const deshabilitados = await p.$$eval('[data-demo-rol], button[type=submit]', bs => bs.every(x => x.disabled));
    // Forzar el clic aunque el botón esté deshabilitado: la lógica también debe bloquearlo
    await p.evaluate(() => { const d = document.querySelector('[data-demo-rol=vendedor]'); d.disabled = false; d.click(); });
    await p.evaluate(() => { document.getElementById('login-form').requestSubmit(); });
    await p.waitForSelector('#app:not([hidden])');
    await espera(600);
    const e = await estado(p);
    const logins = api.log.filter(x => x.clave === 'POST /api/auth/login').length;
    const ok = deshabilitados && e.modo === 'real' && e.rol === 'administrador' && logins === 1;
    return [ok, `botones bloqueados=${deshabilitados}, modo final=${e.modo}, rol=${e.rol}, peticiones de login=${logins}`, p];
  }],

  ['SES-06', 'Logout remoto lento seguido de nuevo login', 'La finalización del logout no elimina la nueva sesión', async (b, base) => {
    const api = crearApi();
    const p = await nuevaPagina(b, base, api);
    await loginReal(p, 'admin@atelier.test');
    const viejo = (await estado(p)).token;
    api.demoras['POST /api/auth/logout'] = 2000;
    await p.click('#logout-btn');
    const tras = await estado(p);
    await loginReal(p, 'vendedor@atelier.test');
    await espera(2500);
    const e = await estado(p);
    const revocacion = api.log.find(x => x.clave === 'POST /api/auth/logout');
    const guardada = JSON.parse(e.guardada || 'null');
    const ok = !tras.token && !tras.guardada && e.app && e.rol === 'vendedor' && guardada && guardada.token === e.token &&
      revocacion && revocacion.token === viejo && api.sesiones[viejo].revocado;
    return [ok, `sesión local cerrada al instante=${!tras.token && !tras.guardada}, revocación con el token viejo=${!!revocacion && revocacion.token === viejo}, ` +
      `nueva sesión intacta=${e.app && e.rol === 'vendedor' && !!guardada && guardada.token === e.token}`, p];
  }],

  ['SES-07', 'Recuperación de sesión invalidada durante la espera', 'No se reactiva una sesión obsoleta', async (b, base) => {
    const api = crearApi();
    const p = await nuevaPagina(b, base, api);
    await loginReal(p, 'admin@atelier.test');
    const tk = (await estado(p)).token;
    // a) El token se revoca en el servidor y la pestaña se recarga: /me lento responde 401
    api.sesiones[tk].revocado = true;
    api.demoras['GET /api/auth/me'] = 1200;
    await p.reload();
    await espera(1800);
    const a = await estado(p);
    // b) Sesión válida, pero se cierra localmente mientras /me sigue pendiente
    const p2 = await nuevaPagina(b, base, api);
    await loginReal(p2, 'admin@atelier.test');
    await p2.reload();
    await espera(200);
    await p2.evaluate(() => Atelier.api.olvidarSesion());
    await espera(1500);
    const bb = await estado(p2);
    await p2.context().close();
    const ok = a.login && !a.app && !a.guardada && !a.token && bb.login && !bb.app && !bb.token && !bb.guardada;
    return [ok, `revocada: login visible=${a.login}, panel=${a.app}, sesión guardada=${!!a.guardada}; ` +
      `cerrada durante la espera: login visible=${bb.login}, panel=${bb.app}, token=${!!bb.token}`, p];
  }],

  ['SES-08', 'Recarga posterior a una operación con cambio de sesión', 'No se generan modificaciones ni confirmaciones en la nueva sesión', async (b, base) => {
    const api = crearApi();
    const p = await nuevaPagina(b, base, api);
    await loginReal(p, 'vendedor@atelier.test');
    await p.waitForSelector('[data-add="1"]');
    await p.click('[data-add="1"]');
    api.demoras['GET /api/inventario'] = 1500;   // la recarga después de vender queda lenta
    await p.click('#checkout');
    await espera(300);
    await p.click('#logout-btn');
    await entrarDemo(p, 'administrador');
    const demoAntes = await estado(p);
    await espera(2000);
    const e = await estado(p);
    const ok = e.modo === 'demo' && !/Venta confirmada/.test(e.toast) && !contiene(e.variantes, 'S1') &&
      JSON.stringify(e.pedidos) === JSON.stringify(demoAntes.pedidos);
    return [ok, `modo=${e.modo}, confirmación mostrada="${e.toast}", datos S1 en store=${contiene(e.variantes, 'S1')}, pedidos demo sin cambios=${JSON.stringify(e.pedidos) === JSON.stringify(demoAntes.pedidos)}`, p];
  }],

  ['SES-09', 'Respuesta antigua de la verificación de movimientos', 'No se modifica la habilitación de ajustes de la sesión actual', async (b, base) => {
    const api = crearApi();
    const p = await nuevaPagina(b, base, api);
    await loginReal(p, 'admin@atelier.test');
    api.demoras['GET /api/inventario/movimientos'] = 1500;
    await cargaEnVuelo(p);
    await espera(100);
    await p.click('#logout-btn');
    delete api.demoras['GET /api/inventario/movimientos'];   // la sesión nueva carga rápido; la vieja llega después
    await loginReal(p, 'vendedor@atelier.test');
    await espera(2000);
    const e = await estado(p);
    const puede = await p.evaluate(() => Atelier.api.puede('ajustar'));
    const sinToken = api.log.filter(x => x.clave === 'GET /api/inventario/movimientos' && !x.token).length;
    const ok = puede.ok && sinToken === 0 && !contiene(e.movimientos, 'S1');
    return [ok, `ajustes habilitados=${puede.ok}, peticiones sin token a movimientos=${sinToken}, historial con datos S1=${contiene(e.movimientos, 'S1')}`, p];
  }],

  ['SES-10', 'Expiración de la sesión vigente', 'Se vuelve correctamente al login', async (b, base) => {
    const api = crearApi();
    const p = await nuevaPagina(b, base, api);
    await loginReal(p, 'vendedor@atelier.test');
    await p.waitForSelector('[data-add="1"]');
    await p.click('[data-add="1"]');
    const tk = (await estado(p)).token;
    api.sesiones[tk].revocado = true;               // el token vence en el servidor
    await p.click('#checkout');
    await espera(800);
    const e = await estado(p);
    const ok = e.login && !e.app && /venció/.test(e.error) && e.modo === null && !e.token && !e.guardada && e.variantes.length === 0;
    return [ok, `login visible=${e.login}, mensaje="${e.error}", modo=${e.modo}, store vacío=${e.variantes.length === 0}`, p];
  }],

  ['IA-01', 'Prediccion autenticada', 'Administrador consulta IA con token y obtiene recomendaciones', async (b, base) => {
    const api = crearApi();
    const p = await nuevaPagina(b, base, api);
    api.respuestas['POST /api/ia/reposicion'] = () => ({
      status: 200,
      body: {
        modo: 'prediccion',
        fecha_corte: '2026-11-20',
        advertencias: [],
        items: [{
          sku: 'SKU-IA',
          producto: 'Camiseta',
          stock: 5,
          transito: 0,
          modelo: 'ridge',
          demanda_diaria: 2,
          cobertura_dias: 2.5,
          riesgo: 'ALTO',
          cantidad_sugerida: 25
        }]
      }
    });
    await loginReal(p, 'admin@atelier.test');
    await p.click('[data-v="ia"]');
    await p.click('#ia-run');
    await p.waitForFunction(() =>
      document.querySelector('#ia-results').textContent.includes('SKU-IA')
    );
    const llamadas = api.log.filter(x =>
      x.clave === 'POST /api/ia/reposicion' && x.token
    );
    return [llamadas.length === 1, 'Prediccion visible y autenticada', p];
  }],

  ['IA-02', 'Fallback estatico', 'Las alertas no se presentan como predicciones', async (b, base) => {
    const api = crearApi();
    const p = await nuevaPagina(b, base, api);
    api.respuestas['POST /api/ia/reposicion'] = () => ({
      status: 200,
      body: {
        modo: 'alerta_estatica',
        advertencias: ['IA no disponible'],
        items: [{
          sku: 'SKU-FALLBACK',
          producto: 'Camiseta',
          stock: 1,
          transito: '0',
          cantidad_sugerida: '4'
        }]
      }
    });
    await loginReal(p, 'admin@atelier.test');
    await p.click('[data-v="ia"]');
    await p.click('#ia-run');
    await p.waitForFunction(() =>
      document.querySelector('#ia-results').textContent.includes('SKU-FALLBACK')
    );
    const msg = await p.textContent('#ia-status');
    return [msg.includes('alertas estáticas'), 'Fallback identificado', p];
  }],

  ['IA-03', 'Modo demo', 'La demo no consulta IA', async (b, base) => {
    const api = crearApi();
    const p = await nuevaPagina(b, base, api);
    await entrarDemo(p, 'administrador');
    await p.click('[data-v="ia"]');
    await p.waitForSelector('.ia-panel');
    const boton = await p.locator('#ia-run').count();
    const peticiones = api.log.length;
    return [boton === 0 && peticiones === 0,
      'Boton ausente; peticiones=' + peticiones, p];
  }],

  ['IA-04', 'Acceso del vendedor', 'El vendedor no puede abrir la vista IA', async (b, base) => {
    const api = crearApi();
    const p = await nuevaPagina(b, base, api);
    await loginReal(p, 'vendedor@atelier.test');
    await p.evaluate(() => { location.hash = '#/ia'; });
    await p.waitForFunction(() => location.hash === '#/pos');
    const enlace = await p.locator('[data-v="ia"]').count();
    const panel = await p.locator('.ia-panel').count();
    const llamadas = api.log.filter(x => x.clave === 'POST /api/ia/reposicion');
    return [enlace === 0 && panel === 0 && llamadas.length === 0,
      'IA inaccesible para vendedor', p];
  }],

];

(async () => {
  const srv = await servir();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const browser = await chromium.launch();
  let fallos = 0;
  console.log('| ID | Escenario | Esperado | Obtenido | Resultado |');
  console.log('|---|---|---|---|---|');
  for (const [id, nombre, esperado, prueba] of ESCENARIOS) {
    let ok = false, detalle = '', page = null;
    try { [ok, detalle, page] = await prueba(browser, base); } catch (e) { detalle = 'error: ' + e.message.split('\n')[0]; }
    if (page && page.errores.length) { ok = false; detalle += `; errores JS: ${page.errores.join(' | ')}`; }
    if (page) await page.context().close();
    if (!ok) fallos += 1;
    console.log(`| ${id} | ${nombre} | ${esperado} | ${detalle} | ${ok ? 'PASS' : 'FAIL'} |`);
  }
  await browser.close();
  srv.close();
  console.log(`\n${ESCENARIOS.length - fallos} de ${ESCENARIOS.length} escenarios pasaron.`);
  process.exit(fallos ? 1 : 0);
})();

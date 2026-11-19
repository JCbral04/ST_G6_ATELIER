/* =============================================================
   ATELIER — capa de datos
   - Inicia sesión contra POST /api/auth/login y envía el token
     (Authorization: Bearer) en cada petición.
   - Intenta cada endpoint de la API; si no existe o falla, usa los
     datos de respaldo de data.js (modo demo). Sin backend, el login
     también funciona en modo demo con las cuentas del seed.
   ============================================================= */
(function (A) {
  'use strict';

  // Si la página la sirve Express, la API está en el mismo origen.
  const BASE = location.protocol.indexOf('http') === 0 ? '' : 'http://localhost:3000';
  const SESION = 'atelier.session';

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // Error con el código HTTP para poder distinguir 401/403/409/422
  function ApiError(message, status) {
    const e = new Error(message);
    e.status = status;
    return e;
  }

  // Petición a la API con el token de la sesión
  async function request(method, path, body) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (A.token) headers.Authorization = 'Bearer ' + A.token;
    const res = await fetch(BASE + path, {
      method: method, headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(function () { return {}; });
    if (res.status === 401 && A.token && path.indexOf('/api/auth/') !== 0) {
      // El token venció o fue revocado: volver al login
      if (A.app && A.app.sesionVencida) A.app.sesionVencida();
    }
    if (!res.ok) throw ApiError(data.error || ('Error ' + res.status), res.status);
    return data;
  }

  // Recursos que muestran las vistas -> endpoint esperado
  const RESOURCES = {
    variantes: '/api/inventario',                 // PR #15 (Steven)
    pedidos: '/api/pedidos',                      // PR #11 y #34
    compras: '/api/compras',                      // pendiente (backend)
    proveedores: '/api/proveedores',              // pendiente (backend)
    movimientos: '/api/inventario/movimientos',   // PR #30
  };

  A.store = {
    variantes: [], pedidos: [], compras: [], proveedores: [], movimientos: [],
    venta: [],
    live: {},      // recurso -> true si viene de la API
    apiOnline: false,
  };

  function siguienteId(lista, campo) {
    return lista.reduce(function (m, x) { return Math.max(m, Number(x[campo]) || 0); }, 0) + 1;
  }
  function variante(id) {
    return A.store.variantes.find(function (v) { return v.id_variante === Number(id); });
  }

  A.api = {
    request: request,

    /* ---------- Sesión ---------- */

    // Devuelve { usuario, token, demo }. Sin backend usa las cuentas del seed.
    async login(correo, contrasena) {
      try {
        const data = await request('POST', '/api/auth/login', { correo: correo, contrasena: contrasena });
        return { usuario: data.usuario, token: data.token, demo: false };
      } catch (err) {
        if (err.status === 401) throw ApiError('Correo o contraseña incorrectos.', 401);
        if (err.status === 429) throw ApiError('Demasiados intentos fallidos. Espera unos minutos y vuelve a intentar.', 429);
        if (err.status === 400) throw ApiError('Revisa el correo y la contraseña.', 400);
        // Sin backend, o un servidor sin /api/auth (404, 405, 501): modo demo
        if (err.status && [404, 405, 501].indexOf(err.status) === -1) {
          throw ApiError('No se pudo iniciar sesión. Intenta de nuevo en un momento.', err.status);
        }
        const u = A.mock.usuarios.find(function (x) { return x.correo === correo; });
        if (!u || contrasena !== '123456') throw ApiError('Correo o contraseña incorrectos.', 401);
        return { usuario: clone(u), token: null, demo: true };
      }
    },

    async logout() {
      if (A.token) { try { await request('POST', '/api/auth/logout'); } catch (e) { /* ya no importa */ } }
      A.token = null;
      A.storage.remove(SESION);
    },

    guardarSesion(s) { A.storage.set(SESION, s); },

    // Recupera la sesión de la pestaña y, si tiene token, la valida con /api/auth/me
    async recuperarSesion() {
      const s = A.storage.get(SESION);
      if (!s || !s.usuario) return null;
      if (!s.token) return s;   // sesión demo
      A.token = s.token;
      try {
        const data = await request('GET', '/api/auth/me');
        return { usuario: data.usuario, token: s.token };
      } catch (e) {
        A.token = null;
        A.storage.remove(SESION);
        return null;
      }
    },

    /* ---------- Carga de datos ---------- */

    async load() {
      const s = A.store;
      try {
        const h = await request('GET', '/api/health');
        s.apiOnline = !!h.base_de_datos;
      } catch (e) {
        s.apiOnline = false;
      }

      await Promise.all(Object.keys(RESOURCES).map(async function (key) {
        if (s.apiOnline) {
          try {
            const rows = await request('GET', RESOURCES[key]);
            if (Array.isArray(rows)) {
              s[key] = rows;
              s.live[key] = true;
              return;
            }
          } catch (e) { /* endpoint aún no implementado o sin permiso */ }
        }
        s[key] = clone(A.mock[key] || []);
        s.live[key] = false;
      }));

      // Los totales llegan como string desde PostgreSQL (NUMERIC)
      s.variantes.forEach(function (v) {
        v.precio = Number(v.precio); v.stock = Number(v.stock); v.stock_minimo = Number(v.stock_minimo);
      });
      s.pedidos.forEach(function (p) { p.total = Number(p.total); });
      s.compras.forEach(function (c) { c.total = Number(c.total); });
      return s;
    },

    // Fuente de datos para el indicador del encabezado
    sourceLabel() {
      const keys = Object.keys(RESOURCES);
      const live = keys.filter(function (k) { return A.store.live[k]; }).length;
      if (live === keys.length) return { text: 'Conectado a la base de datos', cls: 'pill-ok' };
      if (live > 0) return { text: 'Conexión parcial (' + live + ' de ' + keys.length + ')', cls: 'pill-warn' };
      return { text: 'Datos de prueba', cls: 'pill-muted' };
    },

    /* ---------- Ventas ---------- */

    // POST /api/pedidos. El vendedor sale del token; en demo se simula trg_stock_venta.
    async registrarVenta(venta) {
      const s = A.store;
      const items = venta.map(function (l) { return { id_variante: l.id_variante, cantidad: l.cantidad }; });

      if (s.live.pedidos) {
        const body = await request('POST', '/api/pedidos', { items: items });
        await A.api.load();
        return body;
      }

      for (const l of venta) {
        const v = variante(l.id_variante);
        if (!v || v.stock < l.cantidad) throw new Error('Stock insuficiente para ' + (v ? v.sku : l.id_variante));
      }
      let total = 0;
      venta.forEach(function (l) {
        const v = variante(l.id_variante);
        v.stock -= l.cantidad;
        total += v.precio * l.cantidad;
      });
      const id = siguienteId(s.pedidos, 'id_pedido');
      s.pedidos.unshift({ id_pedido: id, fecha: new Date().toISOString(), estado: 'pendiente', total: total,
        usuario: A.session ? A.session.nombre : '—', items: clone(items) });
      return { id_pedido: id, total: total, estado: 'pendiente' };
    },

    // POST /api/pedidos/:id/cancelar (PR #34, solo administrador). En demo devuelve el stock.
    async cancelarVenta(idPedido) {
      const s = A.store;
      if (s.live.pedidos) {
        const body = await request('POST', '/api/pedidos/' + encodeURIComponent(idPedido) + '/cancelar');
        await A.api.load();
        return body;
      }
      const p = s.pedidos.find(function (x) { return x.id_pedido === idPedido; });
      if (!p) throw ApiError('Pedido no encontrado', 404);
      if (p.estado === 'cancelado') throw ApiError('La venta ya está anulada', 409);
      if (['pendiente', 'confirmado'].indexOf(p.estado) === -1) throw ApiError('No se puede anular una venta despachada o entregada', 409);
      p.estado = 'cancelado';
      (p.items || []).forEach(function (it) {
        const v = variante(it.id_variante);
        if (!v) return;
        v.stock += it.cantidad;
        s.movimientos.unshift({ id_movimiento: siguienteId(s.movimientos, 'id_movimiento'), fecha: new Date().toISOString(),
          tipo: 'entrada', cantidad: it.cantidad, motivo: 'Anulación de la venta #' + idPedido,
          usuario: A.session.nombre, id_variante: v.id_variante, sku: v.sku, producto: v.producto, talla: v.talla, color: v.color });
      });
      return { mensaje: 'Venta #' + idPedido + ' anulada' };
    },

    /* ---------- Compras a proveedores ---------- */

    // POST /api/compras  { id_proveedor, items:[{ id_variante, cantidad, costo_unitario }] }
    async crearCompra(orden) {
      const s = A.store;
      if (s.live.compras) {
        const body = await request('POST', '/api/compras', orden);
        await A.api.load();
        return body;
      }
      const prov = s.proveedores.find(function (p) { return p.id_proveedor === orden.id_proveedor; });
      const total = orden.items.reduce(function (t, it) { return t + it.cantidad * it.costo_unitario; }, 0);
      const id = siguienteId(s.compras, 'id_compra');
      s.compras.unshift({ id_compra: id, fecha: new Date().toISOString(), estado: 'pendiente', total: total,
        proveedor: prov ? prov.nombre : '—',
        items: orden.items.map(function (it) {
          return { id_variante: it.id_variante, sku: variante(it.id_variante).sku, cantidad: it.cantidad, costo_unitario: it.costo_unitario };
        }) });
      return { id_compra: id, total: total, estado: 'pendiente' };
    },

    // PATCH /api/compras/:id { estado: 'recibida' }. En demo simula trg_stock_compra.
    async recibirCompra(idCompra) {
      const s = A.store;
      if (s.live.compras) {
        await request('PATCH', '/api/compras/' + encodeURIComponent(idCompra), { estado: 'recibida' });
        await A.api.load();
        return;
      }
      const c = s.compras.find(function (x) { return x.id_compra === idCompra; });
      if (!c || c.estado !== 'pendiente') return;
      c.estado = 'recibida';
      (c.items || []).forEach(function (it) {
        const v = s.variantes.find(function (x) { return x.sku === it.sku; });
        if (v) v.stock += Number(it.cantidad);
      });
    },

    /* ---------- Movimientos de inventario ---------- */

    // POST /api/inventario/movimientos (PR #30) { id_variante, tipo, cantidad, motivo }
    async registrarMovimiento(mov) {
      const s = A.store;
      if (s.live.movimientos) {
        // id_usuario se envía mientras la ruta no tome el usuario del token
        const body = await request('POST', '/api/inventario/movimientos',
          Object.assign({ id_usuario: A.session.id_usuario }, mov));
        await A.api.load();
        return body;
      }
      const v = variante(mov.id_variante);
      if (!v) throw ApiError('La variante no existe', 404);
      if (mov.tipo === 'salida' && v.stock < mov.cantidad) {
        throw ApiError('La salida dejaría el stock de ' + v.sku + ' en negativo (hay ' + v.stock + ')', 422);
      }
      v.stock += mov.tipo === 'entrada' ? mov.cantidad : -mov.cantidad;
      s.movimientos.unshift({ id_movimiento: siguienteId(s.movimientos, 'id_movimiento'), fecha: new Date().toISOString(),
        tipo: mov.tipo, cantidad: mov.cantidad, motivo: mov.motivo, usuario: A.session.nombre,
        id_variante: v.id_variante, sku: v.sku, producto: v.producto, talla: v.talla, color: v.color });
      return { stock_actual: v.stock };
    },
  };
})(window.Atelier);

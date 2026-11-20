/* =============================================================
   ATELIER — capa de datos

   Hay dos modos y nunca se mezclan:

   - Sesión real: se inicia con POST /api/auth/login y cada petición
     lleva el token (Authorization: Bearer). Todo sale de la API. Si un
     recurso no carga (no existe, 403, 500, sin conexión o respuesta con
     otro formato) queda vacío y marcado como no disponible: NO se
     reemplaza por datos de prueba. Las operaciones que dependen de ese
     recurso se desactivan y la interfaz explica por qué.

   - Modo demo: se elige a propósito desde el talón del login ("Entrar
     a la demo"). Usa solo los datos de data.js en memoria y no hace
     ninguna petición a la API, aunque el servidor esté disponible. La
     interfaz lo avisa todo el tiempo: nada se guarda en PostgreSQL.

   Aislamiento entre sesiones: cada sesión tiene un contexto (generación,
   token y modo). Al iniciar, cerrar o vencer una sesión se crea un
   contexto nuevo y se cancelan las peticiones pendientes del anterior.
   Una respuesta que llega de un contexto viejo se descarta (error
   "obsoleta"): no toca el store, no cierra la sesión nueva y no muestra
   confirmaciones.
   ============================================================= */
(function (A) {
  'use strict';

  // Si la página la sirve Express, la API está en el mismo origen.
  const BASE = location.protocol.indexOf('http') === 0 ? '' : 'http://localhost:3000';
  const SESION = 'atelier.session';

  // Roles que pueden usar el panel interno. El rol legado "cliente" no entra.
  const ROLES_PANEL = ['administrador', 'vendedor'];

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  // Error con el código HTTP para distinguir 401/403/409/422.
  // status 0 = no hubo respuesta del servidor.
  function ApiError(message, status, extra) {
    const e = new Error(message);
    e.status = status;
    return Object.assign(e, extra || {});
  }

  function esDemo() { return A.store.modo === 'demo'; }

  /* ---------- Contexto de sesión ---------- */

  let generacion = 0;
  let controlador = new AbortController();

  // Invalida todo lo que esté pendiente: se llama al iniciar, cerrar o
  // vencer una sesión y al empezar un intento de login.
  function nuevoContexto() {
    generacion += 1;
    controlador.abort();
    controlador = new AbortController();
  }
  function contexto() {
    return { gen: generacion, token: A.token || null, modo: A.store.modo, signal: controlador.signal };
  }
  function vigente(c) {
    return c.gen === generacion && c.token === (A.token || null) && c.modo === A.store.modo;
  }
  function obsoleta() {
    return ApiError('La operación pertenece a una sesión anterior.', 0, { obsoleta: true });
  }
  function exigirVigente(c) { if (!vigente(c)) throw obsoleta(); }

  /* ---------- Petición HTTP (solo sesión real) ---------- */

  // Usa el token y el contexto que había al empezar la petición.
  // opciones.token: petición independiente con un token concreto (revocar
  // la sesión que se está cerrando). No se cancela ni toca la sesión actual.
  async function request(method, path, body, opciones) {
    opciones = opciones || {};
    const independiente = 'token' in opciones;
    const c = independiente ? null : contexto();
    if (c && c.modo === 'demo') throw ApiError('En modo demo no se hacen peticiones a la API.', 0);
    const token = independiente ? opciones.token : c.token;

    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;

    let res;
    try {
      res = await fetch(BASE + path, {
        method: method, headers: headers, cache: 'no-store',
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: c ? c.signal : undefined,
      });
    } catch (e) {
      // Cancelada por un cambio de sesión: no es un error de conexión
      if (c && (e.name === 'AbortError' || !vigente(c))) throw obsoleta();
      throw ApiError(method === 'GET'
        ? 'No hay conexión con el servidor.'
        : 'No hubo respuesta del servidor. Revisa si la operación quedó registrada antes de repetirla.', 0);
    }
    if (c) exigirVigente(c);

    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (c) exigirVigente(c);
    const msg = data && typeof data.error === 'string' ? data.error : '';

    // 401 de la sesión vigente (ya comprobado arriba): volver al login sin pasar a demo
    if (res.status === 401 && c && c.token && path.indexOf('/api/auth/') !== 0) {
      if (A.app && A.app.sesionVencida) A.app.sesionVencida();
      throw ApiError('Tu sesión venció.', 401, { vencida: true });
    }
    if (!res.ok) {
      if (res.status === 403) throw ApiError(msg || 'Tu rol no tiene permiso para esta operación.', 403);
      if (res.status >= 500) throw ApiError(msg || 'El servidor tuvo un error y no completó la operación.', res.status);
      throw ApiError(msg || ('Error ' + res.status), res.status);
    }
    if (data === null) throw ApiError('El servidor respondió con un formato inesperado.', res.status, { formato: true });
    return data;
  }

  /* ---------- Validación de respuestas ---------- */

  function esId(x) { return /^[1-9]\d*$/.test(String(x)); }
  function esNum(x) { return x !== null && x !== '' && typeof x !== 'boolean' && isFinite(Number(x)); }
  function esTexto(x) { return typeof x === 'string'; }
  function esFecha(x) { return esTexto(x) && !isNaN(new Date(x)); }

  // Campos obligatorios de cada fila según el endpoint
  const ESQUEMAS = {
    variantes: { id_variante: esId, id_producto: esId, sku: esTexto, producto: esTexto, talla: esTexto, color: esTexto,
      precio: esNum, stock: esNum, stock_minimo: esNum },
    pedidos: { id_pedido: esId, fecha: esFecha, estado: esTexto, total: esNum },
    compras: { id_compra: esId, fecha: esFecha, estado: esTexto, total: esNum, items: Array.isArray },
    proveedores: { id_proveedor: esId, nombre: esTexto },
    movimientos: { id_movimiento: esId, fecha: esFecha, tipo: esTexto, cantidad: esNum, id_variante: esId, sku: esTexto },
  };

  function filasValidas(key, rows) {
    if (!Array.isArray(rows)) return false;
    const esquema = ESQUEMAS[key];
    return rows.every(function (r) {
      return r && typeof r === 'object' && Object.keys(esquema).every(function (campo) { return esquema[campo](r[campo]); });
    });
  }

  // PostgreSQL entrega NUMERIC y BIGINT como texto
  const NUMEROS = {
    variantes: ['id_variante', 'id_producto', 'precio', 'stock', 'stock_minimo'],
    pedidos: ['id_pedido', 'total'],
    compras: ['id_compra', 'total'],
    proveedores: ['id_proveedor'],
    movimientos: ['id_movimiento', 'id_variante', 'cantidad'],
  };
  function normalizar(key, rows) {
    rows.forEach(function (r) {
      NUMEROS[key].forEach(function (c) { r[c] = Number(r[c]); });
      if (key === 'compras') {
        r.items.forEach(function (it) {
          ['id_variante', 'cantidad', 'costo_unitario'].forEach(function (c) { if (it[c] != null) it[c] = Number(it[c]); });
        });
      }
    });
    return rows;
  }

  // Usuario de /api/auth/login o /api/auth/me
  function validarUsuario(u) {
    if (!u || typeof u !== 'object' || !esId(u.id_usuario) || !esTexto(u.nombre) || !u.nombre.trim() || !esTexto(u.rol)) {
      throw ApiError('El servidor respondió con un formato inesperado al iniciar sesión.', 0, { formato: true });
    }
    if (ROLES_PANEL.indexOf(u.rol) === -1) {
      throw ApiError('Tu cuenta no tiene acceso al panel de la tienda. Solo entran administradores y vendedores.', 403, { rol: true });
    }
    return { id_usuario: Number(u.id_usuario), nombre: u.nombre, rol: u.rol, correo: esTexto(u.correo) ? u.correo : undefined };
  }

  /* ---------- Recursos ---------- */

  // Recurso -> endpoint. Solo se piden los que usan las vistas del rol.
  const RESOURCES = {
    variantes: '/api/inventario',                 // PR #15 (Steven)
    pedidos: '/api/pedidos',                      // PR #11 y #34
    movimientos: '/api/inventario/movimientos',   // PR #30
    compras: '/api/compras',                      // PR #44 (Juan), solo administrador
    proveedores: '/api/proveedores',              // PR #44 (Juan), solo administrador
  };
  const NOMBRES = {
    variantes: 'el inventario', pedidos: 'las ventas', movimientos: 'el historial de movimientos',
    compras: 'las órdenes de compra', proveedores: 'los proveedores',
  };

  function recursosDelRol() {
    const keys = ['variantes', 'pedidos', 'movimientos'];
    if (A.session && A.session.rol === 'administrador') keys.push('compras', 'proveedores');
    return keys;
  }

  // Explica en palabras por qué un recurso no cargó
  function motivoDe(key, err) {
    const que = NOMBRES[key];
    const deQue = ('de ' + que).replace(/^de el /, 'del ');
    if (err.formato) return 'el servidor respondió ' + que + ' con un formato inesperado';
    if (err.status === 0) return 'no hay conexión con el servidor';
    if (err.status === 404) return 'el servidor todavía no tiene el endpoint ' + deQue + ' (GET ' + RESOURCES[key] + ')';
    if (err.status === 403) return 'tu rol no tiene permiso para ver ' + que;
    if (err.status >= 500) return 'el servidor tuvo un error al consultar ' + que;
    return 'no se pudo consultar ' + que + ' (error ' + err.status + ')';
  }

  A.store = {
    modo: null,          // 'real' | 'demo'
    variantes: [], pedidos: [], compras: [], proveedores: [], movimientos: [],
    venta: [],
    estado: {},          // recurso -> { ok, motivo }
  };

  // Ajustes manuales reales: apagados hasta que se integre el PR #37 y se
  // valide contra su contrato que POST /api/inventario/movimientos toma el
  // usuario del token y exige rol. Cambiar a true solo después de eso.
  const AJUSTES_REALES = true;

  function vaciar() {
    const s = A.store;
    Object.keys(RESOURCES).forEach(function (k) { s[k] = []; });
    s.estado = {};
    s.venta = [];
  }

  function siguienteId(lista, campo) {
    return lista.reduce(function (m, x) { return Math.max(m, Number(x[campo]) || 0); }, 0) + 1;
  }
  function variante(id) {
    return A.store.variantes.find(function (v) { return v.id_variante === Number(id); });
  }

  // Recarga tras una escritura real. Si falla, la operación igual quedó guardada.
  // Si la sesión cambió mientras tanto, la confirmación se descarta.
  async function recargar(c) {
    try { await A.api.load(); } catch (e) { /* sesión vencida u otro error: lo maneja load/request */ }
    exigirVigente(c);
  }

  // Lanza un error si la operación no se puede hacer en la sesión actual
  function exigir(accion) {
    const p = A.api.puede(accion);
    if (!p.ok) throw ApiError(p.motivo, 0, { bloqueada: true });
  }

  function movimientoDemo(v, tipo, cantidad, motivo) {
    A.store.movimientos.unshift({ id_movimiento: siguienteId(A.store.movimientos, 'id_movimiento'), fecha: new Date().toISOString(),
      tipo: tipo, cantidad: cantidad, motivo: motivo, usuario: A.session.nombre,
      id_variante: v.id_variante, sku: v.sku, producto: v.producto, talla: v.talla, color: v.color });
  }

  A.api = {
    request: request,
    esDemo: esDemo,

    /* ---------- Sesión ---------- */

    // Contexto de la sesión actual, para que app.js descarte trabajo viejo
    contexto: contexto,
    vigente: vigente,

    // Inicio de sesión real. Nunca cae a demo por su cuenta.
    // Empieza un contexto nuevo: cualquier intento o carga anterior queda descartado.
    async login(correo, contrasena) {
      nuevoContexto();
      vaciar();
      A.session = null;
      A.token = null;
      A.store.modo = 'real';
      const c = contexto();
      let data;
      try {
        data = await request('POST', '/api/auth/login', { correo: correo, contrasena: contrasena });
      } catch (err) {
        if (err.obsoleta) throw err;
        if (err.status === 401) throw ApiError('Correo o contraseña incorrectos.', 401);
        if (err.status === 429) throw ApiError('Demasiados intentos fallidos. Espera unos minutos y vuelve a intentar.', 429);
        if (err.status === 400) throw ApiError('Revisa el correo y la contraseña.', 400);
        if (err.status === 0 || [404, 405, 501].indexOf(err.status) !== -1) {
          throw ApiError('No hay conexión con el servidor de ATELIER. Si solo quieres ver el panel, entra a la demo.', 0, { sinServidor: true });
        }
        throw ApiError('No se pudo iniciar sesión. Intenta de nuevo en un momento.', err.status);
      }
      exigirVigente(c);
      if (!data || typeof data.token !== 'string' || data.token.length < 20) {
        throw ApiError('El servidor respondió con un formato inesperado al iniciar sesión.', 0, { formato: true });
      }
      try {
        return { usuario: validarUsuario(data.usuario), token: data.token, modo: 'real' };
      } catch (err) {
        // Rol no admitido: se revoca ese token con una petición independiente
        if (err.rol) request('POST', '/api/auth/logout', undefined, { token: data.token }).catch(function () {});
        throw err;
      }
    },

    // Demo elegida a propósito: usuario ficticio, sin contraseña ni peticiones a la API
    loginDemo(rol) {
      const u = A.mock.usuarios.find(function (x) { return x.rol === rol; });
      if (!u) throw ApiError('Ese rol no existe en la demo.', 0);
      return { usuario: clone(u), token: null, modo: 'demo' };
    },

    // Activa la sesión ya validada en un contexto nuevo
    iniciar(sesion) {
      nuevoContexto();
      vaciar();
      A.store.modo = sesion.modo;
      A.session = sesion.usuario;
      A.token = sesion.modo === 'real' ? sesion.token : null;
      A.storage.set(SESION, { usuario: sesion.usuario, token: A.token, modo: sesion.modo });
    },

    // Cierra la sesión local de inmediato (también cuando el token venció)
    olvidarSesion() {
      nuevoContexto();
      A.token = null;
      A.session = null;
      A.store.modo = null;
      vaciar();
      A.storage.remove(SESION);
    },

    // Cierre de sesión: primero se cierra la sesión local (contexto nuevo,
    // store y sessionStorage limpios) y después se pide revocar en el
    // servidor SOLO el token que se estaba cerrando. Esa petición no toca
    // el estado local, así que si termina tarde no afecta una sesión nueva.
    // Devuelve una promesa: true si el servidor confirmó la revocación.
    logout() {
      const token = esDemo() ? null : A.token;
      A.api.olvidarSesion();
      if (!token) return Promise.resolve(true);
      return request('POST', '/api/auth/logout', undefined, { token: token })
        .then(function () { return true; }, function () { return false; });
    },

    // Recupera la sesión de la pestaña. Una sesión real se valida con /api/auth/me;
    // si no se puede validar, vuelve al login (no pasa a demo).
    async recuperarSesion() {
      const s = A.storage.get(SESION);
      if (!s || !s.usuario || (s.modo !== 'real' && s.modo !== 'demo')) { A.storage.remove(SESION); return null; }
      if (s.modo === 'demo') {
        try { return { usuario: validarUsuario(s.usuario), token: null, modo: 'demo' }; } catch (e) { A.storage.remove(SESION); return null; }
      }
      nuevoContexto();
      A.store.modo = 'real';
      A.token = s.token;
      const c = contexto();
      try {
        const data = await request('GET', '/api/auth/me');
        exigirVigente(c);
        return { usuario: validarUsuario(data.usuario), token: s.token, modo: 'real' };
      } catch (err) {
        // Si otra sesión empezó mientras se validaba, no se toca nada
        if (err.obsoleta || !vigente(c)) return null;
        A.token = null;
        A.store.modo = null;
        A.storage.remove(SESION);
        if (err.rol) throw err;
        if (err.status === 0) throw ApiError('No se pudo validar tu sesión porque no hay conexión con el servidor. Vuelve a iniciar sesión.', 0);
        return null;
      }
    },

    /* ---------- Carga de datos ---------- */

    // Carga los recursos del rol. Las respuestas se juntan aparte y solo se
    // escriben en el store si la sesión sigue siendo la misma que las pidió.
    async load() {
      const s = A.store;
      const c = contexto();
      const keys = recursosDelRol();

      if (esDemo()) {
        keys.forEach(function (k) { s[k] = clone(A.mock[k] || []); s.estado[k] = { ok: true }; });
        return s;
      }

      const resultados = await Promise.all(keys.map(async function (key) {
        try {
          const rows = await request('GET', RESOURCES[key]);
          if (!filasValidas(key, rows)) throw ApiError('formato', 200, { formato: true });
          return { key: key, data: normalizar(key, rows), estado: { ok: true } };
        } catch (err) {
          if (err.obsoleta || err.vencida) throw err;
          return { key: key, data: [], estado: { ok: false, motivo: motivoDe(key, err) } };
        }
      }));
      exigirVigente(c);
      resultados.forEach(function (r) { s[r.key] = r.data; s.estado[r.key] = r.estado; });
      return s;
    },

    // ¿El recurso cargó? En demo siempre.
    disponible(key) { return !!(A.store.estado[key] && A.store.estado[key].ok); },
    motivo(key) { return (A.store.estado[key] && A.store.estado[key].motivo) || ''; },

    // ¿Se puede hacer esta operación ahora? { ok, motivo }
    puede(accion) {
      const rol = A.session && A.session.rol;
      const falta = function (key) { return A.api.disponible(key) ? '' : A.api.motivo(key); };
      let m = '';
      if (accion === 'vender') m = falta('variantes');
      else if (accion === 'anular') m = rol !== 'administrador' ? 'solo el administrador puede anular ventas' : falta('pedidos');
      else if (accion === 'ajustar') {
        m = falta('variantes') || falta('movimientos') ||
          (esDemo() || AJUSTES_REALES ? '' : 'el registro real de ajustes sigue apagado hasta integrar y validar la autenticación de movimientos del backend (PR #37)');
      } else if (accion === 'comprar') m = falta('variantes') || falta('proveedores') || falta('compras');
      else if (accion === 'recibir') m = falta('compras');
      return { ok: !m, motivo: m ? m.charAt(0).toUpperCase() + m.slice(1) + '.' : '' };
    },

    // Fuente de datos para el indicador del encabezado
    sourceLabel() {
      if (esDemo()) return { text: 'Modo demo: no se guarda', cls: 'pill-demo', title: 'Datos de prueba en memoria. Nada se envía a la base de datos.' };
      const keys = recursosDelRol();
      const fallan = keys.filter(function (k) { return !A.api.disponible(k); });
      if (!fallan.length) return { text: 'Conectado a la base de datos', cls: 'pill-ok', title: 'Todos los datos vienen de la API.' };
      return {
        text: fallan.length === keys.length ? 'Sin datos del servidor' : 'Conexión parcial (' + (keys.length - fallan.length) + ' de ' + keys.length + ')',
        cls: 'pill-warn',
        title: 'No disponible: ' + fallan.map(function (k) { return NOMBRES[k]; }).join(', ') + '. No se usan datos de prueba.',
      };
    },

    /* ---------- Ventas ---------- */

    // POST /api/pedidos. El vendedor sale del token; en demo se simula trg_stock_venta.
    async registrarVenta(venta) {
      exigir('vender');
      const s = A.store;
      const items = venta.map(function (l) { return { id_variante: l.id_variante, cantidad: l.cantidad }; });

      if (!esDemo()) {
        const c = contexto();   // la confirmación solo vale para esta sesión
        const body = await request('POST', '/api/pedidos', { items: items });
        if (!esId(body.id_pedido) || !esNum(body.total)) {
          throw ApiError('El servidor respondió algo inesperado. Revisa las últimas ventas antes de repetirla.', 0, { formato: true });
        }
        await recargar(c);
        return { id_pedido: Number(body.id_pedido), total: Number(body.total), estado: body.estado };
      }

      for (const l of venta) {
        const v = variante(l.id_variante);
        if (!v || v.stock < l.cantidad) throw ApiError('Stock insuficiente para ' + (v ? v.sku : l.id_variante), 409);
      }
      let total = 0;
      venta.forEach(function (l) {
        const v = variante(l.id_variante);
        v.stock -= l.cantidad;
        total += v.precio * l.cantidad;
      });
      const id = siguienteId(s.pedidos, 'id_pedido');
      s.pedidos.unshift({ id_pedido: id, fecha: new Date().toISOString(), estado: 'pendiente', total: total,
        usuario: A.session.nombre, items: clone(items) });
      return { id_pedido: id, total: total, estado: 'pendiente', demo: true };
    },

    // POST /api/pedidos/:id/cancelar (PR #34, solo administrador). En demo devuelve el stock.
    async cancelarVenta(idPedido) {
      exigir('anular');
      const s = A.store;
      if (!esDemo()) {
        const c = contexto();   // la confirmación solo vale para esta sesión
        const body = await request('POST', '/api/pedidos/' + encodeURIComponent(idPedido) + '/cancelar');
        await recargar(c);
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
        movimientoDemo(v, 'entrada', it.cantidad, 'Anulación de la venta #' + idPedido);
      });
      return { demo: true };
    },

    /* ---------- Compras a proveedores ---------- */

    // POST /api/compras  { id_proveedor, items:[{ id_variante, cantidad, costo_unitario }] }
    async crearCompra(orden) {
      exigir('comprar');
      const s = A.store;
      if (!esDemo()) {
        const c = contexto();   // la confirmación solo vale para esta sesión
        const body = await request('POST', '/api/compras', orden);
        if (!esId(body.id_compra) || !esNum(body.total)) {
          throw ApiError('El servidor respondió algo inesperado. Revisa las órdenes antes de repetirla.', 0, { formato: true });
        }
        await recargar(c);
        return { id_compra: Number(body.id_compra), total: Number(body.total), estado: body.estado };
      }
      const prov = s.proveedores.find(function (p) { return p.id_proveedor === orden.id_proveedor; });
      const total = orden.items.reduce(function (t, it) { return t + it.cantidad * it.costo_unitario; }, 0);
      const id = siguienteId(s.compras, 'id_compra');
      s.compras.unshift({ id_compra: id, fecha: new Date().toISOString(), estado: 'pendiente', total: total,
        proveedor: prov ? prov.nombre : '—',
        items: orden.items.map(function (it) {
          return { id_variante: it.id_variante, sku: variante(it.id_variante).sku, cantidad: it.cantidad, costo_unitario: it.costo_unitario };
        }) });
      return { id_compra: id, total: total, estado: 'pendiente', demo: true };
    },

    // PATCH /api/compras/:id { estado: 'recibida' }. En demo simula trg_stock_compra.
    async recibirCompra(idCompra) {
      exigir('recibir');
      const s = A.store;
      if (!esDemo()) {
        const c = contexto();   // la confirmación solo vale para esta sesión
        const body = await request('PATCH', '/api/compras/' + encodeURIComponent(idCompra), { estado: 'recibida' });
        await recargar(c);
        return body;
      }
      const c = s.compras.find(function (x) { return x.id_compra === idCompra; });
      if (!c) throw ApiError('La orden no existe', 404);
      if (c.estado !== 'pendiente') throw ApiError('La orden ya fue recibida', 409);
      c.estado = 'recibida';
      (c.items || []).forEach(function (it) {
        const v = it.id_variante ? variante(it.id_variante) : s.variantes.find(function (x) { return x.sku === it.sku; });
        if (!v) return;
        v.stock += Number(it.cantidad);
        movimientoDemo(v, 'entrada', Number(it.cantidad), 'Recepción de compra #' + idCompra);
      });
      return { demo: true };
    },

    /* ---------- Movimientos de inventario ---------- */

    // POST /api/inventario/movimientos { id_variante, tipo, cantidad, motivo }
    // El usuario lo toma el servidor del token: el navegador no lo envía.
    async registrarMovimiento(mov) {
      exigir('ajustar');
      const payload = { id_variante: mov.id_variante, tipo: mov.tipo, cantidad: mov.cantidad, motivo: mov.motivo };
      if (!esDemo()) {
        const c = contexto();   // la confirmación solo vale para esta sesión
        const body = await request('POST', '/api/inventario/movimientos', payload);
        if (!esNum(body.stock_actual)) {
          throw ApiError('El servidor respondió algo inesperado. Revisa el historial antes de repetir el ajuste.', 0, { formato: true });
        }
        await recargar(c);
        return { stock_actual: Number(body.stock_actual), sku: body.movimiento && body.movimiento.sku };
      }
      const v = variante(payload.id_variante);
      if (!v) throw ApiError('La variante no existe', 404);
      if (payload.tipo === 'salida' && v.stock < payload.cantidad) {
        throw ApiError('La salida dejaría el stock de ' + v.sku + ' en negativo (hay ' + v.stock + ')', 422);
      }
      v.stock += payload.tipo === 'entrada' ? payload.cantidad : -payload.cantidad;
      movimientoDemo(v, payload.tipo, payload.cantidad, payload.motivo);
      return { stock_actual: v.stock, sku: v.sku, demo: true };
    },
  };
})(window.Atelier);

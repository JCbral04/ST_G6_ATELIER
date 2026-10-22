/* =============================================================
   ATELIER — capa de datos
   Intenta cada endpoint de la API REST; si no existe o falla,
   usa los datos de respaldo de data.js (modo demo).
   ============================================================= */
(function (A) {
  'use strict';

  // Si la página la sirve Express, la API está en el mismo origen.
  const BASE = location.protocol.indexOf('http') === 0 ? '' : 'http://localhost:3000';

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  async function getJSON(path) {
    const res = await fetch(BASE + path, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  // Recursos que muestran las vistas -> endpoint esperado
  const RESOURCES = {
    variantes: '/api/inventario',   // issue #10
    pedidos: '/api/pedidos',        // PR #11
    compras: '/api/compras',        // Fase 4
    proveedores: '/api/proveedores' // Fase 4
  };

  A.store = {
    variantes: [], pedidos: [], compras: [], proveedores: [],
    cart: [],
    live: {},      // recurso -> true si viene de la API
    apiOnline: false,
  };

  A.api = {
    async load() {
      const s = A.store;
      try {
        const h = await getJSON('/api/health');
        s.apiOnline = !!h.base_de_datos;
      } catch (e) {
        s.apiOnline = false;
      }

      await Promise.all(Object.keys(RESOURCES).map(async function (key) {
        if (s.apiOnline) {
          try {
            const rows = await getJSON(RESOURCES[key]);
            if (Array.isArray(rows)) {
              s[key] = rows;
              s.live[key] = true;
              return;
            }
          } catch (e) { /* endpoint aún no implementado */ }
        }
        s[key] = clone(A.mock[key]);
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

    // Fuente de datos para el indicador del topbar
    sourceLabel() {
      const live = Object.keys(RESOURCES).filter(function (k) { return A.store.live[k]; }).length;
      const total = Object.keys(RESOURCES).length;
      if (live === total) return { text: 'Conectado a la base de datos', cls: 'pill-ok' };
      if (live > 0) return { text: 'Conexión parcial (' + live + ' de ' + total + ')', cls: 'pill-warn' };
      return { text: 'Datos de prueba', cls: 'pill-muted' };
    },

    // POST /api/pedidos (PR #11). En modo demo simula el trigger trg_stock_venta.
    async registrarVenta(idUsuario, cart) {
      const s = A.store;
      const items = cart.map(function (l) { return { id_variante: l.id_variante, cantidad: l.cantidad }; });

      if (s.live.pedidos) {
        const res = await fetch(BASE + '/api/pedidos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id_usuario: idUsuario, items: items }),
        });
        const body = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(body.error || 'No se pudo registrar la venta');
        await A.api.load();
        return body;
      }

      // Demo: validar stock (RN-01) y descontar (RN-02) de forma atómica
      for (const l of cart) {
        const v = s.variantes.find(function (x) { return x.id_variante === l.id_variante; });
        if (!v || v.stock < l.cantidad) {
          throw new Error('Stock insuficiente para ' + (v ? v.sku : l.id_variante));
        }
      }
      let total = 0;
      cart.forEach(function (l) {
        const v = s.variantes.find(function (x) { return x.id_variante === l.id_variante; });
        v.stock -= l.cantidad;
        total += v.precio * l.cantidad;
      });
      const id = s.pedidos.reduce(function (m, p) { return Math.max(m, p.id_pedido); }, 0) + 1;
      const user = A.session ? A.session.nombre : '—';
      s.pedidos.unshift({ id_pedido: id, fecha: new Date().toISOString(), estado: 'pendiente', total: total, usuario: user });
      return { id_pedido: id, total: total, estado: 'pendiente' };
    },

    // Recepción de compra. En modo demo simula trg_stock_compra.
    async recibirCompra(idCompra) {
      const s = A.store;
      if (s.live.compras) {
        const res = await fetch(BASE + '/api/compras/' + encodeURIComponent(idCompra), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estado: 'recibida' }),
        });
        const body = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(body.error || 'No se pudo actualizar la compra');
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
  };
})(window.Atelier);

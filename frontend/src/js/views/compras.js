/* =============================================================
   Vista: Compras a proveedores — órdenes y directorio (RF-16..18)
   ============================================================= */
(function (A) {
  'use strict';
  const esc = A.esc, fmt = A.fmt;

  const PILL = { recibida: 'pill-ok', pendiente: 'pill-warn', cancelada: 'pill-muted' };

  A.views.compras = {
    title: 'Compras y proveedores',
    icon: '⇄',
    roles: ['administrador'],

    render() {
      const s = A.store;
      const compras = s.compras.slice().sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
      const pendientes = compras.filter(function (c) { return c.estado === 'pendiente'; });
      const bajos = s.variantes.filter(A.isLow);

      return `
      <div class="kpis">
        <div><div class="k">ÓRDENES</div><div class="v">${compras.length}</div></div>
        <div><div class="k">POR RECIBIR</div><div class="v">${pendientes.length}</div></div>
        <div><div class="k">VALOR POR RECIBIR</div><div class="v">${fmt(pendientes.reduce(function (t, c) { return t + c.total; }, 0))}</div></div>
        <div><div class="k">PROVEEDORES</div><div class="v">${s.proveedores.length}</div></div>
      </div>

      ${bajos.length ? `<div class="alert-item">Hay <b>${bajos.length}</b> variante(s) en stock mínimo:
        ${bajos.map(function (v) { return '<b>' + esc(v.sku) + '</b>'; }).join(', ')}. Considera generar una orden de compra.</div>` : ''}

      <h3 class="sec">ÓRDENES DE COMPRA A PROVEEDORES</h3>
      ${compras.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Fecha</th><th>Proveedor</th><th>Detalle</th><th class="num">Total</th><th>Estado</th><th></th></tr></thead>
        <tbody>
        ${compras.map(function (c) {
          const det = (c.items || []).map(function (i) { return esc(i.cantidad) + ' × ' + esc(i.sku); }).join(', ') || '—';
          return `<tr><td>${esc(c.id_compra)}</td><td>${esc(A.fecha(c.fecha))}</td><td>${esc(c.proveedor)}</td>
            <td>${det}</td><td class="num">${fmt(c.total)}</td>
            <td><span class="pill ${PILL[c.estado] || 'pill-muted'}">${esc(c.estado)}</span></td>
            <td class="num">${c.estado === 'pendiente'
              ? `<button class="btn-mini" data-recibir="${esc(c.id_compra)}">Marcar recibida</button>` : ''}</td></tr>`;
        }).join('')}
        </tbody>
      </table></div>` : '<div class="empty">No hay órdenes de compra registradas.</div>'}

      <h3 class="sec sec-gap">PROVEEDORES</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Proveedor</th><th>Contacto</th><th>Correo</th><th>Teléfono</th></tr></thead>
        <tbody>
        ${s.proveedores.map(function (p) {
          return `<tr><td><b>${esc(p.nombre)}</b></td><td>${esc(p.contacto || '—')}</td>
            <td>${esc(p.correo || '—')}</td><td>${esc(p.telefono || '—')}</td></tr>`;
        }).join('')}
        </tbody>
      </table></div>`;
    },

    bind(root) {
      root.addEventListener('click', async function (e) {
        const btn = e.target.closest('[data-recibir]');
        if (!btn) return;
        const id = Number(btn.dataset.recibir);
        btn.disabled = true;
        try {
          await A.api.recibirCompra(id);
          A.toast('<b>Compra #' + esc(id) + ' recibida.</b><br>Trigger trg_stock_compra: stock actualizado.');
          A.app.refresh();
        } catch (err) {
          btn.disabled = false;
          A.toast('<b>Error:</b> ' + esc(err.message));
        }
      });
    },
  };
})(window.Atelier);

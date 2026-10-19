/* =============================================================
   Vista: Compras a proveedores — órdenes y directorio (RF-16..18)
   ============================================================= */
(function (A) {
  'use strict';
  const esc = A.esc, fmt = A.fmt;

  const PILL = { recibida: 'pill-ok', pendiente: 'pill-warn', cancelada: 'pill-muted' };

  A.views.compras = {
    title: 'Compras y proveedores',
    nav: 'Compras',
    roles: ['administrador'],

    render() {
      const s = A.store;
      const compras = s.compras.slice().sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
      const pendientes = compras.filter(function (c) { return c.estado === 'pendiente'; });
      const bajos = s.variantes.filter(A.isLow);

      return `
      <div class="kpis">
        <div><div class="k">Órdenes</div><div class="v">${compras.length}</div></div>
        <div><div class="k">Por recibir</div><div class="v">${pendientes.length}</div></div>
        <div><div class="k">Valor por recibir</div><div class="v">${fmt(pendientes.reduce(function (t, c) { return t + c.total; }, 0))}</div></div>
        <div><div class="k">Proveedores</div><div class="v">${s.proveedores.length}</div></div>
      </div>

      ${bajos.length ? `<p class="sec-note" style="margin:0 0 24px">Por reponer: ${bajos.map(function (v) { return '<span class="sku" style="color:var(--violet)">' + esc(v.sku) + '</span>'; }).join(', ')}.</p>` : ''}

      <h3 class="sec">Órdenes de compra</h3>
      ${compras.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Orden</th><th>Fecha</th><th>Proveedor</th><th>Detalle</th><th class="num">Total</th><th>Estado</th><th></th></tr></thead>
        <tbody>
        ${compras.map(function (c) {
          const det = (c.items || []).map(function (i) { return esc(i.cantidad) + ' × ' + esc(i.sku); }).join(', ') || '—';
          return `<tr><td>${esc(c.id_compra)}</td><td>${esc(A.fecha(c.fecha))}</td><td>${esc(c.proveedor)}</td>
            <td>${det}</td><td class="num">${fmt(c.total)}</td>
            <td><span class="pill ${PILL[c.estado] || 'pill-muted'}">${esc(c.estado)}</span></td>
            <td class="num">${c.estado === 'pendiente'
              ? `<button class="btn-mini" data-recibir="${esc(c.id_compra)}">Recibir</button>` : ''}</td></tr>`;
        }).join('')}
        </tbody>
      </table></div>` : '<div class="empty">No hay órdenes de compra registradas.</div>'}

      <h3 class="sec sec-gap">Proveedores</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Proveedor</th><th>Contacto</th><th>Correo</th><th>Teléfono</th></tr></thead>
        <tbody>
        ${s.proveedores.map(function (p) {
          return `<tr><td class="sku">${esc(p.nombre)}</td><td>${esc(p.contacto || '—')}</td>
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
          A.toast('<b>Orden ' + esc(id) + ' recibida.</b> El stock ya se sumó al inventario.');
          A.app.refresh();
        } catch (err) {
          btn.disabled = false;
          A.toast('<b>No se pudo recibir la orden.</b> ' + esc(err.message));
        }
      });
    },
  };
})(window.Atelier);

/* =============================================================
   Vista: Dashboard — KPIs, últimas ventas y alertas de stock (RF-10)
   ============================================================= */
(function (A) {
  'use strict';
  const esc = A.esc, fmt = A.fmt;

  A.views.dashboard = {
    title: 'Inicio',
    nav: 'Inicio',
    roles: ['administrador', 'vendedor'],

    render() {
      const s = A.store;
      const bajos = s.variantes.filter(A.isLow);
      const hoy = new Date().toDateString();
      const ventasHoy = s.pedidos.filter(function (p) {
        return p.estado !== 'cancelado' && new Date(p.fecha).toDateString() === hoy;
      });
      const totalHoy = ventasHoy.reduce(function (t, p) { return t + p.total; }, 0);
      const porRecibir = s.compras.filter(function (c) { return c.estado === 'pendiente'; }).length;
      const ultimas = s.pedidos.slice().sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); }).slice(0, 6);

      return `
      <div class="kpis">
        <div><div class="k">Vendido hoy</div><div class="v">${fmt(totalHoy)}</div></div>
        <div><div class="k">Pedidos de hoy</div><div class="v">${ventasHoy.length}</div></div>
        <div><div class="k">Variantes por reponer</div><div class="v ${bajos.length ? 'alert' : ''}">${bajos.length}</div></div>
        <div><div class="k">Compras por recibir</div><div class="v">${porRecibir}</div></div>
      </div>
      <div class="cols-2">
        <div>
          <h3 class="sec">Últimas ventas</h3>
          ${ultimas.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>Pedido</th><th>Registrado por</th><th>Fecha</th><th>Estado</th><th class="num">Total</th></tr></thead>
            <tbody>
            ${ultimas.map(function (p) {
              return `<tr><td>${esc(p.id_pedido)}</td><td>${esc(p.usuario)}</td>
                <td>${esc(A.fecha(p.fecha))}, ${esc(A.hora(p.fecha))}</td>
                <td><span class="pill ${p.estado === 'cancelado' ? 'pill-warn' : 'pill-ok'}">${esc(p.estado)}</span></td>
                <td class="num">${fmt(p.total)}</td></tr>`;
            }).join('')}
            </tbody>
          </table></div>` : '<div class="empty">Todavía no hay ventas. Regístralas desde Punto de venta.</div>'}
        </div>
        <div>
          <h3 class="sec">Por reponer</h3>
          ${bajos.length ? `<ul class="alert-list">${bajos.map(function (v) {
            return `<li class="alert-item">
              <div class="top"><span class="sku">${esc(v.sku)}</span><span class="left">${esc(v.stock)} de ${esc(v.stock_minimo)} mín.</span></div>
              <div class="desc">${esc(v.producto)}, talla ${esc(v.talla)}, ${esc(String(v.color).toLowerCase())}</div>
            </li>`;
          }).join('')}</ul>` : '<div class="all-good">Todo el inventario está por encima del mínimo.</div>'}
          ${bajos.length && A.app.can('compras') ? '<div class="after-list"><a class="btn-mini" href="#/compras">Ir a compras</a></div>' : ''}
        </div>
      </div>`;
    },
  };
})(window.Atelier);

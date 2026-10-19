/* =============================================================
   Vista: Dashboard — KPIs, últimas ventas y alertas de stock (RF-10)
   ============================================================= */
(function (A) {
  'use strict';
  const esc = A.esc, fmt = A.fmt;

  A.views.dashboard = {
    title: 'Dashboard',
    icon: '▦',
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
        <div><div class="k">VENTAS DEL DÍA</div><div class="v">${fmt(totalHoy)}</div></div>
        <div><div class="k">PEDIDOS HOY</div><div class="v">${ventasHoy.length}</div></div>
        <div><div class="k">STOCK BAJO</div><div class="v ${bajos.length ? 'alert' : ''}">${bajos.length} <span>variantes</span></div></div>
        <div><div class="k">COMPRAS POR RECIBIR</div><div class="v">${porRecibir}</div></div>
      </div>
      <div class="cols-2">
        <div>
          <h3 class="sec">ÚLTIMAS VENTAS</h3>
          ${ultimas.length ? `
          <div class="table-wrap"><table>
            <thead><tr><th>#</th><th>Cliente / usuario</th><th>Fecha</th><th>Estado</th><th class="num">Total</th></tr></thead>
            <tbody>
            ${ultimas.map(function (p) {
              return `<tr><td>${esc(p.id_pedido)}</td><td>${esc(p.usuario)}</td>
                <td>${esc(A.fecha(p.fecha))} · ${esc(A.hora(p.fecha))}</td>
                <td><span class="pill ${p.estado === 'cancelado' ? 'pill-warn' : 'pill-ok'}">${esc(p.estado)}</span></td>
                <td class="num">${fmt(p.total)}</td></tr>`;
            }).join('')}
            </tbody>
          </table></div>` : '<div class="empty">Aún no hay ventas registradas.</div>'}
        </div>
        <div>
          <h3 class="sec">ALERTAS DE STOCK MÍNIMO</h3>
          ${bajos.map(function (v) {
            return `<div class="alert-item"><b>${esc(v.sku)}</b> — ${esc(v.producto)} (${esc(v.talla)} / ${esc(v.color)})<br>
              Quedan <b>${esc(v.stock)}</b> uds. y el mínimo es ${esc(v.stock_minimo)}. Se sugiere orden de compra.</div>`;
          }).join('') || '<div class="alert-item ok">Sin alertas. Todo el stock está sobre el mínimo.</div>'}
          ${bajos.length && A.app.can('compras') ? '<a class="btn-mini" href="#/compras">Ver compras →</a>' : ''}
        </div>
      </div>`;
    },
  };
})(window.Atelier);
